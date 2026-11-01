-- Live Tracker: which cards (and who paid for them) each money handover covers.
-- Run once in the Supabase SQL editor AFTER migration_live_tracker_payouts.sql. Safe to run more than once.
--
-- A payout (handover) used to be just an amount and a date. This records the cards behind it, so you can see on
-- any handover date exactly which cards were settled and which customer paid for each. The card and customer
-- names are saved on the row too, so the record still reads correctly if a card or customer is renamed or
-- deleted later. Undoing a handover removes its cards, which makes them available to hand over again.

create table if not exists tracker_payout_cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  payout_id uuid not null references tracker_payouts (id) on delete cascade,
  sale_id uuid references tracker_sales (id) on delete set null,
  card_name text not null,
  customer_name text not null,
  -- How much of this card's collected money is in this handover.
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists tracker_payout_cards_payout_idx on tracker_payout_cards (payout_id);
create index if not exists tracker_payout_cards_sale_idx on tracker_payout_cards (owner_id, sale_id);

alter table tracker_payout_cards enable row level security;
-- No policies: only the server (service role) reads or writes this table.
