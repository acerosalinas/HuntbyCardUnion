-- Marketplace installments migration.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to paste and run more than once.
--
-- A seller can switch "Allow installments" on for a listing. A buyer who has
-- claimed it (and not paid yet) can then ask to pay in 2-4 weekly installments
-- inside 4 weeks. The seller approves or declines the plan; once approved the
-- buyer sends a payment screenshot for each installment and the seller confirms
-- each one. The claim stays reserved (PENDING) until the installments add up to
-- the full price; the last confirmation marks it paid exactly like a normal
-- payment. Nothing here moves money: it records what was paid and when.
--
-- The three plan tables have row-level security on and NO policies, so only the
-- server (service role) reads or writes them. Screenshots go in the private
-- order-proofs bucket, same as full-payment proofs.

alter table cards add column if not exists allow_installments boolean not null default false;

create table if not exists claim_installment_plans (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null unique references card_claims (id) on delete cascade,
  status text not null default 'REQUESTED' check (status in ('REQUESTED', 'ACTIVE', 'DECLINED')),
  decline_reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists claim_installments (
  plan_id uuid not null references claim_installment_plans (id) on delete cascade,
  seq int not null check (seq between 1 and 4),
  due_date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  primary key (plan_id, seq)
);

create table if not exists claim_payments (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references card_claims (id) on delete cascade,
  buyer_id uuid not null references auth.users (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  proof_path text not null,
  note text,
  status text not null default 'PENDING' check (status in ('PENDING', 'CONFIRMED', 'REJECTED')),
  reject_reason text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists claim_payments_claim_idx on claim_payments (claim_id, status);

alter table claim_installment_plans enable row level security;
alter table claim_installments enable row level security;
alter table claim_payments enable row level security;
