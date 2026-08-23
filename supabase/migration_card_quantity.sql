-- Card stock quantity + card_claims migration.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to paste and run more than once
-- - every statement is guarded to no-op if already applied.
--
-- What this does: a card listing can now have a quantity (total units) and
-- multiple different buyers can each claim some number of those units,
-- instead of exactly one buyer claiming the whole row. Per-buyer claim
-- state (who claimed how many, when, whether paid/shipped) moves off
-- `cards` into a new `card_claims` table. Existing PENDING/SOLD cards are
-- backfilled into one card_claims row each (quantity 1, matching the
-- single-unit assumption every card had before this migration), and the
-- now-redundant current_claimant/claimant_id/claimed_at/order_id/sold_at/
-- shipped columns are dropped from `cards` at the end.
--
-- This changes place_order()'s signature (a flat uuid[] of card ids can't
-- carry a per-item quantity, so it now takes a jsonb array of
-- {"card_id", "quantity"} objects instead) - update any client code calling
-- it before or immediately after running this.

alter table cards add column if not exists quantity integer not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cards_quantity_check') then
    alter table cards add constraint cards_quantity_check check (quantity > 0);
  end if;
end $$;

alter table cards add column if not exists quantity_available integer;
update cards set quantity_available = case when status = 'AVAILABLE' then 1 else 0 end
  where quantity_available is null;
alter table cards alter column quantity_available set not null;
alter table cards alter column quantity_available set default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cards_quantity_available_check') then
    alter table cards add constraint cards_quantity_available_check check (quantity_available >= 0);
  end if;
end $$;

alter table dibs_queue add column if not exists requested_quantity integer not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'dibs_queue_requested_quantity_check') then
    alter table dibs_queue add constraint dibs_queue_requested_quantity_check check (requested_quantity > 0);
  end if;
end $$;

create table if not exists card_claims (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards (id) on delete cascade,
  order_id uuid references orders (id) on delete set null,
  buyer_handle text not null,
  buyer_id uuid references auth.users (id) on delete set null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10, 2) not null check (unit_price > 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'SOLD', 'CANCELLED')),
  claimed_at timestamptz not null default now(),
  confirmed_at timestamptz,
  shipped boolean not null default false
);

create index if not exists card_claims_card_id_idx on card_claims (card_id, status);
create index if not exists card_claims_buyer_id_idx on card_claims (buyer_id);
create index if not exists card_claims_order_id_idx on card_claims (order_id);

alter table card_claims enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'card_claims' and policyname = 'buyers can view their own claims'
  ) then
    create policy "buyers can view their own claims" on card_claims for select using (auth.uid() = buyer_id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'card_claims'
  ) then
    alter publication supabase_realtime add table card_claims;
  end if;
end $$;

-- One claim row per already-claimed card (PENDING or SOLD), synthesized
-- from the columns being dropped below.
insert into card_claims (card_id, order_id, buyer_handle, buyer_id, quantity, unit_price, status, claimed_at, confirmed_at, shipped)
select
  id, order_id, current_claimant, claimant_id, 1, price,
  case status when 'SOLD' then 'SOLD' else 'PENDING' end,
  coalesce(claimed_at, created_at),
  sold_at,
  shipped
from cards
where status in ('PENDING', 'SOLD')
  and current_claimant is not null
  and not exists (select 1 from card_claims where card_claims.card_id = cards.id);

alter table cards drop column if exists current_claimant;
alter table cards drop column if exists claimant_id;
alter table cards drop column if exists claimed_at;
alter table cards drop column if exists order_id;
alter table cards drop column if exists sold_at;
alter table cards drop column if exists shipped;

alter table disputes add column if not exists claim_id uuid references card_claims (id) on delete cascade;

do $$ begin
  if exists (select 1 from pg_indexes where indexname = 'one_open_dispute_per_card_buyer') then
    drop index one_open_dispute_per_card_buyer;
  end if;
end $$;

create unique index if not exists one_open_dispute_per_claim
  on disputes (claim_id)
  where status not in ('RESOLVED_REFUND', 'RESOLVED_DISMISSED');

-- ---------------------------------------------------------------------------
-- place_order: rewritten for quantity - see supabase/schema.sql for full
-- commentary. Signature changes from place_order(uuid[], text, text, text,
-- text, text) to place_order(jsonb, text, text, text, text, text).
-- ---------------------------------------------------------------------------
drop function if exists place_order(uuid[]);
drop function if exists place_order(uuid[], text, text, text, text, text);

