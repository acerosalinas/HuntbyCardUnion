-- Live Tracker: card owner tags (A = AC, S = Shane, ...).
-- Run once in the Supabase SQL editor AFTER migration_live_tracker.sql.
-- Safe to paste and run more than once.
--
-- Each card can be tagged with a short owner code (whose card it is). The
-- code -> name labels live in tracker_settings.owner_labels so they can be
-- renamed without touching sales rows. Existing cards stay untagged (null).

alter table tracker_sales
  add column if not exists owner_tag text
  check (owner_tag is null or length(btrim(owner_tag)) between 1 and 8);

create index if not exists tracker_sales_owner_idx on tracker_sales (owner_id, live_id, owner_tag);

alter table tracker_settings
  add column if not exists owner_labels jsonb not null default '[{"code":"A","name":"AC"},{"code":"S","name":"Shane"}]'::jsonb;
