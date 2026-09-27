-- ---------------------------------------------------------------------------
-- MIGRATION: 1-hour offer hold + higher offer ceiling.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to run more than once.
--
-- What this does: submitting an offer now puts the whole card on hold for
-- one hour (cards.holding_offer_id/held_until) - nobody else can submit a
-- competing offer or buy it outright while that's active, closing the race
-- the old "Deliberately no stock hold" design (see the MIGRATION 14 comment
-- above place_order) explicitly allowed. The hold outlives the 1-hour
-- window once the seller responds: countering or accepting clears the
-- auto-expiry (held_until -> null) but keeps the card held - PENDING is the
-- only state with a ticking clock, matching the flow this was requested
-- for (offer -> 1h hold -> accept/expire; a counter puts it on the buyer's
-- own clock instead, with no expiry of its own). Declining, the buyer
-- declining a counter, and expire_stale_offers all clear the hold and free
-- the card back up.
--
-- Also raises the top of the allowed offer range from 100% to 120% of the
-- listed price, so a buyer can outbid instead of only ever discount - the
-- 80% floor is unchanged. lib/offerLimits.ts holds the matching frontend
-- constants; keep the two in sync if this ever changes again.
-- ---------------------------------------------------------------------------

alter table cards add column if not exists holding_offer_id uuid references offers (id) on delete set null;
alter table cards add column if not exists held_until timestamptz;
create index if not exists cards_holding_offer_id_idx on cards (holding_offer_id) where holding_offer_id is not null;

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

  -- Locked for the rest of this function: the hold check and the hold write
  -- below need to happen atomically, or two buyers racing to be first could
  -- both pass the "not held" check before either's insert commits.
  select * into v_card from cards where id = p_card_id for update;

  if not found then
    raise exception 'Card not found';
  end if;

  if v_card.status = 'SOLD' then
    raise exception 'Card is already sold';
  end if;

  -- Self-heal a hold whose hour has passed but expire_stale_offers (runs
  -- every minute via pg_cron - see the schedule near the end of this file)
  -- hasn't swept it yet, so correctness here doesn't depend on cron timing,
  -- only the notification/cleanup side-effects do.
  if v_card.holding_offer_id is not null and v_card.held_until is not null and v_card.held_until <= now() then
    update offers set status = 'EXPIRED' where id = v_card.holding_offer_id and status = 'PENDING';
    v_card.holding_offer_id := null;
    v_card.held_until := null;
  end if;

  if v_card.holding_offer_id is not null then
    raise exception 'This card currently has an offer being negotiated - please check back once it''s resolved.';
  end if;

  if p_offered_amount > v_card.price * 1.2 or p_offered_amount < v_card.price * 0.8 then
    raise exception 'Offer must be between 80%% and 120%% of the listed price';
  end if;

  insert into offers (card_id, buyer_id, buyer_handle, offered_amount, note)
    values (p_card_id, v_buyer_id, v_handle, p_offered_amount, p_note)
    returning * into v_offer;

  update cards set holding_offer_id = v_offer.id, held_until = now() + interval '1 hour'
    where id = p_card_id;

  if v_card.admin_id is not null then
    begin
      insert into notifications (recipient_id, type, title, body, link)
        values (
          v_card.admin_id,
          'offer_received',
          'New offer received',
          v_handle || ' offered ' || p_offered_amount || ' on "' || v_card.title || '" - respond within 1 hour before it expires.',
          '/admin/offers'
        );
    exception when others then null;
    end;
  end if;

  return v_offer;
end;
$$;

create or replace function respond_to_offer(p_offer_id uuid, p_accept boolean)
returns offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_offer offers;
  v_card cards;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_offer from offers where id = p_offer_id and buyer_id = v_buyer_id for update;
  if not found then
    raise exception 'Offer not found';
  end if;

  if v_offer.status = 'ACCEPTED' then
    if p_accept then
      raise exception 'This offer is already accepted.';
    end if;
    update offers set status = 'BUYER_DECLINED'
      where id = p_offer_id
      returning * into v_offer;
    update cards set holding_offer_id = null, held_until = null
      where id = v_offer.card_id and holding_offer_id = p_offer_id;
    return v_offer;
  end if;

  if v_offer.status <> 'COUNTERED' then
    raise exception 'This offer is no longer awaiting your response.';
  end if;

  if p_accept then
    update offers set status = 'ACCEPTED', agreed_amount = v_offer.counter_amount
      where id = p_offer_id
      returning * into v_offer;

    select * into v_card from cards where id = v_offer.card_id;
    if v_card.admin_id is not null then
      begin
        insert into notifications (recipient_id, type, title, body, link)
          values (
            v_card.admin_id,
            'offer_accepted',
            'Counter offer accepted',
            v_offer.buyer_handle || ' accepted your counter of ' || v_offer.counter_amount || ' on "' || v_card.title || '".',
            '/admin/offers'
          );
      exception when others then null;
      end;
    end if;
  else
    update offers set status = 'BUYER_DECLINED'
      where id = p_offer_id
      returning * into v_offer;
    update cards set holding_offer_id = null, held_until = null
      where id = v_offer.card_id and holding_offer_id = p_offer_id;
  end if;

  return v_offer;
end;
$$;

revoke execute on function respond_to_offer(uuid, boolean) from public;
grant execute on function respond_to_offer(uuid, boolean) to authenticated;