create or replace function place_order(
  p_items jsonb,
  p_ship_name text,
  p_ship_phone text,
  p_ship_address text,
  p_ship_zip text,
  p_fulfillment_method text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_handle text;
  v_item jsonb;
  v_card_id uuid;
  v_qty int;
  v_card cards;
  v_position int;
  v_results jsonb := '[]'::jsonb;
  v_claim_card_ids uuid[] := '{}';
  v_claim_quantities int[] := '{}';
  v_claim_prices numeric[] := '{}';
  v_claimed_total numeric := 0;
  v_order_id uuid;
  v_recent_count int;
  i int;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select handle into v_handle from profiles where id = v_buyer_id;
  if not found then
    raise exception 'Buyer profile not found.';
  end if;

  if not exists (
    select 1 from auth.users where id = v_buyer_id and email_confirmed_at is not null
  ) then
    raise exception 'Please confirm your email before placing an order.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  if p_fulfillment_method not in ('SHIP', 'STASH') then
    raise exception 'Choose Ship Out or Stash With Us before checking out.';
  end if;
  if p_ship_name is null or trim(p_ship_name) = '' or p_ship_phone is null or trim(p_ship_phone) = '' then
    raise exception 'Name and phone number are required to check out.';
  end if;
  if p_fulfillment_method = 'SHIP' and (
    p_ship_address is null or trim(p_ship_address) = '' or p_ship_zip is null or trim(p_ship_zip) = ''
  ) then
    raise exception 'Shipping address and zip code are required to ship your cards.';
  end if;

  select count(*) into v_recent_count
    from orders
    where buyer_id = v_buyer_id and created_at > now() - interval '1 minute';
  if v_recent_count >= 5 then
    raise exception 'Too many orders placed - please wait a moment and try again';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_card_id := (v_item ->> 'card_id')::uuid;
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::int, 1));

    select * into v_card from cards where id = v_card_id for update;

    if not found or v_card.status = 'DRAFT' then
      v_results := v_results || jsonb_build_object('cardId', v_card_id, 'result', 'not_found');
      continue;
    end if;

    if v_card.quantity_available >= v_qty then
      update cards
        set quantity_available = quantity_available - v_qty,
            status = case when quantity_available - v_qty <= 0 then 'SOLD' else 'AVAILABLE' end
        where id = v_card_id;

      v_claim_card_ids := v_claim_card_ids || v_card_id;
      v_claim_quantities := v_claim_quantities || v_qty;
      v_claim_prices := v_claim_prices || v_card.price;
      v_claimed_total := v_claimed_total + (v_card.price * v_qty);
      v_results := v_results || jsonb_build_object(
        'cardId', v_card_id, 'title', v_card.title, 'result', 'claimed', 'price', v_card.price, 'quantity', v_qty
      );
    else
      if not exists (
        select 1 from dibs_queue
        where card_id = v_card_id and buyer_id = v_buyer_id and status = 'WAITING'
      ) then
        select count(*) + 1 into v_position from dibs_queue where card_id = v_card_id and status = 'WAITING';
        insert into dibs_queue (card_id, buyer_id, buyer_handle, requested_quantity)
          values (v_card_id, v_buyer_id, v_handle, v_qty);
      else
        select count(*) into v_position
          from dibs_queue q
          where q.card_id = v_card_id and q.status = 'WAITING'
            and q.created_at <= (
              select created_at from dibs_queue
              where card_id = v_card_id and buyer_id = v_buyer_id and status = 'WAITING'
              limit 1
            );
      end if;
      v_results := v_results || jsonb_build_object(
        'cardId', v_card_id, 'title', v_card.title, 'result', 'queued', 'position', v_position, 'quantity', v_qty
      );
    end if;
  end loop;

  if array_length(v_claim_card_ids, 1) > 0 then
    insert into orders (
      buyer_id, buyer_handle, total_amount,
      ship_name, ship_phone, ship_address, ship_zip, fulfillment_method
    )
      values (
        v_buyer_id, v_handle, v_claimed_total,
        p_ship_name, p_ship_phone, p_ship_address, p_ship_zip, p_fulfillment_method
      ) returning id into v_order_id;

    for i in 1..array_length(v_claim_card_ids, 1) loop
      insert into card_claims (card_id, order_id, buyer_id, buyer_handle, quantity, unit_price, status)
        values (v_claim_card_ids[i], v_order_id, v_buyer_id, v_handle, v_claim_quantities[i], v_claim_prices[i], 'PENDING');
    end loop;

    update offers
      set status = 'SUPERSEDED'
      where card_id = any(v_claim_card_ids) and status = 'PENDING';

    begin
      insert into notifications (recipient_id, type, title, body, link)
        select
          c.admin_id,
          'card_claimed',
          count(*) || ' card(s) claimed',
          v_handle || ' claimed ' || count(*) || ' card(s) from your listings.',
          '/admin'
        from cards c
        where c.id = any(v_claim_card_ids) and c.admin_id is not null
        group by c.admin_id;
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('orderId', v_order_id, 'total', v_claimed_total, 'items', v_results);
end;
$$;

