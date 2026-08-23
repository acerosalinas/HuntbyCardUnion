-- Fix: "column status is of type card_status but expression is of type
-- text" when placing an order or cancelling a claim.
--
-- Root cause: a `case when ... then 'SOLD' else 'AVAILABLE' end` expression
-- resolves to plain text, not the card_status enum, even though every
-- branch is a valid enum label - unlike a bare `status = 'SOLD'` literal
-- (which Postgres infers against the target column's type), a CASE
-- expression's result needs an explicit `::card_status` cast before it can
-- be assigned to the status column. Both place_order and cancel_claim had
-- this bug. Run this once in the Supabase SQL editor - safe to run more
-- than once (create or replace).

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
            status = (case when quantity_available - v_qty <= 0 then 'SOLD' else 'AVAILABLE' end)::card_status
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

create or replace function cancel_claim(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_claim card_claims;
  v_card cards;
  v_new_available int;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_claim from card_claims where id = p_claim_id for update;
  if not found or v_claim.buyer_id is distinct from v_buyer_id then
    raise exception 'Claim not found.';
  end if;
  if v_claim.status != 'PENDING' then
    raise exception 'This claim can no longer be cancelled - it has already been paid or cancelled.';
  end if;

  select * into v_card from cards where id = v_claim.card_id for update;
  if not found then
    raise exception 'Card not found.';
  end if;

  update card_claims set status = 'CANCELLED' where id = p_claim_id;

  v_new_available := v_card.quantity_available + v_claim.quantity;
  update cards
    set quantity_available = v_new_available,
        status = (case when v_new_available > 0 then 'AVAILABLE' else 'SOLD' end)::card_status,
        price = v_card.list_price
    where id = v_claim.card_id;

  update dibs_queue set status = 'CANCELLED' where card_id = v_claim.card_id and status = 'WAITING';

  if v_card.admin_id is not null then
    begin
      insert into notifications (recipient_id, type, title, body, link)
        values (
          v_card.admin_id,
          'claim_cancelled_by_buyer',
          'Buyer cancelled a claim',
          v_claim.buyer_handle || ' cancelled their claim on "' || v_card.title || '".',
          '/admin'
        );
    exception when others then null;
    end;
  end if;
end;
$$;
