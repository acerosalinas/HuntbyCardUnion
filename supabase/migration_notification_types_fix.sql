-- Hotfix: notifications.type CHECK constraint never got the three new
-- values added by the offer negotiation rework (migration_offer_negotiation.sql).
-- Run this once in the Supabase SQL editor. Safe to paste and run more than once.
--
-- What this does: every offer_accepted / offer_declined / offer_expired
-- notification insert since that migration shipped has been silently
-- failing (rejected by this constraint, then swallowed by notifyUser's own
-- try/catch) - buyers have been getting zero notification when their offer
-- is accepted, declined, or expires. This adds the missing values.

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
  'card_claimed', 'queue_promoted',
  'payment_confirmed', 'listing_cancelled', 'dispute_opened',
  'dispute_withdrawn', 'dispute_response', 'dispute_under_review', 'dispute_resolved',
  'claim_cancelled_by_buyer', 'review_received'
));
