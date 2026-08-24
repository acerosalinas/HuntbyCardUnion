-- Pokemon TCG energy type migration.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to paste and run more than once.
--
-- What this does: cards gains a `pokemon_type` text field (Normal, Fire,
-- Water, ... - see lib/pokemonType.ts) - Pokemon-only, so it stays null for
-- every One Piece card and is never required. No CHECK constraint, same
-- convention as rarity/condition_grade: validated in the TS dropdown, not
-- the database.

alter table cards add column if not exists pokemon_type text;
