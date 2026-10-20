-- Live Tracker: "distributed" status for cards that are handed over, not shipped.
-- Run once in the Supabase SQL editor AFTER migration_live_tracker.sql.
-- Safe to paste and run more than once.
--
-- Cards flagged for shipping are completed by a shipment (shipment_id).
-- Cards NOT flagged for shipping are completed by being distributed
-- (handed to the buyer) - this timestamp. Null = not yet distributed.

alter table tracker_sales add column if not exists distributed_at timestamptz;
