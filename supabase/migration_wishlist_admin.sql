-- Wishlist for admins: see hearted cards, mark them fulfilled, and get told about new entries.
-- Run once in the Supabase SQL editor. Safe to paste and run more than once.
--
-- * wishlists gets a status (OPEN / FULFILLED / CLOSED) so an admin can answer a buyer's
--   hearted card the same way they answer a "can't find it" request.
-- * wishlists and wanted_cards get notified_at: set the moment the admin alert for that
--   entry is sent, so one entry can never alert twice.
-- * notifications accepts the new 'wishlist_added' type (added NOT VALID so existing rows
--   are never re-checked).

alter table wishlists
  add column if not exists status text not null default 'OPEN' check (status in ('OPEN', 'FULFILLED', 'CLOSED'));
alter table wishlists add column if not exists notified_at timestamptz;
alter table wanted_cards add column if not exists notified_at timestamptz;

create index if not exists wishlists_status_idx on wishlists (status, created_at desc);

do $$
declare
  v_conname text;
begin
  select conname into v_conname
    from pg_constraint
    where conrelid = 'public.notifications'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%type = ANY%';
  if v_conname is not null then
    execute format('alter table notifications drop constraint %I', v_conname);
  end if;
end $$;

alter table notifications add constraint notifications_type_check check (type in (
  'offer_received', 'offer_countered', 'offer_accepted', 'offer_declined', 'offer_expired',
  'card_claimed', 'queue_promoted', 'claim_shipped',
  'wanted_card_fulfilled', 'wanted_card_closed', 'ship_requested',
  'payment_confirmed', 'listing_cancelled', 'dispute_opened',
  'dispute_withdrawn', 'dispute_response', 'dispute_under_review', 'dispute_resolved',
  'claim_cancelled_by_buyer', 'review_received', 'live_sale_assigned',
  'tracker_proof_submitted', 'tracker_proof_confirmed', 'tracker_proof_rejected',
  'wishlist_added'
)) not valid;
