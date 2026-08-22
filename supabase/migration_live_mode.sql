-- MIGRATION: Live Mode speed setting.
--
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against your existing project. Safe to run more than once.
--
-- Adds live_mode_seconds to seller_profiles - how many seconds each card
-- shows for in "Live Mode" (components/LiveModeStack.tsx) on a seller's
-- public storefront. Mirrors the same change in supabase/schema.sql.

alter table seller_profiles add column if not exists live_mode_seconds int not null default 4;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'seller_profiles_live_mode_seconds_check'
  ) then
    alter table seller_profiles
      add constraint seller_profiles_live_mode_seconds_check check (live_mode_seconds between 1 and 30);
  end if;
end $$;
