-- Audit fixes batch migration.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to paste and run more than once.
--
-- What this does: a COUNTERED offer the buyer never responds to now expires
-- same as a PENDING one (previously only PENDING did, so an ignored counter
-- locked that buyer out of ever making a new offer on the card, forever). A
-- real unique index now backs "one open offer per buyer per card" instead
-- of a bare read-then-insert check. A buyer promoted from the queue is now
-- charged the price that was in effect when they joined, not whatever the
-- price has become by promotion time. Two new notification types
-- (claim_shipped, wanted_card_fulfilled) cover events that previously
-- notified nobody.

-- notifications.type gains two more values - same pattern as the last two
-- times this list grew.
do $$
declare
  v_conname text;
begin
  select conname into v_conname
    from pg_constraint
    where conrelid = 'public.notifications'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%type = ANY%';
  if v_conname is not null then
    execute format('alter table notifications drop constraint %I', v_conname);
  end if;
end $$;

alter table notifications add constraint notifications_type_check check (type in (
  'offer_received', 'offer_countered', 'offer_accepted', 'offer_declined', 'offer_expired',
  'card_claimed', 'queue_promoted', 'claim_shipped', 'wanted_card_fulfilled',
  'payment_confirmed', 'listing_cancelled', 'dispute_opened',
  'dispute_withdrawn', 'dispute_response', 'dispute_under_review', 'dispute_resolved',
  'claim_cancelled_by_buyer', 'review_received'
));

-- Backstop against a double-submit race, same reasoning/pattern as
-- one_open_dispute_per_claim (see supabase/schema.sql): submit_offer's own
-- check is a read-then-insert and can't fully prevent two concurrent calls
-- from both passing it before either commits.
create unique index if not exists offers_one_open_per_buyer_card
  on offers (card_id, buyer_id)
  where status in ('PENDING', 'COUNTERED', 'ACCEPTED');

-- Same signature as before - the insert is now wrapped to turn a
-- unique_violation (the new index above) into the same friendly message
-- the pre-check already gives, instead of a raw constraint error.
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

  if exists (
    select 1 from offers
    where card_id = p_card_id and buyer_id = v_buyer_id
      and status in ('PENDING', 'COUNTERED', 'ACCEPTED')
  ) then
    raise exception 'You already have an open offer on this card.';
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

  begin
    insert into offers (card_id, buyer_id, buyer_handle, offered_amount, note)
      values (p_card_id, v_buyer_id, v_handle, p_offered_amount, p_note)
      returning * into v_offer;
  exception when unique_violation then
    raise exception 'You already have an open offer on this card.';
  end;

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

-- Now also expires an ignored COUNTERED offer, using the same 24h-from-
-- created_at cutoff as PENDING (no separate "countered at" timestamp
-- exists) - an approximation of the buyer's actual response window, but
-- bounded and predictable beats never expiring at all.
create or replace function expire_stale_offers()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer record;
begin
  for v_offer in
    select o.id, o.buyer_id, o.card_id, c.title
    from offers o
    join cards c on c.id = o.card_id
    where o.status in ('PENDING', 'COUNTERED') and o.created_at < now() - interval '24 hours'
  loop
    update offers set status = 'EXPIRED' where id = v_offer.id;
    if v_offer.buyer_id is not null then
      begin
        insert into notifications (recipient_id, type, title, body, link)
          values (
            v_offer.buyer_id,
            'offer_expired',
            'No response from the seller',
            'Your offer on "' || v_offer.title || '" expired after 24 hours with no response - feel free to make a new offer.',
            '/card/' || v_offer.card_id
          );
      exception when others then null;
      end;
    end if;
  end loop;
end;
$$;

-- The price actually in effect when a buyer joined the queue, so
-- promoteNextInQueue (app/admin/actions.ts) can charge that instead of
-- silently charging whatever the price has become by promotion time.
-- Nullable - existing WAITING entries predate this column, and
-- promoteNextInQueue falls back to the card's list_price for those, same
-- as it always has.
alter table dibs_queue add column if not exists locked_price numeric(10, 2);

-- Same signature as before - the only change is capturing v_card.price
-- into the new dibs_queue.locked_price column when an item queues instead
-- of claiming.
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

    select * into v_card from cards where id = v_card_id for update;

    if not found or v_card.status = 'DRAFT' then
      v_results := v_results || jsonb_build_object('cardId', v_card_id, 'result', 'not_found');
      continue;
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
            status = (case when quantity_available - v_qty <= 0 then 'SOLD' else 'AVAILABLE' end)::card_status
        where id = v_card_id;

      v_claim_card_ids := v_claim_card_ids || v_card_id;
      v_claim_quantities := v_claim_quantities || v_qty;
      v_claim_prices := v_claim_prices || coalesce(v_offer.agreed_amount, v_card.price);
      v_claim_fulfillments := v_claim_fulfillments || v_fulfillment;
      v_claim_payment_methods := v_claim_payment_methods || v_payment_method;
      v_claim_offer_ids := v_claim_offer_ids || v_offer_id;
      v_claimed_total := v_claimed_total + (coalesce(v_offer.agreed_amount, v_card.price) * v_qty);
      if v_fulfillment = 'SHIP' then
        v_needs_shipping := true;
      end if;
      if v_offer_id is not null then
        update offers set status = 'FULFILLED' where id = v_offer_id;
      end if;
      v_results := v_results || jsonb_build_object(
        'cardId', v_card_id, 'title', v_card.title, 'result', 'claimed',
        'price', coalesce(v_offer.agreed_amount, v_card.price), 'quantity', v_qty
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
        fulfillment_method, payment_method, offer_id
      )
        values (
          v_claim_card_ids[i], v_order_id, v_buyer_id, v_handle,
          v_claim_quantities[i], v_claim_prices[i], 'PENDING',
          v_claim_fulfillments[i], v_claim_payment_methods[i], v_claim_offer_ids[i]
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
