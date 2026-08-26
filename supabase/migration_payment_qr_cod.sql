-- Payment QR + Cash on Delivery migration.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to paste and run more than once.
--
-- What this does:
-- - seller_profiles gains payment_qr_url (a GCash/bank QR image, shown to a
--   buyer on the order confirmation screen alongside "Message Seller"), plus
--   cod_enabled/cod_weekday for opting into Cash on Delivery with one fixed
--   weekly shipping day.
-- - card_claims and dibs_queue each gain payment_method ('PREPAID' or
--   'COD'), chosen per card at Add to Cart the same way fulfillment_method
--   already is.
-- - place_order is redefined to read/carry payment_method through - same
--   signature as before, so no drop function is needed.

alter table seller_profiles add column if not exists payment_qr_url text;
alter table seller_profiles add column if not exists cod_enabled boolean not null default false;
alter table seller_profiles add column if not exists cod_weekday smallint;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'seller_profiles_cod_weekday_check') then
    alter table seller_profiles add constraint seller_profiles_cod_weekday_check check (cod_weekday between 0 and 6);
  end if;
end $$;

alter table card_claims add column if not exists payment_method text not null default 'PREPAID';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'card_claims_payment_method_check') then
    alter table card_claims add constraint card_claims_payment_method_check check (payment_method in ('PREPAID', 'COD'));
  end if;
end $$;

alter table dibs_queue add column if not exists payment_method text not null default 'PREPAID';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'dibs_queue_payment_method_check') then
    alter table dibs_queue add constraint dibs_queue_payment_method_check check (payment_method in ('PREPAID', 'COD'));
  end if;
end $$;

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
  v_card cards;
  v_position int;
  v_results jsonb := '[]'::jsonb;
  v_claim_card_ids uuid[] := '{}';
  v_claim_quantities int[] := '{}';
  v_claim_prices numeric[] := '{}';
  v_claim_fulfillments text[] := '{}';
  v_claim_payment_methods text[] := '{}';
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
      v_claim_fulfillments := v_claim_fulfillments || v_fulfillment;
      v_claim_payment_methods := v_claim_payment_methods || v_payment_method;
      v_claimed_total := v_claimed_total + (v_card.price * v_qty);
      if v_fulfillment = 'SHIP' then
        v_needs_shipping := true;
      end if;
      v_results := v_results || jsonb_build_object(
        'cardId', v_card_id, 'title', v_card.title, 'result', 'claimed', 'price', v_card.price, 'quantity', v_qty
      );
    else
      if not exists (
        select 1 from dibs_queue
        where card_id = v_card_id and buyer_id = v_buyer_id and status = 'WAITING'
      ) then
        select count(*) + 1 into v_position from dibs_queue where card_id = v_card_id and status = 'WAITING';
        insert into dibs_queue (card_id, buyer_id, buyer_handle, requested_quantity, fulfillment_method, payment_method)
          values (v_card_id, v_buyer_id, v_handle, v_qty, v_fulfillment, v_payment_method);
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
        fulfillment_method, payment_method
      )
        values (
          v_claim_card_ids[i], v_order_id, v_buyer_id, v_handle,
          v_claim_quantities[i], v_claim_prices[i], 'PENDING',
          v_claim_fulfillments[i], v_claim_payment_methods[i]
        );
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

revoke execute on function place_order(jsonb, text, text, text, text) from public;
grant execute on function place_order(jsonb, text, text, text, text) to authenticated;
