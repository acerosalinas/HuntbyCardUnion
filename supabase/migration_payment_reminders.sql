-- Payment reminders: a seller's "Remind everyone who owes" button on the Customers & Balances page.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New query). Safe to paste and run more than once.
--
-- Remembers, per seller and customer account, when they were last reminded, so nobody gets two reminders from the same seller within 24 hours.
-- Also lets the notifications table accept the new 'payment_reminder' type (added NOT VALID so existing rows are never re-checked).
-- Row-level security is on with no policies: only the server (service role) reads or writes this table.

create table if not exists payment_reminders (
  owner_id uuid not null references auth.users (id) on delete cascade,
  buyer_id uuid not null references auth.users (id) on delete cascade,
  reminded_at timestamptz not null default now(),
  total numeric(12, 2) not null default 0,
  primary key (owner_id, buyer_id)
);

alter table payment_reminders enable row level security;

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
  'wishlist_added', 'tracker_invoice_ready', 'payment_reminder'
)) not valid;
