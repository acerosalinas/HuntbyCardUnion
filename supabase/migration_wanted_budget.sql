-- Wanted cards: an optional budget ("under" or "over" an amount).
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to paste and run more than once.
--
-- A buyer asking for a card can say what they are willing to spend, so sellers
-- know whether it is worth chasing: "Under ₱500" (a ceiling) or "Over ₱500".
-- Both columns are empty when the buyer gives no budget. An amount must be more
-- than zero, and the two columns are set together or not at all.

alter table wanted_cards add column if not exists budget_amount numeric(12, 2);
alter table wanted_cards add column if not exists budget_type text;

alter table wanted_cards drop constraint if exists wanted_cards_budget_check;
alter table wanted_cards add constraint wanted_cards_budget_check check (
  (budget_amount is null and budget_type is null)
  or (budget_amount > 0 and budget_amount <= 10000000 and budget_type is not null and budget_type in ('UNDER', 'OVER'))
);
