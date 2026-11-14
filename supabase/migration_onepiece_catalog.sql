-- One Piece Card Game catalog (name, set, code, rarity, picture) used to autofill a listing when the seller picks the One Piece franchise.
-- Filled by scripts/import-onepiece-catalog.mts from the free OPTCG API (optcgapi.com).
-- Run once in the Supabase SQL editor (Project -> SQL Editor -> New query). Safe to paste and run more than once.
--
-- One row is one printing: a parallel / alternate-art / manga version is its own row with its own picture.
-- Read through the server only (service role); row-level security is on with no policies.

create table if not exists onepiece_catalog_cards (
  -- The API's picture id: "OP01-001", or "OP01-001_p1" for a parallel printing
  id text primary key,
  -- The printed card code ("OP01-001")
  card_code text not null,
  name text not null,
  -- "Parallel", "Alternate Art", "Manga"... (null for the regular printing)
  variant text,
  set_id text not null,
  set_name text not null,
  -- The API's own rarity code: L, C, UC, R, SR, SEC, TR, PR
  rarity_code text not null,
  -- The shop's rarity tier (see lib/rarity.ts)
  rarity text not null,
  color text,
  card_type text,
  image_url text,
  -- Lower-case "name variant code set" so a search is one ILIKE per typed word
  search text not null
);

create index if not exists onepiece_catalog_cards_set_idx on onepiece_catalog_cards (set_id);
create index if not exists onepiece_catalog_cards_code_idx on onepiece_catalog_cards (card_code);

alter table onepiece_catalog_cards enable row level security;
