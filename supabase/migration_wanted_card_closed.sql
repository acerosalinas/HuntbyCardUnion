-- Wanted Cards: "not fulfilled" notification type.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to run more than once. Already
-- included in full supabase/schema.sql for fresh installs.
--
-- What this does: adds 'wanted_card_closed' to the notifications.type CHECK
-- constraint, so a buyer gets an in-app notification when an admin marks
-- their Wanted Card request as not fulfilled (previously only "fulfilled"
-- notified them). Until this is run, that notification silently fails to
-- save - nothing else breaks.

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
  'card_claimed', 'queue_promoted', 'claim_shipped', 'wanted_card_fulfilled', 'wanted_card_closed', 'ship_requested',
  'payment_confirmed', 'listing_cancelled', 'dispute_opened',
  'dispute_withdrawn', 'dispute_response', 'dispute_under_review', 'dispute_resolved',
  'claim_cancelled_by_buyer', 'review_received', 'live_sale_assigned'
));
