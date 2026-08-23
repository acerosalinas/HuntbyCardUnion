-- MIGRATION: shipping details + Ship Out / Stash checkout.
--
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against your existing project. Safe to run more than once.
--
-- Adds shipping/fulfillment columns to orders and updates place_order() to
-- collect and store them. Mirrors the same change in supabase/schema.sql.

alter table orders add column if not exists ship_name text;
alter table orders add column if not exists ship_phone text;
alter table orders add column if not exists ship_address text;
alter table orders add column if not exists ship_zip text;
alter table orders add column if not exists fulfillment_method text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_fulfillment_method_check'
  ) then
    alter table orders
      add constraint orders_fulfillment_method_check check (fulfillment_method in ('SHIP', 'STASH'));
  end if;
end $$;

-- create or replace can't change an existing function's parameter list (it
-- would create a second overload alongside the old one instead of
-- replacing it), so the old single-param version has to be dropped first.
drop function if exists place_order(uuid[]);

create or replace function place_order(
  p_card_ids uuid[],
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
    insert into orders (
      buyer_id, buyer_handle, total_amount,
      ship_name, ship_phone, ship_address, ship_zip, fulfillment_method
    )
      values (
        v_buyer_id, v_handle, v_claimed_total,
        p_ship_name, p_ship_phone, p_ship_address, p_ship_zip, p_fulfillment_method
      ) returning id into v_order_id;

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

revoke execute on function place_order(uuid[], text, text, text, text, text) from public;
grant execute on function place_order(uuid[], text, text, text, text, text) to authenticated;
