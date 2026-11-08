-- Allow a listing's quantity to be set to 0 (an explicitly sold-out listing).
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to paste and run more than once.
--
-- The listing form lets an admin set the quantity of an existing listing to 0,
-- which marks it Sold Out, but cards.quantity was constrained to > 0, so that
-- save failed. This relaxes it to >= 0. A NEW listing still needs at least 1
-- (checked by the form and the server action), and claims keep quantity > 0.

alter table cards drop constraint if exists cards_quantity_check;
alter table cards add constraint cards_quantity_check check (quantity >= 0);
