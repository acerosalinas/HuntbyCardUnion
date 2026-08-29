-- Request Shipping migration.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to paste and run more than once.
--
-- What this does: a buyer stashing a card had no way to later ask the
-- seller to actually ship it. Adds card_claims.ship_requested_at, set once
-- by requestShipping() (app/account/actions.ts) on a paid, stashed,
-- not-yet-shipped claim, and adds the 'ship_requested' notification type
-- that fires to the owning admin when that happens.

alter table card_claims add column if not exists ship_requested_at timestamptz;

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
  'card_claimed', 'queue_promoted', 'claim_shipped', 'wanted_card_fulfilled', 'ship_requested',
  'payment_confirmed', 'listing_cancelled', 'dispute_opened',
  'dispute_withdrawn', 'dispute_response', 'dispute_under_review', 'dispute_resolved',
  'claim_cancelled_by_buyer', 'review_received'
));
