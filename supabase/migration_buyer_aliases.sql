-- Sub usernames: a private label an admin gives to a customer account (for example the name they use on Facebook or in a live).
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New query). Safe to paste and run more than once.
--
-- One row per admin per customer, so every admin keeps their own labels: store A's label for a customer is never shown to store B,
-- and the customer never sees any of them. Row-level security is on with NO policies, so only the server (service role) can read or
-- write this table, and the server only ever reads the signed-in admin's own rows.

create table if not exists buyer_aliases (
  admin_id uuid not null references auth.users (id) on delete cascade,
  buyer_id uuid not null references auth.users (id) on delete cascade,
  alias text not null check (char_length(alias) between 1 and 40),
  updated_at timestamptz not null default now(),
  primary key (admin_id, buyer_id)
);

create index if not exists buyer_aliases_admin_idx on buyer_aliases (admin_id, lower(alias));

alter table buyer_aliases enable row level security;
