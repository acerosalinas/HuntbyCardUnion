-- Live Tracker: customer portal, step 1 - link a tracker customer to a marketplace account.
-- Run once in the Supabase SQL editor AFTER migration_live_tracker.sql.
-- Safe to paste and run more than once.
--
-- A tracker customer is just a name you type during a live. Linking one to a
-- buyer account (profiles / auth.users) lets that person sign in and see ONLY
-- their own cards, balance and shipped status at /account/orders.
-- Unique per owner: one buyer account can be linked to one tracker customer
-- for you, so a login can never show two different people's orders.

alter table tracker_customers
  add column if not exists buyer_id uuid references auth.users (id) on delete set null;

create unique index if not exists tracker_customers_owner_buyer_idx
  on tracker_customers (owner_id, buyer_id)
  where buyer_id is not null;
