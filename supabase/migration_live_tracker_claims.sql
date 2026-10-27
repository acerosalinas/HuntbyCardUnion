-- Live Tracker: customer portal step 2 - proof-of-payment claims.
-- Run once in the Supabase SQL editor AFTER migration_live_tracker_portal.sql.
-- Safe to paste and run more than once.
--
-- A linked customer ticks the cards they paid for, uploads a screenshot and
-- sends a CLAIM. Nothing counts as paid until you confirm it: confirming
-- records a real payment tied to exactly those cards (and, if they included
-- it, a prepaid shipping-fee payment), inside one transaction.
-- Screenshots live in a PRIVATE bucket and are only ever shown to you through
-- short-lived signed links.

create table if not exists tracker_payment_claims (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  customer_id uuid not null references tracker_customers (id) on delete cascade,
  buyer_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING', 'CONFIRMED', 'REJECTED')),
  method text not null check (method in ('GCASH', 'MARIBANK')),
  cards_amount numeric(12, 2) not null default 0 check (cards_amount >= 0),
  sf_amount numeric(12, 2) not null default 0 check (sf_amount >= 0),
  check (cards_amount + sf_amount > 0),
  proof_path text not null,
  note text,
  reject_reason text,
  payment_id uuid references tracker_payments (id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists tracker_payment_claims_owner_idx on tracker_payment_claims (owner_id, status, created_at desc);
create index if not exists tracker_payment_claims_customer_idx on tracker_payment_claims (customer_id, status);

-- The cards a claim covers, and how much of the claim goes to each.
create table if not exists tracker_claim_cards (
  claim_id uuid not null references tracker_payment_claims (id) on delete cascade,
  sale_id uuid not null references tracker_sales (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  primary key (claim_id, sale_id)
);
create index if not exists tracker_claim_cards_sale_idx on tracker_claim_cards (sale_id);

alter table tracker_payment_claims enable row level security;
alter table tracker_claim_cards enable row level security;

-- Private bucket for the screenshots (same pattern as dispute-evidence).
insert into storage.buckets (id, name, public)
values ('tracker-proofs', 'tracker-proofs', false)
on conflict (id) do nothing;

-- Confirm a claim atomically: lock it, make sure it's still PENDING, record the
-- payment(s) tied to the claimed cards, and mark it CONFIRMED - all or nothing.
create or replace function tracker_confirm_claim(p_owner uuid, p_claim uuid, p_paid_on date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c tracker_payment_claims%rowtype;
  v_cards_payment uuid;
begin
  select * into c from tracker_payment_claims where id = p_claim and owner_id = p_owner for update;
  if not found then
    raise exception 'Claim not found.';
  end if;
  if c.status <> 'PENDING' then
    raise exception 'This claim was already reviewed.';
  end if;

  if c.cards_amount > 0 then
    insert into tracker_payments (owner_id, customer_id, amount, method, purpose, paid_on, note)
    values (p_owner, c.customer_id, c.cards_amount, c.method, 'CARDS', p_paid_on, 'Confirmed from customer proof')
    returning id into v_cards_payment;

    insert into tracker_payment_allocations (owner_id, payment_id, sale_id, amount)
    select p_owner, v_cards_payment, cc.sale_id, cc.amount from tracker_claim_cards cc where cc.claim_id = c.id;
  end if;

  if c.sf_amount > 0 then
    insert into tracker_payments (owner_id, customer_id, amount, method, purpose, paid_on, note)
    values (p_owner, c.customer_id, c.sf_amount, c.method, 'SHIPPING', p_paid_on, 'Shipping fee, confirmed from customer proof');
  end if;

  update tracker_payment_claims
  set status = 'CONFIRMED', reviewed_at = now(), payment_id = v_cards_payment
  where id = c.id;

  return v_cards_payment;
end;
$$;

revoke all on function tracker_confirm_claim(uuid, uuid, date) from public, anon, authenticated;
grant execute on function tracker_confirm_claim(uuid, uuid, date) to service_role;

-- Let the notifications table accept the three new tracker types. NOT VALID so
-- rows already in the table are never re-checked (only new rows must match).
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
  'tracker_proof_submitted', 'tracker_proof_confirmed', 'tracker_proof_rejected'
)) not valid;
