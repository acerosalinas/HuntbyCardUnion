-- Live Tracker: GCash / Maribank payment QR images.
-- Run once in the Supabase SQL editor AFTER migration_live_tracker.sql.
-- Safe to paste and run more than once.
--
-- The images themselves live in the public R2 bucket (same one marketplace
-- payment QRs use); these columns only hold their public URLs.

alter table tracker_settings add column if not exists gcash_qr_url text;
alter table tracker_settings add column if not exists maribank_qr_url text;
