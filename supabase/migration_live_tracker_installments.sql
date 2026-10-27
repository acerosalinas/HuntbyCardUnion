-- Live Tracker: installment plans (pay a card in parts on agreed dates).
-- Run once in the Supabase SQL editor AFTER migration_live_tracker_portal.sql.
-- Safe to paste and run more than once.
--
-- One plan per card (e.g. a 1,500 card: 750 now + 750 next week). A plan only
-- stores the SCHEDULE. Money is still recorded the normal way (payments tied to
-- cards), and the schedule is filled in order from what the card has paid so far,
-- so a plan can never disagree with the payments.
--
-- A customer REQUESTS a plan (status REQUESTED); you approve it (ACTIVE), edit it
-- first, or decline it. You can also enter one yourself, which starts ACTIVE.

create table if not exists tracker_installment_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  customer_id uuid not null references tracker_customers (id) on delete cascade,
  sale_id uuid not null references tracker_sales (id) on delete cascade,
  status text not null default 'ACTIVE' check (status in ('REQUESTED', 'ACTIVE', 'DECLINED', 'CANCELLED')),
  requested_by text not null default 'ADMIN' check (requested_by in ('CUSTOMER', 'ADMIN')),
  buyer_id uuid references auth.users (id) on delete set null,
  note text,
  decline_reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- A card can have only one open (requested or active) plan at a time.
create unique index if not exists tracker_installment_plans_open_idx
  on tracker_installment_plans (sale_id)
  where status in ('REQUESTED', 'ACTIVE');
create index if not exists tracker_installment_plans_owner_idx on tracker_installment_plans (owner_id, status);

create table if not exists tracker_plan_installments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references tracker_installment_plans (id) on delete cascade,
  seq int not null check (seq >= 1),
  due_date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  unique (plan_id, seq)
);

alter table tracker_installment_plans enable row level security;
alter table tracker_plan_installments enable row level security;

-- Create or replace a card's open plan in one transaction.
--   p_installments: [{"due_date": "2026-10-27", "amount": 750}, ...] in payment order
--   p_status: 'ACTIVE' (you entered / approved it) or 'REQUESTED' (the customer asked)
-- The parts must add up to the card's price and there must be 2 or more of them.
create or replace function tracker_set_plan(
  p_owner uuid,
  p_sale uuid,
  p_installments jsonb,
  p_status text,
  p_requested_by text,
  p_buyer uuid,
  p_note text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer uuid;
  v_price numeric;
  v_sum numeric;
  v_count int;
  v_plan uuid;
  v_existing text;
begin
  if p_status not in ('REQUESTED', 'ACTIVE') then
    raise exception 'Invalid plan status.';
  end if;

  select customer_id, amount into v_customer, v_price from tracker_sales where id = p_sale and owner_id = p_owner;
  if not found then
    raise exception 'Card not found.';
  end if;

  select count(*), coalesce(sum((e ->> 'amount')::numeric), 0) into v_count, v_sum from jsonb_array_elements(p_installments) e;
  if v_count < 2 or v_count > 12 then
    raise exception 'An installment plan needs between 2 and 12 payments.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_installments) e where (e ->> 'amount')::numeric <= 0) then
    raise exception 'Every payment must be more than zero.';
  end if;
  if abs(v_sum - v_price) > 0.01 then
    raise exception 'The payments must add up to the card price.';
  end if;

  select id, status into v_plan, v_existing from tracker_installment_plans
  where sale_id = p_sale and status in ('REQUESTED', 'ACTIVE') for update;

  if found then
    -- A customer can reword their own pending request, but can't overwrite a plan you already approved.
    if p_status = 'REQUESTED' and v_existing = 'ACTIVE' then
      raise exception 'This card already has an approved installment plan.';
    end if;
    delete from tracker_plan_installments where plan_id = v_plan;
    update tracker_installment_plans
    set status = p_status,
        note = nullif(btrim(coalesce(p_note, '')), ''),
        decline_reason = null,
        decided_at = case when p_status = 'ACTIVE' then now() else null end
    where id = v_plan;
  else
    insert into tracker_installment_plans (owner_id, customer_id, sale_id, status, requested_by, buyer_id, note, decided_at)
    values (p_owner, v_customer, p_sale, p_status, p_requested_by, p_buyer, nullif(btrim(coalesce(p_note, '')), ''),
            case when p_status = 'ACTIVE' then now() else null end)
    returning id into v_plan;
  end if;

  insert into tracker_plan_installments (plan_id, seq, due_date, amount)
  select v_plan, row_number() over (order by (e ->> 'due_date')::date, ord), (e ->> 'due_date')::date, (e ->> 'amount')::numeric
  from jsonb_array_elements(p_installments) with ordinality as t(e, ord);

  return v_plan;
end;
$$;

revoke all on function tracker_set_plan(uuid, uuid, jsonb, text, text, uuid, text) from public, anon, authenticated;
grant execute on function tracker_set_plan(uuid, uuid, jsonb, text, text, uuid, text) to service_role;
