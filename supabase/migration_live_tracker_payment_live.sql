-- Live Tracker: tie a payment to a specific live.
-- Run once in the Supabase SQL editor AFTER migration_live_tracker.sql.
-- Safe to paste and run more than once.
--
-- Customers often pay for one live's order, not their whole tab. A payment
-- with a live_id settles THAT live's cards first; a payment with no live_id
-- (all existing ones) still settles the customer's oldest cards first.
-- If the live is deleted the payment is kept, just no longer tied to a live.

alter table tracker_payments
  add column if not exists live_id uuid references tracker_lives (id) on delete set null;

create index if not exists tracker_payments_live_idx on tracker_payments (owner_id, live_id);
