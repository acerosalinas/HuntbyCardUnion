-- MIGRATION: in-app notifications.
--
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against your existing project. Safe to run more than once - every
-- statement is idempotent (create table/policy/publication membership all
-- guarded with if-not-exists checks, and the four functions at the bottom
-- use create or replace, which simply redefines them).
--
-- This mirrors the same change already made in supabase/schema.sql, pulled
-- out standalone so you don't have to copy specific line ranges out of that
-- file - re-running the whole schema.sql top-to-bottom on an existing
-- project would fail (it has bare `create table` statements for the core
-- tables, which already exist on your project).

-- ---------------------------------------------------------------------------
-- In-app notifications. One table serves both buyers and admins - both are
-- plain auth.users rows, distinguished only by app_metadata.role, so
-- recipient_id needs no role column. `type` is a text + check constraint
-- rather than a real enum (unlike card_status/offer_status/dispute_status
-- elsewhere in this schema): this list grows every time a new event needs a
-- notification, and enums can't gain values inside the same transaction as
-- other DDL. No insert policy - every insert comes from a security-definer
-- RPC below or the service-role client in app/admin/actions.ts, both of
-- which bypass RLS, same convention as every other table here. The update
-- policy (mark as read) is the one new pattern: a buyer/admin can flip
-- read_at on their own row directly, without going through a Server Action
-- or RPC.
-- ---------------------------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in (
    'offer_received', 'offer_countered', 'card_claimed', 'queue_promoted',
    'payment_confirmed', 'listing_cancelled', 'dispute_opened',
    'dispute_withdrawn', 'dispute_response', 'dispute_under_review', 'dispute_resolved'
  )),
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_unread_idx
  on notifications (recipient_id, created_at desc) where read_at is null;
create index if not exists notifications_recipient_id_idx
  on notifications (recipient_id, created_at desc);

alter table notifications enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'notifications' and policyname = 'users can view their own notifications'
  ) then
    create policy "users can view their own notifications" on notifications
      for select using (auth.uid() = recipient_id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'notifications' and policyname = 'users can mark their own notifications read'
  ) then
    create policy "users can mark their own notifications read" on notifications
      for update using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- submit_offer: adds a notification for the card's admin. Everything else
-- in this function is unchanged from the version already on your project.
-- ---------------------------------------------------------------------------
create or replace function submit_offer(
  p_card_id uuid,
  p_offered_amount numeric,
  p_note text default null
)
returns offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_handle text;
  v_card cards;
  v_offer offers;
  v_recent_count int;
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
    raise exception 'Please confirm your email before making an offer.';
  end if;

  select count(*) into v_recent_count
    from offers
    where buyer_id = v_buyer_id and created_at > now() - interval '1 minute';
  if v_recent_count >= 10 then
    raise exception 'Too many offers submitted - please wait a moment and try again';
  end if;

  select * into v_card from cards where id = p_card_id;

  if not found then
    raise exception 'Card not found';
  end if;

  if v_card.status = 'SOLD' then
    raise exception 'Card is already sold';
  end if;

  if p_offered_amount > v_card.price or p_offered_amount < v_card.price * 0.75 then
    raise exception 'Offer must be between 75%% and 100%% of the listed price';
  end if;

  insert into offers (card_id, buyer_id, buyer_handle, offered_amount, note)
    values (p_card_id, v_buyer_id, v_handle, p_offered_amount, p_note)
    returning * into v_offer;

  if v_card.admin_id is not null then
    begin
      insert into notifications (recipient_id, type, title, body, link)
        values (
          v_card.admin_id,
          'offer_received',
          'New offer received',
          v_handle || ' offered ' || p_offered_amount || ' on "' || v_card.title || '".',
          '/admin/offers'
        );
    exception when others then null;
    end;
  end if;

  return v_offer;
end;
$$;

