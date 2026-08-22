-- MIGRATION 2 of 2: Bulk Upload / Rapid Fill draft cards.
--
-- Run this AFTER migration_draft_cards_1_add_enum_value.sql has finished
-- running (as its own, separate query) - not pasted together with it.
--
-- Hides DRAFT cards from every public/buyer-facing read in one place (the
-- marketplace, franchise pages, card detail, seller storefronts, Live
-- Mode) - admin reads are unaffected, they already bypass RLS entirely via
-- the service-role client. Safe to run more than once.

alter policy "cards are publicly readable" on cards using (status <> 'DRAFT');
