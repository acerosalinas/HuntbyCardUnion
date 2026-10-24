-- Live Tracker: "payment distributed" - money handed out to the card owners.
-- Run once in the Supabase SQL editor AFTER migration_live_tracker.sql.
-- Safe to paste and run more than once.
--
-- After a live, the money collected for each owner's cards (the Dashboard's
-- Actual column) is handed to that owner. A payout records how much was
-- given to whom, for which live, and when. recipient_tag is the card owner
-- code (e.g. A / S); null = cards with no owner tag.

create table if not exists tracker_payouts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- restrict: a live that has payouts recorded can't vanish from under them.
  live_id uuid not null references tracker_lives (id) on delete restrict,
  recipient_tag text check (recipient_tag is null or length(btrim(recipient_tag)) between 1 and 8),
  amount numeric(12, 2) not null check (amount > 0),
  paid_on date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists tracker_payouts_live_idx on tracker_payouts (owner_id, live_id);

alter table tracker_payouts enable row level security;
