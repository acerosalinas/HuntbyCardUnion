-- MIGRATION 1 of 2: Bulk Upload / Rapid Fill draft cards.
--
-- Run this FIRST, by itself, in the Supabase SQL editor. Then run
-- migration_draft_cards_2_update_policy.sql as a SEPARATE query afterwards -
-- Postgres won't let a new enum value be referenced by anything else until
-- this statement has actually committed (error 55P04 if you try to run both
-- in one paste/transaction, which is exactly what the Supabase SQL editor
-- does with a multi-statement paste).
--
-- Safe to run more than once.

alter type card_status add value if not exists 'DRAFT';
