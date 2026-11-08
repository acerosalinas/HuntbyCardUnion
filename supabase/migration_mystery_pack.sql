-- Fun Mystery Pack migration.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to paste and run more than once.
--
-- What this does: adds a third product_type, 'MYSTERY'. A Fun Mystery Pack
-- listing is a set of numbered packs: cards.quantity is how many packs there
-- are (1-10) and the buyer picks one number at checkout. The pick is stored on
-- the claim (card_claims.pack_number); a partial unique index makes a number
-- belong to one live claim at a time, and cancelling a claim frees it again.
-- Like sealed listings, condition_grade/rarity keep fixed placeholder values.

alter table cards drop constraint if exists cards_product_type_check;
alter table cards add constraint cards_product_type_check check (product_type in ('CARD', 'SEALED', 'MYSTERY'));

alter table cards drop constraint if exists cards_product_type_sealed_type_check;
alter table cards add constraint cards_product_type_sealed_type_check
  check (
    (product_type = 'SEALED' and sealed_type is not null)
    or (product_type in ('CARD', 'MYSTERY') and sealed_type is null)
  );

alter table cards drop constraint if exists cards_mystery_pack_count_check;
alter table cards add constraint cards_mystery_pack_count_check check (product_type <> 'MYSTERY' or quantity <= 10);

alter table card_claims add column if not exists pack_number smallint check (pack_number between 1 and 10);
create unique index if not exists card_claims_pack_number_idx
  on card_claims (card_id, pack_number)
  where pack_number is not null and status in ('PENDING', 'SOLD');

-- Which numbers of a Fun Mystery Pack are already taken, for the picker. Numbers only - never who took them.
create or replace function taken_pack_numbers(p_card_id uuid)
returns int[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(pack_number::int order by pack_number), '{}'::int[])
  from card_claims
  where card_id = p_card_id and pack_number is not null and status in ('PENDING', 'SOLD');
$$;
revoke execute on function taken_pack_numbers(uuid) from public;
grant execute on function taken_pack_numbers(uuid) to anon, authenticated;

