-- Live Tracker: tie a payment to the specific cards it paid for.
-- Run once in the Supabase SQL editor AFTER migration_live_tracker.sql.
-- Safe to paste and run more than once.
--
-- When a customer pays a certain amount, the cards it covers can be ticked
-- and recorded with the payment. Each row says "this much of that payment
-- went to that card". A payment with no rows here is applied automatically
-- (its live first, then the oldest cards), exactly as before.
-- Deleting the payment or the card removes the row, so nothing dangles.

create table if not exists tracker_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  payment_id uuid not null references tracker_payments (id) on delete cascade,
  sale_id uuid not null references tracker_sales (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0)
);

create index if not exists tracker_payment_allocations_payment_idx on tracker_payment_allocations (owner_id, payment_id);
create index if not exists tracker_payment_allocations_sale_idx on tracker_payment_allocations (sale_id);

alter table tracker_payment_allocations enable row level security;
