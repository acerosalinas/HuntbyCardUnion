-- Order receipt tracking, buyer self-cancel, reviews, and rarity migration.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to paste and run more than once
-- - every statement is guarded to no-op if already applied.
--
-- What this does:
--  - cards gains a `rarity` text field (fixed dropdown in the app, no DB
--    enforcement - same convention as condition_grade).
--  - card_claims gains `received_at`, the final stage of a new My Dibs order
--    tracker (Pending Payment -> Paid -> Shipped -> Received).
--  - A new `reviews` table (public read) lets a buyer rate/review a purchase
--    once it's marked received.
--  - Three new buyer-facing RPCs: cancel_claim (self-cancel an unpaid
--    claim), mark_claim_received, submit_review.
--  - notifications.type gains two new values for this batch.

alter table cards add column if not exists rarity text;
update cards set rarity = 'Other' where rarity is null;
alter table cards alter column rarity set not null;
alter table cards alter column rarity set default 'Other';

alter table card_claims add column if not exists received_at timestamptz;

-- ---------------------------------------------------------------------------
-- reviews: a buyer's rating + optional comment on one specific purchase
-- (card_claims row), shown publicly on the seller's profile. Unlike
-- disputes, this is PUBLIC read (same shape as "offers are publicly
-- readable"/"dibs queue is publicly readable") - anyone browsing a seller's
-- profile needs to see these, not just the buyer who wrote them. One review
-- per claim - a plain unique index, not partial like disputes' - reviews
-- have no withdraw/reopen lifecycle, so a second row on the same claim is
-- never legitimate.
-- ---------------------------------------------------------------------------
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references card_claims (id) on delete cascade,
  card_id uuid not null references cards (id) on delete cascade,
  seller_admin_id uuid references auth.users (id) on delete set null,
  buyer_id uuid not null references auth.users (id) on delete cascade,
  buyer_handle text not null,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create unique index if not exists reviews_one_per_claim_idx on reviews (claim_id);
create index if not exists reviews_seller_admin_id_idx on reviews (seller_admin_id, created_at desc);
create index if not exists reviews_card_id_idx on reviews (card_id);

alter table reviews enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'reviews' and policyname = 'reviews are publicly readable'
  ) then
    create policy "reviews are publicly readable" on reviews for select using (true);
  end if;
end $$;

-- notifications.type gains two values for this batch. Looked up by
-- pg_constraint rather than a hardcoded guessed name - Postgres/Supabase's
-- auto-generated constraint name isn't guaranteed, and guessing wrong would
-- silently no-op.
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
  'offer_received', 'offer_countered', 'card_claimed', 'queue_promoted',
  'payment_confirmed', 'listing_cancelled', 'dispute_opened',
  'dispute_withdrawn', 'dispute_response', 'dispute_under_review', 'dispute_resolved',
  'claim_cancelled_by_buyer', 'review_received'
));

-- ---------------------------------------------------------------------------
-- cancel_claim: buyer self-cancel of a still-unpaid (PENDING) claim.
-- ---------------------------------------------------------------------------
create or replace function cancel_claim(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_claim card_claims;
  v_card cards;
  v_new_available int;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_claim from card_claims where id = p_claim_id for update;
  if not found or v_claim.buyer_id is distinct from v_buyer_id then
    raise exception 'Claim not found.';
  end if;
  if v_claim.status != 'PENDING' then
    raise exception 'This claim can no longer be cancelled - it has already been paid or cancelled.';
  end if;

  select * into v_card from cards where id = v_claim.card_id for update;
  if not found then
    raise exception 'Card not found.';
  end if;

  update card_claims set status = 'CANCELLED' where id = p_claim_id;

  v_new_available := v_card.quantity_available + v_claim.quantity;
  update cards
    set quantity_available = v_new_available,
        status = case when v_new_available > 0 then 'AVAILABLE' else 'SOLD' end,
        price = v_card.list_price
    where id = v_claim.card_id;

  update dibs_queue set status = 'CANCELLED' where card_id = v_claim.card_id and status = 'WAITING';

  if v_card.admin_id is not null then
    begin
      insert into notifications (recipient_id, type, title, body, link)
        values (
          v_card.admin_id,
          'claim_cancelled_by_buyer',
          'Buyer cancelled a claim',
          v_claim.buyer_handle || ' cancelled their claim on "' || v_card.title || '".',
          '/admin'
        );
    exception when others then null;
    end;
  end if;
end;
$$;

revoke execute on function cancel_claim(uuid) from public;
grant execute on function cancel_claim(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- mark_claim_received: the buyer confirms receipt - the final stage of the
-- My Dibs tracker, gating whether they can leave a review. Requires shipped
-- = true (the admin's "Shipped"/"Stashed" toggle) first, for every
-- fulfillment method including STASH, so the flow stays consistent.
-- ---------------------------------------------------------------------------
create or replace function mark_claim_received(p_claim_id uuid)
returns card_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_claim card_claims;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_claim from card_claims where id = p_claim_id for update;
  if not found or v_claim.buyer_id is distinct from v_buyer_id then
    raise exception 'Claim not found.';
  end if;
  if v_claim.status != 'SOLD' then
    raise exception 'This item has not been marked as paid yet.';
  end if;
  if not v_claim.shipped then
    raise exception 'This item has not been marked as shipped yet.';
  end if;
  if v_claim.received_at is not null then
    raise exception 'Already marked as received.';
  end if;

  update card_claims set received_at = now() where id = p_claim_id returning * into v_claim;
  return v_claim;
end;
$$;

revoke execute on function mark_claim_received(uuid) from public;
grant execute on function mark_claim_received(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- submit_review: the only entry point for creating a review.
-- ---------------------------------------------------------------------------
create or replace function submit_review(
  p_claim_id uuid,
  p_rating int,
  p_comment text default null
)
returns reviews
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_handle text;
  v_claim card_claims;
  v_card cards;
  v_review reviews;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select handle into v_handle from profiles where id = v_buyer_id;
  if not found then
    raise exception 'Buyer profile not found.';
  end if;

  if p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5.';
  end if;

  select * into v_claim from card_claims where id = p_claim_id;
  if not found or v_claim.buyer_id is distinct from v_buyer_id then
    raise exception 'You can only review an item you bought.';
  end if;
  if v_claim.status != 'SOLD' or v_claim.received_at is null then
    raise exception 'You can review this item once you have marked it received.';
  end if;

  select * into v_card from cards where id = v_claim.card_id;
  if not found then
    raise exception 'Card not found';
  end if;

  begin
    insert into reviews (claim_id, card_id, seller_admin_id, buyer_id, buyer_handle, rating, comment)
      values (p_claim_id, v_claim.card_id, v_card.admin_id, v_buyer_id, v_handle, p_rating, nullif(trim(p_comment), ''))
      returning * into v_review;
  exception when unique_violation then
    raise exception 'You already left a review for this item.';
  end;

  if v_card.admin_id is not null then
    begin
      insert into notifications (recipient_id, type, title, body, link)
        values (
          v_card.admin_id,
          'review_received',
          'New review received',
          v_handle || ' left a ' || p_rating || '-star review on "' || v_card.title || '".',
          '/admin'
        );
    exception when others then null;
    end;
  end if;

  return v_review;
end;
$$;

revoke execute on function submit_review(uuid, int, text) from public;
grant execute on function submit_review(uuid, int, text) to authenticated;
