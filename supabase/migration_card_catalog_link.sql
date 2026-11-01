-- Links a marketplace listing to the shared Pokemon catalog card it was picked from, so the Live Tracker can
-- show "on the marketplace for PHP X" next to a card's live-sales history.
-- Run after migration_pokemon_catalog.sql. Until it is run, listings still save normally (just without the link).
alter table cards add column if not exists catalog_card_id text references pokemon_catalog_cards (id) on delete set null;
create index if not exists cards_catalog_card_idx on cards (catalog_card_id) where catalog_card_id is not null;
