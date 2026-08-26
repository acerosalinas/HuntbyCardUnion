-- Wanted Cards migration.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to paste and run more than once.
--
-- What this does: adds a `wanted_cards` table - a buyer's "can't find it"
-- request (card name + reference photo) for something not yet listed,
-- visible to every admin as a shared want-list. Like wishlists, buyer
-- writes go straight through RLS (no cross-table logic needed); admin reads
-- use the service-role client, not scoped per-admin since demand isn't
-- owned by any one seller.

create table if not exists wanted_cards (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users (id) on delete cascade,
  buyer_handle text not null,
  card_name text not null,
  photo_url text not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'FULFILLED', 'CLOSED')),
  created_at timestamptz not null default now()
);

create index if not exists wanted_cards_buyer_id_idx on wanted_cards (buyer_id, created_at desc);
create index if not exists wanted_cards_status_idx on wanted_cards (status, created_at desc);

alter table wanted_cards enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'wanted_cards' and policyname = 'buyers can view their own wanted cards'
  ) then
    create policy "buyers can view their own wanted cards" on wanted_cards
      for select using (auth.uid() = buyer_id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'wanted_cards' and policyname = 'buyers can add their own wanted cards'
  ) then
    create policy "buyers can add their own wanted cards" on wanted_cards
      for insert with check (auth.uid() = buyer_id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'wanted_cards' and policyname = 'buyers can remove their own wanted cards'
  ) then
    create policy "buyers can remove their own wanted cards" on wanted_cards
      for delete using (auth.uid() = buyer_id);
  end if;
end $$;
