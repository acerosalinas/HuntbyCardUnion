-- Vouches migration.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to paste and run more than once.
--
-- What this does: adds a `vouches` table - a short public comment (plus an
-- optional 1-5 star rating) an approved member leaves on the home page to
-- confirm the marketplace is legit. Everyone signed in can read the thread.
-- Members add and delete their own vouches straight from the browser through
-- RLS. Three protections live in the database, not the UI:
--   * the handle shown on a vouch is stamped from the member's own profile by
--     a trigger, so nobody can post under someone else's name;
--   * only approved accounts may post (same rule as wishlists/wanted cards);
--   * at most 3 vouches per member per rolling 24 hours.
-- To remove an abusive vouch as an admin, delete the row in the Table Editor.

create table if not exists vouches (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users (id) on delete cascade,
  buyer_handle text not null default '',
  message text not null check (char_length(btrim(message)) between 3 and 280),
  rating smallint check (rating between 1 and 5),
  created_at timestamptz not null default now()
);

create index if not exists vouches_created_at_idx on vouches (created_at desc);
create index if not exists vouches_buyer_id_idx on vouches (buyer_id, created_at desc);

alter table vouches enable row level security;

create or replace function public.stamp_vouch_handle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select handle into new.buyer_handle from public.profiles where id = new.buyer_id;
  if new.buyer_handle is null then
    raise exception 'No profile found for this account';
  end if;
  new.message := btrim(new.message);
  return new;
end;
$$;

revoke all on function public.stamp_vouch_handle() from public, anon, authenticated;

drop trigger if exists stamp_vouch_handle on vouches;
create trigger stamp_vouch_handle
  before insert on vouches
  for each row execute function public.stamp_vouch_handle();

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'vouches' and policyname = 'vouches are readable'
  ) then
    create policy "vouches are readable" on vouches for select using (true);
  end if;
end $$;

drop policy if exists "members can add their own vouches" on vouches;
create policy "members can add their own vouches" on vouches
  for insert to authenticated
  with check (
    auth.uid() = buyer_id
    and (
      select count(*) from vouches v
      where v.buyer_id = auth.uid() and v.created_at > now() - interval '24 hours'
    ) < 3
  );

drop policy if exists "approved accounts only" on public.vouches;
create policy "approved accounts only" on public.vouches
  as restrictive for insert to authenticated with check (public.is_approved());

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'vouches' and policyname = 'members can remove their own vouches'
  ) then
    create policy "members can remove their own vouches" on vouches
      for delete using (auth.uid() = buyer_id);
  end if;
end $$;
