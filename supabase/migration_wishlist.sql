-- Wishlist ("save for later") migration.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to paste and run more than once.
--
-- What this does: adds a `wishlists` table (buyer_id, card_id) with RLS so
-- each buyer can only see/add/remove their own rows. Unlike claims/offers
-- this has no cross-table business logic or concurrency to protect, so it
-- skips the security-definer RPC layer entirely - the buyer's own browser
-- client inserts/deletes rows directly, guarded purely by RLS.

create table if not exists wishlists (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users (id) on delete cascade,
  card_id uuid not null references cards (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (buyer_id, card_id)
);

create index if not exists wishlists_buyer_id_idx on wishlists (buyer_id, created_at desc);

alter table wishlists enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'wishlists' and policyname = 'buyers can view their own wishlist'
  ) then
    create policy "buyers can view their own wishlist" on wishlists
      for select using (auth.uid() = buyer_id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'wishlists' and policyname = 'buyers can add to their own wishlist'
  ) then
    create policy "buyers can add to their own wishlist" on wishlists
      for insert with check (auth.uid() = buyer_id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'wishlists' and policyname = 'buyers can remove from their own wishlist'
  ) then
    create policy "buyers can remove from their own wishlist" on wishlists
      for delete using (auth.uid() = buyer_id);
  end if;
end $$;
