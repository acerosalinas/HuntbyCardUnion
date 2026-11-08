-- Live Tracker: mark a confirmed payment proof as "distributed".
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to paste and run more than once.
--
-- Once a proof is confirmed, the money still has to be split between the card
-- owners. This records WHEN that was done for a proof, so everyone looking at
-- Proofs can tell which confirmed payments are already split and which are
-- still waiting. It is only a marker: the amounts handed to each owner are
-- still recorded on the Dashboard (tracker_payouts).

alter table tracker_payment_claims add column if not exists distributed_at timestamptz;
