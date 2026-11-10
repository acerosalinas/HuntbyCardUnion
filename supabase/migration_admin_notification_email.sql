-- Notification email for shops (admins).
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to paste and run more than once.
--
-- Notification emails (new offer, card claimed, ...) go to the address an admin
-- signs in with. This lets an admin choose a different inbox for them, without
-- changing the address they sign in with. Left empty, emails keep going to the
-- sign-in address.
--
-- It is a table of its own, NOT a column on seller_profiles: seller_profiles has
-- a public read policy (the storefront), and an email address must never be
-- readable by visitors. This table has row-level security on and NO policies,
-- so only the server (service role) can read or write it.

create table if not exists admin_settings (
  admin_id uuid primary key references auth.users (id) on delete cascade,
  notification_email text check (notification_email is null or (length(notification_email) <= 254 and notification_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  updated_at timestamptz not null default now()
);

alter table admin_settings enable row level security;
