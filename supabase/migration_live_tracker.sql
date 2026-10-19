-- Live Tracker migration.
-- Run once in the Supabase SQL editor against an EXISTING project. Safe to
-- paste and run more than once.
--
-- A standalone ledger for live-selling: customers, lives, the cards sold in
-- each live, payments (GCash / Maribank, possibly several per customer),
-- and shipments (one shipping fee per parcel). It does not touch cards,
-- card_claims, orders or disputes.
--
-- Every table is owner-scoped (owner_id = the admin who entered it). RLS is
-- enabled with NO policies on purpose: all access goes through Server
-- Actions using the service-role client, which filters by owner_id, so the
-- anon/authenticated keys can never read or write these tables directly.
--
-- Balances are never stored - they're always derived:
--   balance = sum(sales.amount) + sum(shipments.fee) - sum(payments.amount)

create table if not exists tracker_settings (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  luzon_fee numeric(12, 2) not null default 64 check (luzon_fee >= 0),
  visayas_mindanao_fee numeric(12, 2) not null default 94 check (visayas_mindanao_fee >= 0),
  payment_instructions text not null default '',
  show_address_on_invoice boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists tracker_customers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  region text,
  province_city text,
  barangay text,
  zip text,
  street text,
  island_group text check (island_group in ('LUZON', 'VISAYAS', 'MINDANAO')),
  created_at timestamptz not null default now()
);
create unique index if not exists tracker_customers_owner_name_idx on tracker_customers (owner_id, lower(btrim(name)));

create table if not exists tracker_lives (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  live_date date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists tracker_lives_owner_idx on tracker_lives (owner_id, live_date desc, created_at desc);

create table if not exists tracker_shipments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  customer_id uuid not null references tracker_customers (id) on delete restrict,
  shipped_on date not null default current_date,
  fee numeric(12, 2) not null default 0 check (fee >= 0),
  -- Snapshot of how much of this fee the customer's prepaid shipping credit
  -- covered when it was marked shipped. Informational only - balances never
  -- read it (see the file header).
  prepaid_applied numeric(12, 2) not null default 0 check (prepaid_applied >= 0),
  island_group text check (island_group in ('LUZON', 'VISAYAS', 'MINDANAO')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists tracker_shipments_customer_idx on tracker_shipments (owner_id, customer_id);

create table if not exists tracker_sales (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  customer_id uuid not null references tracker_customers (id) on delete restrict,
  live_id uuid not null references tracker_lives (id) on delete restrict,
  card_name text not null check (length(btrim(card_name)) between 1 and 200),
  amount numeric(12, 2) not null check (amount >= 0),
  for_shipping boolean not null default false,
  -- Non-null = shipped (as part of that parcel). on delete set null so
  -- undoing a shipment can never strand a card as "shipped".
  shipment_id uuid references tracker_shipments (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists tracker_sales_live_idx on tracker_sales (owner_id, live_id);
create index if not exists tracker_sales_customer_idx on tracker_sales (owner_id, customer_id);

create table if not exists tracker_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  customer_id uuid not null references tracker_customers (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  method text not null check (method in ('GCASH', 'MARIBANK')),
  -- SHIPPING = prepaid shipping fee, held as credit until a shipment uses it.
  purpose text not null default 'CARDS' check (purpose in ('CARDS', 'SHIPPING')),
  paid_on date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists tracker_payments_customer_idx on tracker_payments (owner_id, customer_id);

alter table tracker_settings enable row level security;
alter table tracker_customers enable row level security;
alter table tracker_lives enable row level security;
alter table tracker_shipments enable row level security;
alter table tracker_sales enable row level security;
alter table tracker_payments enable row level security;

-- Marks a set of a customer's cards as shipped in ONE parcel: creates the
-- shipment (one fee for the whole parcel) and links the cards, atomically.
-- The customer row is locked so two parcels being marked at once can't both
-- claim the same prepaid shipping credit.
--   credit = sum(SHIPPING payments) - sum(fees of earlier shipments), floored at 0
--   prepaid_applied = least(credit, this fee)
create or replace function tracker_mark_shipped(
  p_owner uuid,
  p_customer uuid,
  p_sale_ids uuid[],
  p_fee numeric,
  p_island_group text,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment uuid;
  v_paid numeric;
  v_fees numeric;
  v_credit numeric;
  v_count int;
begin
  if p_fee is null or p_fee < 0 then
    raise exception 'Shipping fee cannot be negative.';
  end if;
  if p_sale_ids is null or array_length(p_sale_ids, 1) is null then
    raise exception 'Select at least one card to ship.';
  end if;

  perform 1 from tracker_customers where id = p_customer and owner_id = p_owner for update;
  if not found then
    raise exception 'Customer not found.';
  end if;

  select count(*) into v_count
  from tracker_sales
  where id = any (p_sale_ids) and owner_id = p_owner and customer_id = p_customer and shipment_id is null;
  if v_count <> array_length(p_sale_ids, 1) then
    raise exception 'Some selected cards are missing, belong to another customer, or are already shipped.';
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from tracker_payments where owner_id = p_owner and customer_id = p_customer and purpose = 'SHIPPING';
  select coalesce(sum(fee), 0) into v_fees
  from tracker_shipments where owner_id = p_owner and customer_id = p_customer;
  v_credit := greatest(0, v_paid - v_fees);

  insert into tracker_shipments (owner_id, customer_id, fee, prepaid_applied, island_group, note)
  values (p_owner, p_customer, p_fee, least(v_credit, p_fee), p_island_group, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_shipment;

  update tracker_sales set shipment_id = v_shipment
  where id = any (p_sale_ids) and owner_id = p_owner;

  return v_shipment;
end;
$$;

-- Undoes a shipment (mis-click): the cards go back to "not shipped" via the
-- on-delete-set-null FK, and its fee disappears from the customer's balance.
create or replace function tracker_undo_shipment(p_owner uuid, p_shipment uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from tracker_shipments where id = p_shipment and owner_id = p_owner;
  if not found then
    raise exception 'Shipment not found.';
  end if;
end;
$$;

revoke all on function tracker_mark_shipped(uuid, uuid, uuid[], numeric, text, text) from public, anon, authenticated;
revoke all on function tracker_undo_shipment(uuid, uuid) from public, anon, authenticated;
grant execute on function tracker_mark_shipped(uuid, uuid, uuid[], numeric, text, text) to service_role;
grant execute on function tracker_undo_shipment(uuid, uuid) to service_role;
