-- Live Tracker: remember which buyers were told "a card you requested came up in a live", so one card never
-- notifies the same buyer twice. Run once in the Supabase SQL editor AFTER migration_pokemon_catalog.sql.
-- Safe to paste and run more than once.

create table if not exists tracker_wanted_notices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  wanted_id uuid not null references wanted_cards (id) on delete cascade,
  sale_id uuid not null references tracker_sales (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (wanted_id, sale_id)
);
create index if not exists tracker_wanted_notices_owner_idx on tracker_wanted_notices (owner_id);

alter table tracker_wanted_notices enable row level security;
