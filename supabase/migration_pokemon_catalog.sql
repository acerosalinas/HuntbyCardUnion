-- Pokemon card catalog (name, set, number, image) used to autofill card names in the Live Tracker
-- (and, later, marketplace listings and wishlists). Filled by scripts/import-pokemon-catalog.mjs.
-- Run once in the Supabase SQL editor. Safe to paste and run more than once.

create table if not exists pokemon_catalog_cards (
  -- TCGdex card id, e.g. 'swsh3-136'
  id text primary key,
  lang text not null default 'en',
  name text not null,
  set_id text not null,
  set_name text not null,
  -- The number printed on the card within its set ('136', 'SWSH001', 'TG05')
  local_id text not null,
  -- Image address WITHOUT a quality/extension: add '/low.webp' or '/high.webp'. Null = no picture.
  image_url text,
  set_release date,
  -- Lower-case "name set_name local_id" so search is one ILIKE per typed word
  search text not null
);
create index if not exists pokemon_catalog_cards_set_idx on pokemon_catalog_cards (set_id);

-- Read through the server only (service role) for now; no public policies.
alter table pokemon_catalog_cards enable row level security;

-- A tracker card can remember which catalog card it was picked from. Optional: a typed name still works.
alter table tracker_sales add column if not exists catalog_card_id text references pokemon_catalog_cards (id) on delete set null;
