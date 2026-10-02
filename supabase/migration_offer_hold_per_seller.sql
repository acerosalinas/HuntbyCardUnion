-- ---------------------------------------------------------------------------
-- MIGRATION: per-seller offer hold duration.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to run more than once.
--
-- What this does: the 1-hour offer hold (migration_offer_hold.sql) was a
-- fixed interval. This makes it a per-seller setting
-- (seller_profiles.offer_hold_hours, same pattern as live_mode_seconds),
-- defaulting to 24 hours - every currently-configured seller already gets
-- that default the moment this runs, not just new ones. Only submit_offer
-- (which computes held_until at the moment an offer is placed) and
-- expire_stale_offers (which now just checks that stored held_until instead
-- of recomputing a fixed interval from created_at) need to change - every
-- other function added by migration_offer_hold.sql already just reads
-- cards.held_until, so they keep working unchanged regardless of how long
-- the hold was set for. Changing a seller's setting only affects offers
-- made after the change; an offer already on hold keeps the held_until it
-- was given at submission time.
-- ---------------------------------------------------------------------------

alter table seller_profiles add column if not exists offer_hold_hours int not null default 24;
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'seller_profiles_offer_hold_hours_check'
  ) then
    alter table seller_profiles
      add constraint seller_profiles_offer_hold_hours_check check (offer_hold_hours between 1 and 168);
  end if;
end $$;

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
  v_hold_hours int;
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

  -- Seller-configurable (seller_profiles.offer_hold_hours, default 24) -
  -- falls back to 24 too if the seller somehow has no profile row yet,
  -- rather than failing the offer outright.
  select coalesce(offer_hold_hours, 24) into v_hold_hours
    from seller_profiles where admin_id = v_card.admin_id;
  v_hold_hours := coalesce(v_hold_hours, 24);

  update cards set holding_offer_id = v_offer.id, held_until = now() + make_interval(hours => v_hold_hours)
    where id = p_card_id;

  if v_card.admin_id is not null then
    begin
      insert into notifications (recipient_id, type, title, body, link)
        values (
          v_card.admin_id,
          'offer_received',
          'New offer received',
          v_handle || ' offered ' || p_offered_amount || ' on "' || v_card.title || '" - respond within ' || v_hold_hours || ' hour' || (case when v_hold_hours = 1 then '' else 's' end) || ' before it expires.',
          '/admin/offers'
        );
    exception when others then null;
    end;
  end if;

  return v_offer;
end;
$$;

-- No longer a fixed "1 hour" check against created_at - held_until already
-- reflects whatever offer_hold_hours was in effect for that seller at the
-- moment the offer was submitted (see submit_offer above), so this only
-- needs to compare against that stored value now.
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
    where o.status = 'PENDING' and c.held_until is not null and c.held_until <= now()
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
            'Your offer on "' || v_offer.title || '" expired with no response - feel free to make a new offer.',
            '/card/' || v_offer.card_id
          );
      exception when others then null;
      end;
    end if;
  end loop;
end;
$$;