-- ---------------------------------------------------------------------------
-- place_order: adds ONE notification per admin whose card(s) got claimed in
-- this order (not one per card - mirrors the existing "one consolidated
-- Messenger message per seller" behavior for a cart spanning multiple
-- cards). Everything else is unchanged.
-- ---------------------------------------------------------------------------
create or replace function place_order(p_card_ids uuid[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_handle text;
  v_card_id uuid;
  v_card cards;
  v_position int;
  v_results jsonb := '[]'::jsonb;
  v_claimed_ids uuid[] := '{}';
  v_claimed_total numeric := 0;
  v_order_id uuid;
  v_recent_count int;
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

  if p_card_ids is null or array_length(p_card_ids, 1) is null then
    raise exception 'Cart is empty';
  end if;

  select count(*) into v_recent_count
    from orders
    where buyer_id = v_buyer_id and created_at > now() - interval '1 minute';
  if v_recent_count >= 5 then
    raise exception 'Too many orders placed - please wait a moment and try again';
  end if;

  foreach v_card_id in array p_card_ids loop
    select * into v_card from cards where id = v_card_id for update;

    if not found then
      v_results := v_results || jsonb_build_object('cardId', v_card_id, 'result', 'not_found');
      continue;
    end if;

    if v_card.status = 'SOLD' then
      v_results := v_results || jsonb_build_object('cardId', v_card_id, 'title', v_card.title, 'result', 'sold');
    elsif v_card.status = 'PENDING' and v_card.claimant_id = v_buyer_id then
      v_results := v_results || jsonb_build_object('cardId', v_card_id, 'title', v_card.title, 'result', 'already_yours');
    elsif v_card.status = 'PENDING' then
      if not exists (
        select 1 from dibs_queue
        where card_id = v_card_id and buyer_id = v_buyer_id and status = 'WAITING'
      ) then
        select count(*) + 1 into v_position from dibs_queue where card_id = v_card_id and status = 'WAITING';
        insert into dibs_queue (card_id, buyer_id, buyer_handle) values (v_card_id, v_buyer_id, v_handle);
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
      v_results := v_results || jsonb_build_object('cardId', v_card_id, 'title', v_card.title, 'result', 'queued', 'position', v_position);
    else
      -- AVAILABLE: claim it as part of this order.
      v_claimed_ids := v_claimed_ids || v_card_id;
      v_claimed_total := v_claimed_total + v_card.price;
      v_results := v_results || jsonb_build_object('cardId', v_card_id, 'title', v_card.title, 'result', 'claimed', 'price', v_card.price);
    end if;
  end loop;

  if array_length(v_claimed_ids, 1) > 0 then
    insert into orders (buyer_id, buyer_handle, total_amount)
      values (v_buyer_id, v_handle, v_claimed_total) returning id into v_order_id;

    update cards
      set status = 'PENDING', current_claimant = v_handle, claimant_id = v_buyer_id,
          claimed_at = now(), order_id = v_order_id
      where id = any(v_claimed_ids);

    update offers
      set status = 'SUPERSEDED'
      where card_id = any(v_claimed_ids) and status = 'PENDING';

    begin
      insert into notifications (recipient_id, type, title, body, link)
        select
          c.admin_id,
          'card_claimed',
          count(*) || ' card(s) claimed',
          v_handle || ' claimed ' || count(*) || ' card(s) from your listings.',
          '/admin'
        from cards c
        where c.id = any(v_claimed_ids) and c.admin_id is not null
        group by c.admin_id;
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('orderId', v_order_id, 'total', v_claimed_total, 'items', v_results);
end;
$$;

-- ---------------------------------------------------------------------------
-- open_dispute: adds a notification for the card's admin. Everything else
-- unchanged.
-- ---------------------------------------------------------------------------
create or replace function open_dispute(
  p_card_id uuid,
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

  select * into v_card from cards where id = p_card_id;
  if not found then
    raise exception 'Card not found';
  end if;
  if v_card.status != 'SOLD' or v_card.claimant_id is distinct from v_buyer_id then
    raise exception 'You can only open a dispute for an item you bought.';
  end if;

  select count(*) into v_lifetime_count
    from disputes where card_id = p_card_id and buyer_id = v_buyer_id;
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
    insert into disputes (card_id, order_id, buyer_id, seller_admin_id, reason, description)
      values (p_card_id, v_card.order_id, v_buyer_id, v_card.admin_id, p_reason, p_description)
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

-- ---------------------------------------------------------------------------
-- withdraw_dispute: adds a notification for the dispute's seller admin.
-- Everything else unchanged.
-- ---------------------------------------------------------------------------
create or replace function withdraw_dispute(p_dispute_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_dispute disputes;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_dispute from disputes where id = p_dispute_id for update;
  if not found or v_dispute.buyer_id is distinct from v_buyer_id then
    raise exception 'Dispute not found.';
  end if;
  if v_dispute.status != 'OPEN' then
    raise exception 'This dispute can no longer be withdrawn - it is already being handled.';
  end if;

  update disputes
    set status = 'RESOLVED_DISMISSED', resolution_note = 'Withdrawn by buyer', resolved_at = now()
    where id = p_dispute_id;

  if v_dispute.seller_admin_id is not null then
    begin
      insert into notifications (recipient_id, type, title, body, link)
        values (
          v_dispute.seller_admin_id,
          'dispute_withdrawn',
          'Dispute withdrawn',
          'The buyer withdrew their dispute.',
          '/admin/disputes/' || p_dispute_id::text
        );
    exception when others then null;
    end;
  end if;
end;
$$;

revoke execute on function withdraw_dispute(uuid) from public;
grant execute on function withdraw_dispute(uuid) to authenticated;
