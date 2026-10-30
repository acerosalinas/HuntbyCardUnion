-- Live Tracker: tell linked customers their invoice for a live is ready.
-- Run once in the Supabase SQL editor AFTER migration_live_tracker_portal.sql.
-- Safe to paste and run more than once.
--
-- Remembers, per live and customer, what they were last told (card count and total), so
-- pressing "Notify customers" twice only reaches people whose invoice has changed since.
-- Also lets the notifications table accept the new 'tracker_invoice_ready' type
-- (added NOT VALID so existing rows are never re-checked).

create table if not exists tracker_invoice_notices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  live_id uuid not null references tracker_lives (id) on delete cascade,
  customer_id uuid not null references tracker_customers (id) on delete cascade,
  notified_total numeric(12, 2) not null,
  notified_cards int not null,
  notified_at timestamptz not null default now(),
  unique (live_id, customer_id)
);
create index if not exists tracker_invoice_notices_owner_idx on tracker_invoice_notices (owner_id, live_id);

alter table tracker_invoice_notices enable row level security;

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
  'wishlist_added', 'tracker_invoice_ready'
)) not valid;