create or replace function try_claim_order_confirmation(p_order_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  update orders set confirmed_at = now()
    where id = p_order_id and confirmed_at is null
      and not exists (select 1 from card_claims where order_id = p_order_id and status = 'PENDING')
  returning true;
$$;

revoke execute on function place_order(jsonb, text, text, text, text, text) from public;
grant execute on function place_order(jsonb, text, text, text, text, text) to authenticated;

revoke execute on function try_claim_order_confirmation(uuid) from public;

-- ---------------------------------------------------------------------------
-- open_dispute: now takes a specific claim id instead of a card id, since a
-- card can have several buyers each holding their own claim - see
-- supabase/schema.sql for full commentary. Parameter types are unchanged
-- (uuid, dispute_reason, text) but the name changes (p_card_id ->
-- p_claim_id), and Postgres won't let create or replace rename a parameter
-- even when the types match - the function has to be dropped first.
-- ---------------------------------------------------------------------------
drop function if exists open_dispute(uuid, dispute_reason, text);

create or replace function open_dispute(
  p_claim_id uuid,
  p_reason dispute_reason,
  p_description text
)
returns disputes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_claim card_claims;
  v_card cards;
  v_recent_count int;
  v_lifetime_count int;
  v_dispute disputes;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  if not exists (select 1 from profiles where id = v_buyer_id) then
    raise exception 'Buyer profile not found.';
  end if;

  if not exists (
    select 1 from auth.users where id = v_buyer_id and email_confirmed_at is not null
  ) then
    raise exception 'Please confirm your email before opening a dispute.';
  end if;

  select * into v_claim from card_claims where id = p_claim_id;
  if not found or v_claim.status != 'SOLD' or v_claim.buyer_id is distinct from v_buyer_id then
    raise exception 'You can only open a dispute for an item you bought.';
  end if;

  select * into v_card from cards where id = v_claim.card_id;
  if not found then
    raise exception 'Card not found';
  end if;

  select count(*) into v_lifetime_count
    from disputes where claim_id = p_claim_id;
  if v_lifetime_count >= 2 then
    raise exception 'You have reached the maximum number of disputes for this item. Please contact admin directly.';
  end if;

  select count(*) into v_recent_count
    from disputes
    where buyer_id = v_buyer_id and created_at > now() - interval '1 hour';
  if v_recent_count >= 5 then
    raise exception 'Too many disputes opened - please wait a moment and try again';
  end if;

  begin
    insert into disputes (card_id, claim_id, order_id, buyer_id, seller_admin_id, reason, description)
      values (v_claim.card_id, p_claim_id, v_claim.order_id, v_buyer_id, v_card.admin_id, p_reason, p_description)
      returning * into v_dispute;
  exception when unique_violation then
    raise exception 'You already have an open dispute for this item.';
  end;

  if v_card.admin_id is not null then
    begin
      insert into notifications (recipient_id, type, title, body, link)
        values (
          v_card.admin_id,
          'dispute_opened',
          'New dispute opened',
          'A buyer opened a dispute on "' || v_card.title || '".',
          '/admin/disputes/' || v_dispute.id::text
        );
    exception when others then null;
    end;
  end if;

  return v_dispute;
end;
$$;

revoke execute on function open_dispute(uuid, dispute_reason, text) from public;
grant execute on function open_dispute(uuid, dispute_reason, text) to authenticated;