-- Runs every minute via pg_cron (schedule updated near the end of this
-- file) instead of every 15 - a 1-hour hold needs tighter cleanup than the
-- old 24-hour offer expiry did, though submit_offer/place_order also
-- self-heal a stale hold the moment anyone interacts with the card, so this
-- is really just the backstop sweep for cards nobody visits again.
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
    where o.status = 'PENDING' and o.created_at < now() - interval '1 hour'
  loop
    update offers set status = 'EXPIRED' where id = v_offer.id;
    update cards set holding_offer_id = null, held_until = null
      where id = v_offer.card_id and holding_offer_id = v_offer.id;
    if v_offer.buyer_id is not null then
      begin
        insert into notifications (recipient_id, type, title, body, link)
          values (
            v_offer.buyer_id,
            'offer_expired',
            'No response from the seller',
            'Your offer on "' || v_offer.title || '" expired after 1 hour with no response - feel free to make a new offer.',
            '/card/' || v_offer.card_id
          );
      exception when others then null;
      end;
    end if;
  end loop;
end;
$$;

-- One-time backfill: any offer already open (PENDING/COUNTERED/ACCEPTED) at
-- the moment this migration runs predates hold-tracking, so its card has no
-- holding_offer_id yet despite genuinely being under negotiation. Whichever
-- offer was submitted first per card wins the hold, matching the
-- first-come-first-served principle used everywhere else in this app; the
-- old no-hold design allowed a second buyer to also have their own open
-- offer on the same card at once, so any other one is superseded here
-- rather than left dangling.
with first_open_offer as (
  select distinct on (card_id) id, card_id, status, created_at
  from offers
  where status in ('PENDING', 'COUNTERED', 'ACCEPTED')
  order by card_id, created_at asc
)
update cards c
  set holding_offer_id = f.id,
      held_until = case when f.status = 'PENDING' then f.created_at + interval '1 hour' else null end
  from first_open_offer f
  where f.card_id = c.id;

with first_open_offer as (
  select distinct on (card_id) id, card_id
  from offers
  where status in ('PENDING', 'COUNTERED', 'ACCEPTED')
  order by card_id, created_at asc
)
update offers o
  set status = 'SUPERSEDED'
  from first_open_offer f
  where o.card_id = f.card_id
    and o.id <> f.id
    and o.status in ('PENDING', 'COUNTERED', 'ACCEPTED');

-- Immediately sweeps anything that just backfilled as already past its hour
-- (an offer that was already old under the previous 24-hour rule) instead
-- of waiting for the first cron tick.
select expire_stale_offers();

-- Atomic admin-side offer responses, mirroring the "atomic admin claim/
-- stock mutations" pattern above: each locks the offer row and re-checks
-- its status inside one transaction before writing, same reasoning as
-- confirm_paid_claim etc. Needed now that responding to an offer also has
-- to keep cards.holding_offer_id/held_until in sync - two separate
-- .update() calls from app/admin/actions.ts (one for the offer, one for
-- the card) would reopen exactly the kind of race that migration fixed
-- elsewhere.
create or replace function accept_offer_admin(p_offer_id uuid)
returns offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer offers;
begin
  select * into v_offer from offers where id = p_offer_id for update;
  if not found then
    raise exception 'Offer not found';
  end if;
  if v_offer.status <> 'PENDING' then
    raise exception 'This offer has already been responded to.';
  end if;

  update offers set status = 'ACCEPTED', agreed_amount = v_offer.offered_amount
    where id = p_offer_id
    returning * into v_offer;

  -- Hold stays on the card (no more auto-expiry now that it's accepted) so
  -- nobody else can buy or offer on it while this buyer checks out.
  update cards set held_until = null
    where id = v_offer.card_id and holding_offer_id = p_offer_id;

  return v_offer;
end;
$$;

create or replace function counter_offer_admin(p_offer_id uuid, p_counter_amount numeric)
returns offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer offers;
begin
  if p_counter_amount is null or p_counter_amount <= 0 then
    raise exception 'Counter amount must be greater than 0.';
  end if;

  select * into v_offer from offers where id = p_offer_id for update;
  if not found then
    raise exception 'Offer not found';
  end if;
  if v_offer.status <> 'PENDING' then
    raise exception 'This offer has already been responded to.';
  end if;

  update offers set status = 'COUNTERED', counter_amount = p_counter_amount
    where id = p_offer_id
    returning * into v_offer;

  -- The ball's in the buyer's court now, not the seller's 1-hour clock -
  -- hold stays on the card, but with no expiry to auto-release it.
  update cards set held_until = null
    where id = v_offer.card_id and holding_offer_id = p_offer_id;

  return v_offer;
end;
$$;

create or replace function decline_offer_admin(p_offer_id uuid)
returns offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer offers;
begin
  select * into v_offer from offers where id = p_offer_id for update;
  if not found then
    raise exception 'Offer not found';
  end if;
  if v_offer.status not in ('PENDING', 'ACCEPTED') then
    raise exception 'This offer can no longer be declined.';
  end if;

  update offers set status = 'DECLINED'
    where id = p_offer_id
    returning * into v_offer;

  update cards set holding_offer_id = null, held_until = null
    where id = v_offer.card_id and holding_offer_id = p_offer_id;

  return v_offer;
end;
$$;

-- place_order gains a hold check: a card currently held by someone else's
-- offer can't be bought outright or dropped into the wait queue, only
-- checked out via that exact offer's own offer_id (the accepted buyer
-- completing their negotiated purchase). Everything else about this
-- function - the offer_id/agreed_amount handling, the queue fallback, the
-- SUPERSEDED sweep - is unchanged from the prior version.
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

-- Tighter sweep interval for the new 1-hour hold (was */15 for the old
-- 24-hour offer expiry) - cron.schedule upserts by job name, so re-running
-- this replaces the existing schedule rather than adding a second one.
select cron.schedule('expire-stale-offers', '* * * * *', $$select expire_stale_offers()$$);
