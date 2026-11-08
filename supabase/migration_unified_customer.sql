-- One customer, two ledgers: shared parcels migration.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to paste and run more than once.
--
-- A marketplace order that goes out in the same parcel as a customer's live
-- cards remembers which Live Tracker shipment carried it, so undoing that
-- shipment can put the order back to "not shipped".

alter table card_claims add column if not exists tracker_shipment_id uuid references tracker_shipments (id) on delete set null;
create index if not exists card_claims_tracker_shipment_idx on card_claims (tracker_shipment_id) where tracker_shipment_id is not null;