-- place_order: same as the previous version (migration_offer_hold.sql) plus the
-- pack_number handling for MYSTERY cards. Everything else is unchanged.
create or replace function place_order(
  p_items jsonb,
  p_ship_name text,
  p_ship_phone text,
  p_ship_address text,
  p_ship_zip text
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
  v_fulfillment text;
  v_payment_method text;
  v_offer_id uuid;
  v_pack int;
  v_offer offers;
  v_card cards;
  v_position int;
  v_results jsonb := '[]'::jsonb;
  v_claim_card_ids uuid[] := '{}';
  v_claim_quantities int[] := '{}';
  v_claim_prices numeric[] := '{}';
  v_claim_fulfillments text[] := '{}';
  v_claim_payment_methods text[] := '{}';
  v_claim_offer_ids uuid[] := '{}';
  v_claim_pack_numbers int[] := '{}';
  v_claimed_total numeric := 0;
  v_needs_shipping boolean := false;
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

  if p_ship_name is null or trim(p_ship_name) = '' or p_ship_phone is null or trim(p_ship_phone) = '' then
    raise exception 'Name and phone number are required to check out.';
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
    v_fulfillment := coalesce(v_item ->> 'fulfillment_method', 'SHIP');
    if v_fulfillment not in ('SHIP', 'STASH') then
      v_fulfillment := 'SHIP';
    end if;
    v_payment_method := coalesce(v_item ->> 'payment_method', 'PREPAID');
    if v_payment_method not in ('PREPAID', 'COD') then
      v_payment_method := 'PREPAID';
    end if;
    v_offer_id := nullif(v_item ->> 'offer_id', '')::uuid;
    v_pack := nullif(v_item ->> 'pack_number', '')::int;

    select * into v_card from cards where id = v_card_id for update;

    if not found or v_card.status = 'DRAFT' then
      v_results := v_results || jsonb_build_object('cardId', v_card_id, 'result', 'not_found');
      continue;
    end if;

    -- Same self-heal as submit_offer - don't let cron timing decide whether
    -- a stale hold blocks a purchase that should now be allowed through.
    if v_card.holding_offer_id is not null and v_card.held_until is not null and v_card.held_until <= now() then
      update offers set status = 'EXPIRED' where id = v_card.holding_offer_id and status = 'PENDING';
      v_card.holding_offer_id := null;
      v_card.held_until := null;
    end if;

    -- `is distinct from`, not `<>` - v_offer_id is null for a plain cart
    -- purchase, and null <> anything is null (never true) in SQL, which
    -- would have silently let a held card through a normal purchase.
    if v_card.holding_offer_id is not null and v_card.holding_offer_id is distinct from v_offer_id then
      v_results := v_results || jsonb_build_object('cardId', v_card_id, 'title', v_card.title, 'result', 'card_on_hold');
      continue;
    end if;

    -- Fun Mystery Pack: the buyer picks one numbered pack (1..quantity). One pack per
    -- purchase, never negotiated, never queued - a taken or sold-out number is simply refused.
    if v_card.product_type = 'MYSTERY' then
      v_qty := 1;
      v_offer_id := null;
      if v_pack is null or v_pack < 1 or v_pack > v_card.quantity then
        v_results := v_results || jsonb_build_object('cardId', v_card_id, 'title', v_card.title, 'result', 'pack_invalid');
        continue;
      end if;
      if v_card.quantity_available < 1 or exists (
        select 1 from card_claims
        where card_id = v_card_id and pack_number = v_pack and status in ('PENDING', 'SOLD')
      ) then
        v_results := v_results || jsonb_build_object('cardId', v_card_id, 'title', v_card.title, 'result', 'pack_taken', 'packNumber', v_pack);
        continue;
      end if;
    else
      v_pack := null;
    end if;

    v_offer := null;
    if v_offer_id is not null then
      select * into v_offer from offers where id = v_offer_id for update;
      if not found or v_offer.buyer_id <> v_buyer_id or v_offer.card_id <> v_card_id or v_offer.status <> 'ACCEPTED' then
        v_results := v_results || jsonb_build_object('cardId', v_card_id, 'result', 'not_found');
        continue;
      end if;
      -- Offers are always single-unit - ignore whatever quantity the client sent.
      v_qty := 1;
    end if;

    if v_card.quantity_available >= v_qty then
      update cards
        set quantity_available = quantity_available - v_qty,
            status = (case when quantity_available - v_qty <= 0 then 'SOLD' else 'AVAILABLE' end)::card_status,
            holding_offer_id = null,
            held_until = null
        where id = v_card_id;

      v_claim_card_ids := v_claim_card_ids || v_card_id;
      v_claim_quantities := v_claim_quantities || v_qty;
      v_claim_prices := v_claim_prices || coalesce(v_offer.agreed_amount, v_card.price);
      v_claim_fulfillments := v_claim_fulfillments || v_fulfillment;
      v_claim_payment_methods := v_claim_payment_methods || v_payment_method;
      v_claim_offer_ids := v_claim_offer_ids || v_offer_id;
      v_claim_pack_numbers := v_claim_pack_numbers || v_pack;
      v_claimed_total := v_claimed_total + (coalesce(v_offer.agreed_amount, v_card.price) * v_qty);
      if v_fulfillment = 'SHIP' then
        v_needs_shipping := true;
      end if;
      if v_offer_id is not null then
        update offers set status = 'FULFILLED' where id = v_offer_id;
      end if;
      v_results := v_results || jsonb_build_object(
        'cardId', v_card_id, 'title', v_card.title, 'result', 'claimed',
        'price', coalesce(v_offer.agreed_amount, v_card.price), 'quantity', v_qty,
        'packNumber', v_pack
      );
    elsif v_offer_id is not null then
      -- Don't silently queue an offer-priced item at full price - leave the
      -- offer ACCEPTED and untouched so the buyer can try again once stock
      -- frees up, same as anyone else waiting on this card.
      v_results := v_results || jsonb_build_object(
        'cardId', v_card_id, 'title', v_card.title, 'result', 'offer_stock_unavailable'
      );
    else
      if not exists (
        select 1 from dibs_queue
        where card_id = v_card_id and buyer_id = v_buyer_id and status = 'WAITING'
      ) then
        select count(*) + 1 into v_position from dibs_queue where card_id = v_card_id and status = 'WAITING';
        insert into dibs_queue (card_id, buyer_id, buyer_handle, requested_quantity, fulfillment_method, payment_method, locked_price)
          values (v_card_id, v_buyer_id, v_handle, v_qty, v_fulfillment, v_payment_method, v_card.price);
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
    if v_needs_shipping and (
      p_ship_address is null or trim(p_ship_address) = '' or p_ship_zip is null or trim(p_ship_zip) = ''
    ) then
      raise exception 'Shipping address and zip code are required to ship your cards.';
    end if;

    insert into orders (
      buyer_id, buyer_handle, total_amount,
      ship_name, ship_phone, ship_address, ship_zip
    )
      values (
        v_buyer_id, v_handle, v_claimed_total,
        p_ship_name, p_ship_phone, p_ship_address, p_ship_zip
      ) returning id into v_order_id;

    for i in 1..array_length(v_claim_card_ids, 1) loop
      insert into card_claims (
        card_id, order_id, buyer_id, buyer_handle, quantity, unit_price, status,
        fulfillment_method, payment_method, offer_id, pack_number
      )
        values (
          v_claim_card_ids[i], v_order_id, v_buyer_id, v_handle,
          v_claim_quantities[i], v_claim_prices[i], 'PENDING',
          v_claim_fulfillments[i], v_claim_payment_methods[i], v_claim_offer_ids[i],
          v_claim_pack_numbers[i]
        );
    end loop;

    update offers
      set status = 'SUPERSEDED'
      where card_id = any(v_claim_card_ids) and status in ('PENDING', 'COUNTERED');

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
