-- Marketplace proof of payment migration.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to paste and run more than once.
--
-- A buyer with an unpaid (PENDING, prepaid) order can attach a screenshot of
-- their payment to it from My Dibs. The seller sees it next to the claim in
-- Pending Payments and confirms the payment as usual - nothing is marked paid
-- by the upload itself. One screenshot can cover several of the buyer's
-- claims from the same seller, so the same path may appear on more than one row.
-- Screenshots live in a PRIVATE bucket and are only shown through short-lived
-- signed links (same pattern as tracker-proofs and dispute-evidence).

alter table card_claims add column if not exists proof_path text;
alter table card_claims add column if not exists proof_uploaded_at timestamptz;
alter table card_claims add column if not exists proof_note text;

insert into storage.buckets (id, name, public)
values ('order-proofs', 'order-proofs', false)
on conflict (id) do nothing;
