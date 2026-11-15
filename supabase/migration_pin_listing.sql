-- Pin a listing to the top of its seller's shop.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New query). Safe to paste and run more than once.
--
-- pinned_at is when the seller pinned the listing (null = not pinned). Pinned listings stay first in the seller's shop
-- and in their Inventory Manager, newest pin first, no matter how many listings are added after them.

alter table cards add column if not exists pinned_at timestamptz;
