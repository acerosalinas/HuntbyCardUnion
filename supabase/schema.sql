-- Dibs Platform schema
-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query).
--
-- IMPORTANT for an EXISTING project: don't run this whole file top-to-bottom
-- again - the primary blocks below use bare `create table`/`create policy`
-- and will error on objects that already exist. Instead, scroll to the
-- "MIGRATION for existing projects" and "MIGRATION 2: buyer accounts" blocks
-- near the end and run those (they're written with `if not exists` guards
-- and are safe to run once on a live database).

create extension if not exists "pgcrypto";

-- DRAFT: a bulk-uploaded card whose details haven't been filled in yet (see
-- Bulk Upload / Rapid Fill, app/admin/(dashboard)/inventory/bulk-upload) -
-- placeholder values only, never shown to buyers (see the "cards are
-- publicly readable" policy below). Publishing moves DRAFT -> AVAILABLE;
-- nothing transitions back into DRAFT - see lib/cardStatus.ts.
create type card_status as enum ('DRAFT', 'AVAILABLE', 'PENDING', 'SOLD');
create type queue_status as enum ('WAITING', 'PROMOTED', 'CANCELLED');

create table cards (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  set_name text not null,
  price numeric(10, 2) not null check (price > 0),
  -- The admin-set listing price, independent of `price` above. acceptOffer
  -- overwrites `price` with the negotiated amount but leaves this alone, so
  -- cancelRelist / promoteNextInQueue can restore the real listed price
  -- instead of leaving a fallen-through negotiated discount stuck on the
  -- card forever. createCard/updateCard always keep this in sync with
  -- whatever price the admin actually sets.
  list_price numeric(10, 2) not null check (list_price > 0),
  condition_grade text not null,
  -- Fixed dropdown vocabulary (see lib/rarity.ts's RARITIES) - plain text,
  -- no CHECK constraint, same convention as condition_grade above: card
  -- attribute fields are validated in the TS dropdown, not the database.
  rarity text not null default 'Other',
  -- Pokemon TCG energy type (see lib/pokemonType.ts) - Pokemon-only, unlike
  -- rarity there's no One Piece equivalent, so this stays null for every
  -- non-Pokemon card and is never required.
  pokemon_type text,
  -- CARD (default) or SEALED (booster box/pack, ETB, bundle - see
  -- lib/sealedType.ts). A sealed listing reuses this same table/claim
  -- pipeline rather than a parallel system; condition_grade/rarity above
  -- stay NOT NULL for it but hold fixed placeholder values the UI knows to
  -- never display for a sealed row.
  product_type text not null default 'CARD' check (product_type in ('CARD', 'SEALED')),
  sealed_type text check (sealed_type in ('BOOSTER_BOX', 'BOOSTER_PACK', 'ETB', 'BUNDLE')),
  constraint cards_product_type_sealed_type_check check (
    (product_type = 'SEALED' and sealed_type is not null)
    or (product_type = 'CARD' and sealed_type is null)
  ),
  images text[] not null default '{}',
  seller_handle text not null,
  seller_messenger text not null,
  status card_status not null default 'AVAILABLE',
  -- Total units ever listed (admin-editable) and how many remain unclaimed
  -- right now. Per-buyer claim state (who claimed how many, when, whether
  -- paid/shipped) lives in card_claims below, not on this row - a listing
  -- can have several different buyers holding claims on different units of
  -- the same row at once. status is kept in sync with quantity_available by
  -- every write path that changes it (place_order, confirmPaid,
  -- cancelRelist, promoteNextInQueue, acceptOffer): SOLD once it hits 0,
  -- back to AVAILABLE if a cancelled claim frees stock again.
  quantity integer not null default 1 check (quantity > 0),
  quantity_available integer not null default 1 check (quantity_available >= 0),
  is_flash_sale boolean not null default false,
  -- Owning admin (Supabase Auth user). Role lives in that user's
  -- app_metadata ('ADMIN' | 'SUPER_ADMIN'), set via the service-role Admin
  -- API - see lib/adminAuth.ts. Super admins see/manage every card
  -- regardless of admin_id; regular admins only see their own.
  admin_id uuid references auth.users (id) on delete set null,
  -- Franchise slug (e.g. 'pokemon', 'one-piece') - see lib/franchises.ts for
  -- the known list. Drives the homepage pedestal picker and per-franchise
  -- browse pages at /[franchise].
  franchise text,
  created_at timestamptz not null default now()
);

create index cards_admin_id_idx on cards (admin_id);
create index cards_franchise_idx on cards (franchise);

-- status is text + check rather than a real enum (see the notifications
-- comment below for why) since this list has already grown once
-- (PENDING/ACCEPTED/DECLINED/SUPERSEDED -> +COUNTERED/BUYER_DECLINED/
-- EXPIRED/FULFILLED once negotiation became multi-round - see MIGRATION 14).
-- counter_amount/agreed_amount: see MIGRATION 14's comment for the full
-- negotiation state machine.
create table offers (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards (id) on delete cascade,
  buyer_handle text not null,
  buyer_id uuid references auth.users (id) on delete set null,
  offered_amount numeric(10, 2) not null check (offered_amount > 0),
  note text,
  status text not null default 'PENDING' check (
    status in ('PENDING', 'COUNTERED', 'ACCEPTED', 'DECLINED', 'BUYER_DECLINED', 'EXPIRED', 'SUPERSEDED', 'FULFILLED')
  ),
  counter_amount numeric(10, 2),
  agreed_amount numeric(10, 2),
  created_at timestamptz not null default now()
);

create index offers_card_id_idx on offers (card_id);
create index offers_buyer_id_idx on offers (buyer_id);
create index cards_status_idx on cards (status);

-- ---------------------------------------------------------------------------
-- dibs_queue: buyers waiting in line for a card that doesn't have enough
-- units available to cover what they asked for. place_order() adds to this
-- queue instead of failing; the admin's "Next in Queue" action
-- (promoteNextInQueue in app/admin/actions.ts) pops the earliest WAITING
-- entry whose requested_quantity fits and turns it into a new card_claims row.
-- ---------------------------------------------------------------------------
create table dibs_queue (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards (id) on delete cascade,
  buyer_handle text not null,
  buyer_id uuid references auth.users (id) on delete set null,
  -- How many units this buyer is waiting for - place_order() queues the
  -- buyer's full ask when fewer than that many are currently available
  -- (all-or-nothing; no partial-fulfil-plus-queue-the-rest).
  requested_quantity integer not null default 1 check (requested_quantity > 0),
  -- Carried forward into the new card_claims row when promoteNextInQueue
  -- (app/admin/actions.ts) turns this queue entry into a real claim - see
  -- card_claims.fulfillment_method below.
  fulfillment_method text not null default 'SHIP' check (fulfillment_method in ('SHIP', 'STASH')),
  status queue_status not null default 'WAITING',
  created_at timestamptz not null default now()
);

create index dibs_queue_card_id_idx on dibs_queue (card_id, status);
create index dibs_queue_buyer_id_idx on dibs_queue (card_id, buyer_id, status);

-- ---------------------------------------------------------------------------
-- orders: a buyer's checkout receipt for one or more claims made together
-- via the cart ("Add to Cart" -> "Place Order"). card_claims link back via
-- card_claims.order_id. total_amount is a snapshot of what was actually
-- claimed (items that didn't have enough stock and went to the queue
-- instead aren't included), so it can differ from the sum of everything the
-- buyer put in their cart. confirmed_at is set once by
-- try_claim_order_confirmation() the moment every claim in the order has
-- been marked SOLD or cancelled - see that function below for why this
-- needs to be atomic.
-- ---------------------------------------------------------------------------
create table orders (
  id uuid primary key default gen_random_uuid(),
  buyer_handle text not null,
  buyer_id uuid references auth.users (id) on delete set null,
  total_amount numeric(10, 2) not null default 0,
  confirmed_at timestamptz,
  -- Shipping contact, collected once at checkout (see place_order below) and
  -- shared by every claim in the order regardless of fulfillment method -
  -- the buyer's address doesn't change per item, only whether a given claim
  -- needs one at all (see card_claims.fulfillment_method, which replaced a
  -- single whole-order fulfillment_method column here once a cart could mix
  -- Ship and Stash items). Nullable at the column level - historical orders
  -- predate this and can't be backfilled - but place_order requires
  -- name/phone for every new order, and address/zip whenever the order
  -- contains at least one Ship item.
  ship_name text,
  ship_phone text,
  ship_address text,
  ship_zip text,
  created_at timestamptz not null default now()
);

create index orders_buyer_handle_idx on orders (buyer_handle);

-- ---------------------------------------------------------------------------
-- card_claims: one row per buyer's claim on some quantity of a card's stock.
-- Replaces the old single current_claimant/claimant_id/claimed_at/order_id/
-- sold_at/shipped columns that used to live directly on `cards` - those
-- assumed exactly one buyer per row. cards.quantity_available is
-- incremented/decremented alongside these rows by place_order/confirmPaid/
-- cancelRelist/promoteNextInQueue/acceptOffer (see app/admin/actions.ts and
-- the place_order RPC below) rather than derived on the fly, so every write
-- path must keep the two in sync inside the same transaction.
-- ---------------------------------------------------------------------------
create table card_claims (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards (id) on delete cascade,
  order_id uuid references orders (id) on delete set null,
  buyer_handle text not null,
  buyer_id uuid references auth.users (id) on delete set null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10, 2) not null check (unit_price > 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'SOLD', 'CANCELLED')),
  claimed_at timestamptz not null default now(),
  confirmed_at timestamptz,
  shipped boolean not null default false,
  -- Buyer-set via mark_claim_received() once shipped = true - the final
  -- stage of the My Dibs order tracker (Pending Payment -> Paid -> Shipped ->
  -- Received), ahead of leaving a review (see reviews table further below).
  received_at timestamptz,
  -- Chosen per card at Add to Cart (not per order) - a single checkout can
  -- mix Ship and Stash claims, which is why this lives here instead of on
  -- `orders` (see the comment there). Locked in once placed; no buyer-facing
  -- way to change it after the fact.
  fulfillment_method text not null default 'SHIP' check (fulfillment_method in ('SHIP', 'STASH'))
);

create index card_claims_card_id_idx on card_claims (card_id, status);
create index card_claims_buyer_id_idx on card_claims (buyer_id);
create index card_claims_order_id_idx on card_claims (order_id);

alter table card_claims enable row level security;
create policy "buyers can view their own claims" on card_claims for select using (auth.uid() = buyer_id);
alter publication supabase_realtime add table card_claims;

-- ---------------------------------------------------------------------------
-- profiles: a buyer's verified identity. Created automatically by the
-- handle_new_user trigger below when someone signs up via
-- supabase.auth.signUp({ email, password, options: { data: { handle,
-- full_name } } }) - never inserted directly by app code. RLS is
-- owner-only: every public display site already reads a denormalized
-- buyer_handle TEXT column on offers/dibs_queue/orders/card_claims, so
-- nothing needs to publicly join profiles, and full_name (real PII, unlike
-- the pseudonymous handle) should never be world-readable.
-- Admin reads bypass RLS via the service-role client as usual.
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null check (handle ~ '^@[A-Za-z0-9_]{3,20}$'),
  full_name text not null,
  -- Saved shipping default, editable from /account/edit - checkout
  -- (place_order) pre-fills from these instead of asking every order, but
  -- a buyer can still override per-order without changing this default.
  ship_name text,
  ship_phone text,
  ship_address text,
  ship_zip text,
  created_at timestamptz not null default now()
);

create unique index profiles_handle_lower_idx on profiles (lower(handle));

-- Populates `profiles` on signup. Guarded on `raw_user_meta_data ? 'handle'`
-- so it's a no-op for admin accounts (created via
-- supabase.auth.admin.createUser with app_metadata only, no user_metadata) -
-- without this guard, admin account creation would fail the `handle not
-- null` constraint on every insert into auth.users.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.raw_user_meta_data ? 'handle' then
    insert into public.profiles (id, handle, full_name)
    values (new.id, new.raw_user_meta_data ->> 'handle', new.raw_user_meta_data ->> 'full_name');
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

alter table cards enable row level security;
alter table offers enable row level security;
alter table dibs_queue enable row level security;
alter table orders enable row level security;
alter table profiles enable row level security;

-- Public read access (private-marketplace-by-obscurity; no buyer accounts).
create policy "cards are publicly readable" on cards for select using (status <> 'DRAFT');
create policy "offers are publicly readable" on offers for select using (true);
create policy "dibs queue is publicly readable" on dibs_queue for select using (true);
-- orders carries real buyer PII (ship_name/ship_phone/ship_address/ship_zip -
-- see the orders table comment) added well after this comment block was
-- written and buyer accounts existed - "publicly readable" was never
-- actually revisited for it. No client code reads this table (buyer order
-- history goes through card_claims, already owner-scoped below; admin
-- reads go through the service-role client, which bypasses RLS anyway), so
-- this is owner-only.
create policy "buyers can view their own orders" on orders for select using (auth.uid() = buyer_id);
create policy "profiles are self-readable" on profiles for select using (auth.uid() = id);

-- No direct insert/update/delete policies are defined for the anon/
-- authenticated roles: all writes go through the security-definer RPCs
-- below, the handle_new_user trigger, or the service-role key used by admin
-- Server Actions (which bypasses RLS).

-- ---------------------------------------------------------------------------
-- In-app notifications. One table serves both buyers and admins - both are
-- plain auth.users rows, distinguished only by app_metadata.role, so
-- recipient_id needs no role column. Defined here (early, before any RPC)
-- because submit_offer/place_order/open_dispute/withdraw_dispute below all
-- insert into it directly. `type` is a text + check constraint rather than a
-- real enum (unlike card_status/dispute_status elsewhere in this file -
-- offer_status used to be one too, until MIGRATION 14 needed to grow its
-- value list and hit exactly the same problem): this list grows every time a
-- new event needs a notification,
-- and enums can't gain values inside the same transaction as other DDL,
-- which this idempotent-migration style relies on. No insert policy - every
-- insert comes from a security-definer RPC or the service-role client in
-- app/admin/actions.ts, both of which bypass RLS, same convention as every
-- other table here. The update policy (mark as read) is the one new
-- pattern: a buyer/admin can flip read_at on their own row directly,
-- without going through a Server Action or RPC.
-- ---------------------------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in (
    'offer_received', 'offer_countered', 'offer_accepted', 'offer_declined', 'offer_expired',
    'card_claimed', 'queue_promoted',
    'payment_confirmed', 'listing_cancelled', 'dispute_opened',
    'dispute_withdrawn', 'dispute_response', 'dispute_under_review', 'dispute_resolved',
    'claim_cancelled_by_buyer', 'review_received'
  )),
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_unread_idx
  on notifications (recipient_id, created_at desc) where read_at is null;
create index if not exists notifications_recipient_id_idx
  on notifications (recipient_id, created_at desc);

alter table notifications enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'notifications' and policyname = 'users can view their own notifications'
  ) then
    create policy "users can view their own notifications" on notifications
      for select using (auth.uid() = recipient_id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'notifications' and policyname = 'users can mark their own notifications read'
  ) then
    create policy "users can mark their own notifications read" on notifications
      for update using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- submit_offer: validates the 75%-100% price band and inserts the offer.
-- Identity comes from auth.uid() (a signed-in, email-confirmed buyer) - the
-- old p_buyer_handle text parameter is gone, so a buyer can no longer type
-- someone else's handle. Rate-limited per buyer id to blunt spam/abuse.
-- ---------------------------------------------------------------------------
drop function if exists submit_offer(uuid, text, numeric, text);

create or replace function submit_offer(
  p_card_id uuid,
  p_offered_amount numeric,
  p_note text default null
)
returns offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_handle text;
  v_card cards;
  v_offer offers;
  v_recent_count int;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select handle into v_handle from profiles where id = v_buyer_id;
  if not found then
    raise exception 'Buyer profile not found.';
  end if;

  if not exists (
    select 1 from auth.users where id = v_buyer_id and email_confirmed_at is not null
  ) then
    raise exception 'Please confirm your email before making an offer.';
  end if;

  select count(*) into v_recent_count
    from offers
    where buyer_id = v_buyer_id and created_at > now() - interval '1 minute';
  if v_recent_count >= 10 then
    raise exception 'Too many offers submitted - please wait a moment and try again';
  end if;

  select * into v_card from cards where id = p_card_id;

  if not found then
    raise exception 'Card not found';
  end if;

  if v_card.status = 'SOLD' then
    raise exception 'Card is already sold';
  end if;

  if p_offered_amount > v_card.price or p_offered_amount < v_card.price * 0.75 then
    raise exception 'Offer must be between 75%% and 100%% of the listed price';
  end if;

  insert into offers (card_id, buyer_id, buyer_handle, offered_amount, note)
    values (p_card_id, v_buyer_id, v_handle, p_offered_amount, p_note)
    returning * into v_offer;

  return v_offer;
end;
$$;

-- ---------------------------------------------------------------------------
-- place_order: the cart checkout. For each card in p_card_ids: claims it if
-- AVAILABLE, joins the queue if it's PENDING under someone else, or reports
-- it as already-yours/sold. All successfully-claimed cards are grouped into
-- one `orders` row (only created if at least one card was actually claimed),
-- so the client can send a single consolidated Messenger message instead of
-- one per card. Identity comes from auth.uid(), same as submit_offer above.
-- Rate-limited per buyer id.
--
-- Returns {orderId, total, items: [{cardId, title, result, price?, position?}]}
-- where result is one of: 'claimed' | 'queued' | 'already_yours' | 'sold' | 'not_found'.
-- ---------------------------------------------------------------------------
drop function if exists place_order(text, uuid[]);

create or replace function place_order(p_card_ids uuid[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_handle text;
  v_card_id uuid;
  v_card cards;
  v_position int;
  v_results jsonb := '[]'::jsonb;
  v_claimed_ids uuid[] := '{}';
  v_claimed_total numeric := 0;
  v_order_id uuid;
  v_recent_count int;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select handle into v_handle from profiles where id = v_buyer_id;
  if not found then
    raise exception 'Buyer profile not found.';
  end if;

  if not exists (
    select 1 from auth.users where id = v_buyer_id and email_confirmed_at is not null
  ) then
    raise exception 'Please confirm your email before placing an order.';
  end if;

  if p_card_ids is null or array_length(p_card_ids, 1) is null then
    raise exception 'Cart is empty';
  end if;

  select count(*) into v_recent_count
    from orders
    where buyer_id = v_buyer_id and created_at > now() - interval '1 minute';
  if v_recent_count >= 5 then
    raise exception 'Too many orders placed - please wait a moment and try again';
  end if;

  foreach v_card_id in array p_card_ids loop
    select * into v_card from cards where id = v_card_id for update;

    if not found then
      v_results := v_results || jsonb_build_object('cardId', v_card_id, 'result', 'not_found');
      continue;
    end if;

    if v_card.status = 'SOLD' then
      v_results := v_results || jsonb_build_object('cardId', v_card_id, 'title', v_card.title, 'result', 'sold');
    elsif v_card.status = 'PENDING' and v_card.claimant_id = v_buyer_id then
      v_results := v_results || jsonb_build_object('cardId', v_card_id, 'title', v_card.title, 'result', 'already_yours');
    elsif v_card.status = 'PENDING' then
      if not exists (
        select 1 from dibs_queue
        where card_id = v_card_id and buyer_id = v_buyer_id and status = 'WAITING'
      ) then
        select count(*) + 1 into v_position from dibs_queue where card_id = v_card_id and status = 'WAITING';
        insert into dibs_queue (card_id, buyer_id, buyer_handle) values (v_card_id, v_buyer_id, v_handle);
      else
        select count(*) into v_position
          from dibs_queue q
          where q.card_id = v_card_id and q.status = 'WAITING'
            and q.created_at <= (
              select created_at from dibs_queue
              where card_id = v_card_id and buyer_id = v_buyer_id and status = 'WAITING'
              limit 1
            );
      end if;
      v_results := v_results || jsonb_build_object('cardId', v_card_id, 'title', v_card.title, 'result', 'queued', 'position', v_position);
    else
      -- AVAILABLE: claim it as part of this order.
      v_claimed_ids := v_claimed_ids || v_card_id;
      v_claimed_total := v_claimed_total + v_card.price;
      v_results := v_results || jsonb_build_object('cardId', v_card_id, 'title', v_card.title, 'result', 'claimed', 'price', v_card.price);
    end if;
  end loop;

  if array_length(v_claimed_ids, 1) > 0 then
    insert into orders (buyer_id, buyer_handle, total_amount)
      values (v_buyer_id, v_handle, v_claimed_total) returning id into v_order_id;

    update cards
      set status = 'PENDING', current_claimant = v_handle, claimant_id = v_buyer_id,
          claimed_at = now(), order_id = v_order_id
      where id = any(v_claimed_ids);

    update offers
      set status = 'SUPERSEDED'
      where card_id = any(v_claimed_ids) and status = 'PENDING';
  end if;

  return jsonb_build_object('orderId', v_order_id, 'total', v_claimed_total, 'items', v_results);
end;
$$;

-- ---------------------------------------------------------------------------
-- try_claim_order_confirmation: called once per card from confirmPaid (a
-- per-card admin action) after marking that card SOLD, so a multi-card order
-- confirmed one card at a time still only sends ONE consolidated buyer email
-- - not one per card. This has to be atomic: a naive "update card, then
-- separately COUNT remaining unconfirmed siblings" from two independent
-- round-trips is racy (two cards confirmed in quick succession can both
-- observe "zero remaining" and both trigger an email). Postgres's row lock
-- on the `orders` row makes this exactly-once instead: the first concurrent
-- caller to reach it wins the lock, its WHERE matches (confirmed_at still
-- null, no PENDING siblings left), it commits and returns true; the second
-- caller blocks on the lock, then re-evaluates against the now-committed row
-- and matches nothing.
--
-- Not granted to anon/authenticated - only called from the service-role
-- admin client in confirmPaid.
-- ---------------------------------------------------------------------------
create or replace function try_claim_order_confirmation(p_order_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  update orders set confirmed_at = now()
    where id = p_order_id and confirmed_at is null
      and not exists (select 1 from cards where order_id = p_order_id and status = 'PENDING')
  returning true;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on new functions - explicit
-- revokes are required here, not just the grant below, or `anon` would
-- still be able to call submit_offer/place_order despite never appearing
-- in the grant list, and try_claim_order_confirmation would be callable by
-- anyone instead of only the service-role admin client.
revoke execute on function submit_offer(uuid, numeric, text) from public;
grant execute on function submit_offer(uuid, numeric, text) to authenticated;

revoke execute on function place_order(uuid[]) from public;
grant execute on function place_order(uuid[]) to authenticated;

revoke execute on function try_claim_order_confirmation(uuid) from public;

-- Enable Realtime so the client can subscribe to postgres_changes.
-- (dibs_queue is added to the publication further down, in the migration
-- block, guarded so this file is safe to run top-to-bottom on a fresh
-- project or paste as an incremental migration on an existing one.)
alter publication supabase_realtime add table cards;
alter publication supabase_realtime add table offers;

-- ---------------------------------------------------------------------------
-- Storage bucket for card images, uploaded from the admin Inventory tab.
-- Uploads go through a Server Action using the service-role key (bypasses
-- RLS), so no insert policy is needed here - only public read access so the
-- marketplace grid can display the images.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('card-images', 'card-images', true)
on conflict (id) do nothing;

create policy "public read access to card images"
on storage.objects for select
using (bucket_id = 'card-images');

-- ---------------------------------------------------------------------------
-- MIGRATION for existing projects that already ran the schema above without
-- the admin_id / franchise / queue / sale-tracking additions. Safe to run
-- once; no-ops if things already exist. New/fresh installs get all of this
-- from the blocks above and don't need to run it separately.
--
-- Note: the old dibs_expires_at column (from the 15-minute timer) is left in
-- place, just unused - dropping it isn't necessary and avoids a destructive
-- migration for no benefit.
-- ---------------------------------------------------------------------------
alter table cards add column if not exists admin_id uuid references auth.users (id) on delete set null;
create index if not exists cards_admin_id_idx on cards (admin_id);

alter table cards add column if not exists franchise text;
create index if not exists cards_franchise_idx on cards (franchise);

alter table cards add column if not exists sold_at timestamptz;
alter table cards add column if not exists shipped boolean not null default false;
alter table cards add column if not exists claimed_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'queue_status') then
    create type queue_status as enum ('WAITING', 'PROMOTED', 'CANCELLED');
  end if;
end $$;

create table if not exists dibs_queue (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards (id) on delete cascade,
  buyer_handle text not null,
  status queue_status not null default 'WAITING',
  created_at timestamptz not null default now()
);

create index if not exists dibs_queue_card_id_idx on dibs_queue (card_id, status);

alter table dibs_queue enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'dibs_queue' and policyname = 'dibs queue is publicly readable'
  ) then
    create policy "dibs queue is publicly readable" on dibs_queue for select using (true);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dibs_queue'
  ) then
    alter publication supabase_realtime add table dibs_queue;
  end if;
end $$;

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  buyer_handle text not null,
  total_amount numeric(10, 2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists orders_buyer_handle_idx on orders (buyer_handle);

alter table cards add column if not exists order_id uuid references orders (id) on delete set null;
create index if not exists cards_order_id_idx on cards (order_id);

alter table orders enable row level security;

-- Was "orders are publicly readable" (using (true)) - tightened to
-- owner-only once ship_name/ship_phone/ship_address/ship_zip made that a
-- real PII leak. Drops the old insecure policy if a prior run of this
-- block already created it, then creates the replacement if missing.
do $$ begin
  if exists (
    select 1 from pg_policies where tablename = 'orders' and policyname = 'orders are publicly readable'
  ) then
    drop policy "orders are publicly readable" on orders;
  end if;
  if not exists (
    select 1 from pg_policies where tablename = 'orders' and policyname = 'buyers can view their own orders'
  ) then
    create policy "buyers can view their own orders" on orders for select using (auth.uid() = buyer_id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table orders;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- MIGRATION 2: buyer accounts, verification, and order-confirmation
-- notifications. Safe to run once on an existing project; no-ops on a fresh
-- install that already got all of this from the primary blocks above.
--
-- Run this whole block in the Supabase SQL editor. Afterward, any card
-- currently sitting in the Pending Payments tab should ideally be confirmed
-- or canceled/relisted before buyers start using the new sign-up flow - a
-- card left PENDING from before this migration has no claimant_id, so that
-- specific buyer's "is this already mine" check (now identity-based) won't
-- recognize their own pre-existing claim. Not dangerous, just a possible
-- confusing re-queue for whoever's mid-claim at cutover.
-- ---------------------------------------------------------------------------

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null check (handle ~ '^@[A-Za-z0-9_]{3,20}$'),
  full_name text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_handle_lower_idx on profiles (lower(handle));

alter table profiles enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'profiles' and policyname = 'profiles are self-readable'
  ) then
    create policy "profiles are self-readable" on profiles for select using (auth.uid() = id);
  end if;
end $$;

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.raw_user_meta_data ? 'handle' then
    insert into public.profiles (id, handle, full_name)
    values (new.id, new.raw_user_meta_data ->> 'handle', new.raw_user_meta_data ->> 'full_name');
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

alter table cards add column if not exists claimant_id uuid references auth.users (id) on delete set null;
create index if not exists cards_claimant_id_idx on cards (claimant_id);

alter table offers add column if not exists buyer_id uuid references auth.users (id) on delete set null;
create index if not exists offers_buyer_id_idx on offers (buyer_id);

alter table dibs_queue add column if not exists buyer_id uuid references auth.users (id) on delete set null;
create index if not exists dibs_queue_buyer_id_idx on dibs_queue (card_id, buyer_id, status);

alter table orders add column if not exists buyer_id uuid references auth.users (id) on delete set null;
alter table orders add column if not exists confirmed_at timestamptz;

drop function if exists claim_dibs(uuid, text);
drop function if exists submit_offer(uuid, text, numeric, text);
drop function if exists place_order(text, uuid[]);

create or replace function submit_offer(
  p_card_id uuid,
  p_offered_amount numeric,
  p_note text default null
)
returns offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_handle text;
  v_card cards;
  v_offer offers;
  v_recent_count int;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select handle into v_handle from profiles where id = v_buyer_id;
  if not found then
    raise exception 'Buyer profile not found.';
  end if;

  if not exists (
    select 1 from auth.users where id = v_buyer_id and email_confirmed_at is not null
  ) then
    raise exception 'Please confirm your email before making an offer.';
  end if;

  select count(*) into v_recent_count
    from offers
    where buyer_id = v_buyer_id and created_at > now() - interval '1 minute';
  if v_recent_count >= 10 then
    raise exception 'Too many offers submitted - please wait a moment and try again';
  end if;

  select * into v_card from cards where id = p_card_id;

  if not found then
    raise exception 'Card not found';
  end if;

  if v_card.status = 'SOLD' then
    raise exception 'Card is already sold';
  end if;

  if p_offered_amount > v_card.price or p_offered_amount < v_card.price * 0.75 then
    raise exception 'Offer must be between 75%% and 100%% of the listed price';
  end if;

  insert into offers (card_id, buyer_id, buyer_handle, offered_amount, note)
    values (p_card_id, v_buyer_id, v_handle, p_offered_amount, p_note)
    returning * into v_offer;

  if v_card.admin_id is not null then
    begin
      insert into notifications (recipient_id, type, title, body, link)
        values (
          v_card.admin_id,
          'offer_received',
          'New offer received',
          v_handle || ' offered ' || p_offered_amount || ' on "' || v_card.title || '".',
          '/admin/offers'
        );
    exception when others then null;
    end;
  end if;

  return v_offer;
end;
$$;

-- Dropped explicitly: create or replace can't change an existing function's
-- parameter list (it would just create a second overload alongside the old
-- one instead of replacing it), and every prior signature this name has had
-- has to actually be gone before the current one takes over the name.
drop function if exists place_order(uuid[]);
drop function if exists place_order(uuid[], text, text, text, text, text);
drop function if exists place_order(jsonb, text, text, text, text, text);

-- ---------------------------------------------------------------------------
-- place_order: the cart checkout. p_items is a jsonb array of
-- {"card_id": uuid, "quantity": int, "fulfillment_method": "SHIP"|"STASH"}
-- objects - fulfillment is chosen per card at Add to Cart, not once for the
-- whole order, so one checkout can mix Ship and Stash claims (see
-- card_claims.fulfillment_method). For each item: claims that many units if
-- quantity_available covers the full request, or joins the queue for the
-- buyer's full requested quantity otherwise (all-or-nothing - no partial
-- claim + queue the remainder, so a buyer's queue position always means
-- "waiting for this many units", never a fraction of one order). All
-- successfully-claimed items are grouped into one `orders` row (only kept if
-- at least one item was actually claimed), so the client can send a single
-- consolidated Messenger message instead of one per card. Identity comes
-- from auth.uid(), same as submit_offer above. Rate-limited per buyer id.
--
-- Returns {orderId, total, items: [{cardId, title, result, price?,
-- quantity?, position?}]} where result is one of:
-- 'claimed' | 'queued' | 'not_found' (a DRAFT or missing card id).
-- ---------------------------------------------------------------------------
create or replace function place_order(
  p_items jsonb,
  p_ship_name text,
  p_ship_phone text,
  p_ship_address text,
  p_ship_zip text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_handle text;
  v_item jsonb;
  v_card_id uuid;
  v_qty int;
  v_fulfillment text;
  v_card cards;
  v_position int;
  v_results jsonb := '[]'::jsonb;
  v_claim_card_ids uuid[] := '{}';
  v_claim_quantities int[] := '{}';
  v_claim_prices numeric[] := '{}';
  v_claim_fulfillments text[] := '{}';
  v_claimed_total numeric := 0;
  v_needs_shipping boolean := false;
  v_order_id uuid;
  v_recent_count int;
  i int;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select handle into v_handle from profiles where id = v_buyer_id;
  if not found then
    raise exception 'Buyer profile not found.';
  end if;

  if not exists (
    select 1 from auth.users where id = v_buyer_id and email_confirmed_at is not null
  ) then
    raise exception 'Please confirm your email before placing an order.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  if p_ship_name is null or trim(p_ship_name) = '' or p_ship_phone is null or trim(p_ship_phone) = '' then
    raise exception 'Name and phone number are required to check out.';
  end if;

  select count(*) into v_recent_count
    from orders
    where buyer_id = v_buyer_id and created_at > now() - interval '1 minute';
  if v_recent_count >= 5 then
    raise exception 'Too many orders placed - please wait a moment and try again';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_card_id := (v_item ->> 'card_id')::uuid;
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::int, 1));
    v_fulfillment := coalesce(v_item ->> 'fulfillment_method', 'SHIP');
    if v_fulfillment not in ('SHIP', 'STASH') then
      v_fulfillment := 'SHIP';
    end if;

    select * into v_card from cards where id = v_card_id for update;

    if not found or v_card.status = 'DRAFT' then
      v_results := v_results || jsonb_build_object('cardId', v_card_id, 'result', 'not_found');
      continue;
    end if;

    if v_card.quantity_available >= v_qty then
      update cards
        set quantity_available = quantity_available - v_qty,
            -- A `case` expression's branches resolve to plain text, not the
            -- card_status enum, even when every branch is a valid label -
            -- unlike a bare `status = 'SOLD'` literal (which Postgres can
            -- infer against the target column's type), this needs an
            -- explicit cast or the update fails with "column "status" is of
            -- type card_status but expression is of type text".
            status = (case when quantity_available - v_qty <= 0 then 'SOLD' else 'AVAILABLE' end)::card_status
        where id = v_card_id;

      v_claim_card_ids := v_claim_card_ids || v_card_id;
      v_claim_quantities := v_claim_quantities || v_qty;
      v_claim_prices := v_claim_prices || v_card.price;
      v_claim_fulfillments := v_claim_fulfillments || v_fulfillment;
      v_claimed_total := v_claimed_total + (v_card.price * v_qty);
      if v_fulfillment = 'SHIP' then
        v_needs_shipping := true;
      end if;
      v_results := v_results || jsonb_build_object(
        'cardId', v_card_id, 'title', v_card.title, 'result', 'claimed', 'price', v_card.price, 'quantity', v_qty
      );
    else
      if not exists (
        select 1 from dibs_queue
        where card_id = v_card_id and buyer_id = v_buyer_id and status = 'WAITING'
      ) then
        select count(*) + 1 into v_position from dibs_queue where card_id = v_card_id and status = 'WAITING';
        insert into dibs_queue (card_id, buyer_id, buyer_handle, requested_quantity, fulfillment_method)
          values (v_card_id, v_buyer_id, v_handle, v_qty, v_fulfillment);
      else
        select count(*) into v_position
          from dibs_queue q
          where q.card_id = v_card_id and q.status = 'WAITING'
            and q.created_at <= (
              select created_at from dibs_queue
              where card_id = v_card_id and buyer_id = v_buyer_id and status = 'WAITING'
              limit 1
            );
      end if;
      v_results := v_results || jsonb_build_object(
        'cardId', v_card_id, 'title', v_card.title, 'result', 'queued', 'position', v_position, 'quantity', v_qty
      );
    end if;
  end loop;

  if array_length(v_claim_card_ids, 1) > 0 then
    if v_needs_shipping and (
      p_ship_address is null or trim(p_ship_address) = '' or p_ship_zip is null or trim(p_ship_zip) = ''
    ) then
      raise exception 'Shipping address and zip code are required to ship your cards.';
    end if;

    insert into orders (
      buyer_id, buyer_handle, total_amount,
      ship_name, ship_phone, ship_address, ship_zip
    )
      values (
        v_buyer_id, v_handle, v_claimed_total,
        p_ship_name, p_ship_phone, p_ship_address, p_ship_zip
      ) returning id into v_order_id;

    for i in 1..array_length(v_claim_card_ids, 1) loop
      insert into card_claims (card_id, order_id, buyer_id, buyer_handle, quantity, unit_price, status, fulfillment_method)
        values (
          v_claim_card_ids[i], v_order_id, v_buyer_id, v_handle,
          v_claim_quantities[i], v_claim_prices[i], 'PENDING', v_claim_fulfillments[i]
        );
    end loop;

    update offers
      set status = 'SUPERSEDED'
      where card_id = any(v_claim_card_ids) and status = 'PENDING';

    -- One notification per admin whose card(s) got claimed in this order, not
    -- one per card - mirrors the existing "one consolidated Messenger
    -- message per seller" behavior for a cart spanning multiple cards.
    begin
      insert into notifications (recipient_id, type, title, body, link)
        select
          c.admin_id,
          'card_claimed',
          count(*) || ' card(s) claimed',
          v_handle || ' claimed ' || count(*) || ' card(s) from your listings.',
          '/admin'
        from cards c
        where c.id = any(v_claim_card_ids) and c.admin_id is not null
        group by c.admin_id;
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('orderId', v_order_id, 'total', v_claimed_total, 'items', v_results);
end;
$$;

-- ---------------------------------------------------------------------------
-- try_claim_order_confirmation: called once per claim from confirmPaid (a
-- per-claim admin action) after marking that claim SOLD, so a multi-card
-- order confirmed one claim at a time still only sends ONE consolidated
-- buyer email - not one per claim. This has to be atomic: a naive "update
-- order, then separately COUNT remaining unconfirmed siblings" from two
-- independent round-trips is racy (two claims confirmed in quick succession
-- can both observe "zero remaining" and both trigger an email). Postgres's
-- row lock on the `orders` row makes this exactly-once instead: the first
-- concurrent caller to reach it wins the lock, its WHERE matches
-- (confirmed_at still null, no PENDING claims left), it commits and returns
-- true; the second caller blocks on the lock, then re-evaluates against the
-- now-committed row and matches nothing.
--
-- Not granted to anon/authenticated - only called from the service-role
-- admin client in confirmPaid.
-- ---------------------------------------------------------------------------
create or replace function try_claim_order_confirmation(p_order_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  update orders set confirmed_at = now()
    where id = p_order_id and confirmed_at is null
      and not exists (select 1 from card_claims where order_id = p_order_id and status = 'PENDING')
  returning true;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on new functions - explicit
-- revokes are required here, not just the grant below, or `anon` would
-- still be able to call submit_offer/place_order despite never appearing
-- in the grant list, and try_claim_order_confirmation would be callable by
-- anyone instead of only the service-role admin client.
revoke execute on function submit_offer(uuid, numeric, text) from public;
grant execute on function submit_offer(uuid, numeric, text) to authenticated;

revoke execute on function place_order(jsonb, text, text, text, text) from public;
grant execute on function place_order(jsonb, text, text, text, text) to authenticated;

revoke execute on function try_claim_order_confirmation(uuid) from public;

-- ---------------------------------------------------------------------------
-- MIGRATION 3: In-app dispute & evidence portal. Safe to run once; no-ops on
-- re-run. Purely additive (new tables/types/functions only, no changes to
-- existing tables' primary definitions), so - unlike MIGRATION 2 - there's
-- no separate "fresh install" copy of this block: this one block is correct
-- for both a brand-new project and an existing one.
--
-- "Seller" in this app has no account of its own (see cards.admin_id /
-- seller_handle comments above) - disputes route the seller side to
-- whichever admin owns the card, via seller_admin_id below.
-- ---------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'dispute_status') then
    create type dispute_status as enum ('OPEN', 'SELLER_RESPONDED', 'UNDER_REVIEW', 'RESOLVED_REFUND', 'RESOLVED_DISMISSED');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'dispute_reason') then
    create type dispute_reason as enum ('ITEM_NOT_RECEIVED', 'NOT_AS_DESCRIBED', 'DAMAGED_IN_TRANSIT', 'OTHER');
  end if;
end $$;

create table if not exists disputes (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards (id) on delete cascade,
  -- The specific claim (some quantity of this card, bought by this buyer)
  -- the dispute is about - a card can have several buyers each holding
  -- their own claim, so "this buyer bought this card" alone (card_id +
  -- buyer_id) is no longer unambiguous once the same buyer can also
  -- legitimately buy the same card twice in separate orders. Nullable only
  -- for disputes opened before this column existed.
  claim_id uuid references card_claims (id) on delete cascade,
  -- Denormalized for display only - never used in any ownership/RLS
  -- decision. One order can span cards from multiple admins; a dispute is
  -- always scoped to a single claim, so seller_admin_id (below) is always
  -- unambiguous regardless of what order_id points at.
  order_id uuid references orders (id) on delete set null,
  buyer_id uuid not null references auth.users (id) on delete cascade,
  -- Snapshot of cards.admin_id at the moment the dispute was opened.
  -- admin_id never changes post-creation today, so this stays stable and
  -- lets assertOwnsOrSuper check the dispute row directly without
  -- re-joining to cards. If a "reassign listing to another admin" feature
  -- is ever added, existing disputes intentionally keep pointing at the
  -- original admin - the dispute is about what happened under them.
  seller_admin_id uuid references auth.users (id) on delete set null,
  reason dispute_reason not null,
  description text not null,
  status dispute_status not null default 'OPEN',
  resolution_note text,
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists disputes_buyer_id_idx on disputes (buyer_id);
create index if not exists disputes_card_id_idx on disputes (card_id);
create index if not exists disputes_seller_admin_id_idx on disputes (seller_admin_id);
create index if not exists disputes_status_idx on disputes (status);

-- Backstop against a double-submit race: open_dispute()'s own "no existing
-- open dispute" check is a read-then-write and can't fully prevent two
-- concurrent calls from both passing it before either commits. This partial
-- unique index makes the second insert fail instead; open_dispute() catches
-- that as a friendly error rather than a raw constraint violation. Scoped to
-- claim_id (one purchase), not (card_id, buyer_id) - Postgres unique indexes
-- treat NULLs as distinct, so historical disputes with no claim_id (opened
-- before this column existed) are naturally exempt rather than colliding.
create unique index if not exists one_open_dispute_per_claim
  on disputes (claim_id)
  where status not in ('RESOLVED_REFUND', 'RESOLVED_DISMISSED');

-- ---------------------------------------------------------------------------
-- dispute_evidence: one unified chronological timeline per dispute, serving
-- both photo evidence AND text-only responses/notes from either side (a
-- pure admin reply with no file just has storage_path null - the check
-- constraint requires at least a file or a note, never neither).
-- ---------------------------------------------------------------------------
create table if not exists dispute_evidence (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references disputes (id) on delete cascade,
  uploaded_by uuid not null references auth.users (id) on delete cascade,
  uploader_role text not null check (uploader_role in ('BUYER', 'ADMIN')),
  storage_path text,
  file_name text,
  content_type text,
  note text,
  created_at timestamptz not null default now(),
  check (storage_path is not null or note is not null)
);

create index if not exists dispute_evidence_dispute_id_idx on dispute_evidence (dispute_id);

alter table disputes enable row level security;
alter table dispute_evidence enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'disputes' and policyname = 'buyers can view their own disputes'
  ) then
    create policy "buyers can view their own disputes" on disputes for select using (auth.uid() = buyer_id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'dispute_evidence' and policyname = 'buyers can view evidence on their own disputes'
  ) then
    create policy "buyers can view evidence on their own disputes" on dispute_evidence
      for select using (
        exists (select 1 from disputes d where d.id = dispute_evidence.dispute_id and d.buyer_id = auth.uid())
      );
  end if;
end $$;

-- No insert/update/delete policies for anon/authenticated on either table -
-- buyer writes go through the security-definer RPCs below; admin writes go
-- through the service-role client in app/admin/actions.ts. Same convention
-- as every other table in this schema.

-- ---------------------------------------------------------------------------
-- Private storage bucket for dispute evidence photos. Deliberately NOT
-- public, and deliberately has NO storage.objects policies at all: RLS is
-- enabled by default on storage.objects with zero policies, which is
-- default-deny for every role except service_role (which bypasses RLS
-- entirely) - combined with public=false (blocks the unauthenticated
-- CDN-style URL path too), nothing can read or write this bucket except the
-- service-role client. Reads happen via short-lived signed URLs minted
-- server-side after an application-level ownership check - see
-- app/account/disputes/[id]/page.tsx and
-- app/admin/(dashboard)/disputes/[id]/page.tsx. This is a different pattern
-- from the public `card-images` bucket above, by design.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('dispute-evidence', 'dispute-evidence', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- open_dispute: the only entry point for creating a dispute. Identity comes
-- from auth.uid() (signed-in, email-confirmed buyer), same as
-- submit_offer/place_order. Takes a specific claim (not just a card id),
-- since a card can now have several buyers each holding their own claim -
-- and even the same buyer can legitimately hold two separate claims on the
-- same card from different orders, so "this buyer bought this card" alone
-- is no longer specific enough to know which purchase the dispute is about.
-- Eligibility: the claim must be SOLD (tracing the rest of this schema, a
-- claim only ever becomes SOLD via the admin confirmPaid action, so SOLD
-- already implies payment was confirmed) and belong to the caller. Capped
-- at 2 lifetime disputes per claim regardless of outcome, to prevent
-- repeat-filing abuse after a dismissal, plus the usual per-buyer rate
-- limit.
--
-- Parameter types are unchanged from the pre-quantity version (uuid,
-- dispute_reason, text) but the name changes (p_card_id -> p_claim_id), and
-- Postgres won't let create or replace rename a parameter even when the
-- types match - the function has to be dropped first.
-- ---------------------------------------------------------------------------
drop function if exists open_dispute(uuid, dispute_reason, text);

create or replace function open_dispute(
  p_claim_id uuid,
  p_reason dispute_reason,
  p_description text
)
returns disputes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_claim card_claims;
  v_card cards;
  v_recent_count int;
  v_lifetime_count int;
  v_dispute disputes;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  if not exists (select 1 from profiles where id = v_buyer_id) then
    raise exception 'Buyer profile not found.';
  end if;

  if not exists (
    select 1 from auth.users where id = v_buyer_id and email_confirmed_at is not null
  ) then
    raise exception 'Please confirm your email before opening a dispute.';
  end if;

  select * into v_claim from card_claims where id = p_claim_id;
  if not found or v_claim.status != 'SOLD' or v_claim.buyer_id is distinct from v_buyer_id then
    raise exception 'You can only open a dispute for an item you bought.';
  end if;

  select * into v_card from cards where id = v_claim.card_id;
  if not found then
    raise exception 'Card not found';
  end if;

  select count(*) into v_lifetime_count
    from disputes where claim_id = p_claim_id;
  if v_lifetime_count >= 2 then
    raise exception 'You have reached the maximum number of disputes for this item. Please contact admin directly.';
  end if;

  select count(*) into v_recent_count
    from disputes
    where buyer_id = v_buyer_id and created_at > now() - interval '1 hour';
  if v_recent_count >= 5 then
    raise exception 'Too many disputes opened - please wait a moment and try again';
  end if;

  begin
    insert into disputes (card_id, claim_id, order_id, buyer_id, seller_admin_id, reason, description)
      values (v_claim.card_id, p_claim_id, v_claim.order_id, v_buyer_id, v_card.admin_id, p_reason, p_description)
      returning * into v_dispute;
  exception when unique_violation then
    raise exception 'You already have an open dispute for this item.';
  end;

  if v_card.admin_id is not null then
    begin
      insert into notifications (recipient_id, type, title, body, link)
        values (
          v_card.admin_id,
          'dispute_opened',
          'New dispute opened',
          'A buyer opened a dispute on "' || v_card.title || '".',
          '/admin/disputes/' || v_dispute.id::text
        );
    exception when others then null;
    end;
  end if;

  return v_dispute;
end;
$$;

revoke execute on function open_dispute(uuid, dispute_reason, text) from public;
grant execute on function open_dispute(uuid, dispute_reason, text) to authenticated;

-- ---------------------------------------------------------------------------
-- withdraw_dispute: lets a buyer retract their own dispute, but only while
-- it's still OPEN - once admin has responded or escalated it, only admin
-- can resolve it from there.
-- ---------------------------------------------------------------------------
create or replace function withdraw_dispute(p_dispute_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_dispute disputes;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_dispute from disputes where id = p_dispute_id for update;
  if not found or v_dispute.buyer_id is distinct from v_buyer_id then
    raise exception 'Dispute not found.';
  end if;
  if v_dispute.status != 'OPEN' then
    raise exception 'This dispute can no longer be withdrawn - it is already being handled.';
  end if;

  update disputes
    set status = 'RESOLVED_DISMISSED', resolution_note = 'Withdrawn by buyer', resolved_at = now()
    where id = p_dispute_id;

  if v_dispute.seller_admin_id is not null then
    begin
      insert into notifications (recipient_id, type, title, body, link)
        values (
          v_dispute.seller_admin_id,
          'dispute_withdrawn',
          'Dispute withdrawn',
          'The buyer withdrew their dispute.',
          '/admin/disputes/' || p_dispute_id::text
        );
    exception when others then null;
    end;
  end if;
end;
$$;

revoke execute on function withdraw_dispute(uuid) from public;
grant execute on function withdraw_dispute(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- MIGRATION 4: list_price. Safe to run once on an existing project - backfills
-- list_price from the current price (best-effort baseline; if a card is
-- currently sitting at a negotiated-down price from a past accepted offer,
-- there's no way to recover the true original, same as every other
-- no-backfill-possible case in this file - not attempted).
-- ---------------------------------------------------------------------------
alter table cards add column if not exists list_price numeric(10, 2);
update cards set list_price = price where list_price is null;
alter table cards alter column list_price set not null;
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'cards_list_price_check'
  ) then
    alter table cards add constraint cards_list_price_check check (list_price > 0);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- MIGRATION 5: seller_profiles. Safe to run once on an existing project -
-- uses `create table if not exists` / `if not exists` guards throughout.
--
-- A "seller" is just an existing admin account (auth.users row with
-- app_metadata.role of ADMIN/SUPER_ADMIN, see lib/adminAuth.ts) with a
-- public-facing profile layered on top - no new account type. Reads are
-- public (this is the "Seller Spotlight" shown on the home page, /sellers,
-- and card detail pages); writes only ever go through the requireAdmin()
-- Server Actions in app/admin/actions.ts using the service-role client,
-- same convention as every other admin write in this app - so there is
-- intentionally no insert/update/delete policy here.
-- ---------------------------------------------------------------------------
create table if not exists seller_profiles (
  admin_id uuid primary key references auth.users (id) on delete cascade,
  handle text not null unique,
  display_name text not null,
  bio text,
  avatar_url text,
  -- Free-form tags for what they sell (e.g. 'pokemon', 'one-piece', 'sports') -
  -- independent of cards.franchise, shown on the spotlight card as chips.
  tags text[] not null default '{}',
  facebook_url text,
  instagram_url text,
  messenger_username text,
  -- GCash/bank QR code image - shown to a buyer on the order confirmation
  -- screen (right alongside "Message Seller") so they don't have to wait on
  -- a Messenger reply just to find out how to pay.
  payment_qr_url text,
  -- Cash on Delivery: a seller opts in and picks one fixed weekday as their
  -- regular COD shipping day - any COD order goes out on the next
  -- occurrence of that weekday (see lib/codSchedule.ts), regardless of
  -- which day it was actually placed. Nothing here triggers real shipping -
  -- same as everywhere else in this app, it's a displayed schedule the
  -- seller fulfills themselves, not logistics automation.
  cod_enabled boolean not null default false,
  cod_weekday smallint check (cod_weekday between 0 and 6),
  -- Stamped by markPricesReviewed(); the admin dashboard banner fires when
  -- this is older than 7 days (see lib/priceReview.ts). No cron needed -
  -- purely computed on read.
  price_reviewed_at timestamptz not null default now(),
  -- Seconds each card shows for in "Live Mode" (components/LiveModeStack.tsx)
  -- on the seller's public storefront - a seller-controlled visual aid for
  -- live-selling streams, not something viewers can adjust themselves.
  live_mode_seconds int not null default 4 check (live_mode_seconds between 1 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- create table if not exists is a no-op on an already-existing seller_profiles
-- table (from before Live Mode shipped), so the new column needs its own
-- guard for projects that already ran MIGRATION 5.
alter table seller_profiles add column if not exists live_mode_seconds int not null default 4;
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'seller_profiles_live_mode_seconds_check'
  ) then
    alter table seller_profiles
      add constraint seller_profiles_live_mode_seconds_check check (live_mode_seconds between 1 and 30);
  end if;
end $$;

create index if not exists seller_profiles_handle_idx on seller_profiles (handle);

alter table seller_profiles enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'seller_profiles' and policyname = 'seller_profiles_select_all'
  ) then
    create policy "seller_profiles_select_all" on seller_profiles for select using (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- MIGRATION 6: card stock quantity + card_claims. Safe to run once on an
-- existing project; no-ops on re-run. Multiple buyers can now each claim
-- some quantity of a card's stock instead of exactly one buyer claiming the
-- whole row - see card_claims below, which replaces the old single
-- current_claimant/claimant_id/claimed_at/order_id/sold_at/shipped columns
-- that used to live directly on `cards`. Existing PENDING/SOLD cards are
-- backfilled into one card_claims row each (quantity 1, matching the
-- single-unit assumption every card had before this migration) so
-- historical claims/sales survive the cutover, before the now-redundant
-- columns are dropped from `cards`.
-- ---------------------------------------------------------------------------

alter table cards add column if not exists quantity integer not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cards_quantity_check') then
    alter table cards add constraint cards_quantity_check check (quantity > 0);
  end if;
end $$;

alter table cards add column if not exists quantity_available integer;
update cards set quantity_available = case when status = 'AVAILABLE' then 1 else 0 end
  where quantity_available is null;
alter table cards alter column quantity_available set not null;
alter table cards alter column quantity_available set default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cards_quantity_available_check') then
    alter table cards add constraint cards_quantity_available_check check (quantity_available >= 0);
  end if;
end $$;

alter table dibs_queue add column if not exists requested_quantity integer not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'dibs_queue_requested_quantity_check') then
    alter table dibs_queue add constraint dibs_queue_requested_quantity_check check (requested_quantity > 0);
  end if;
end $$;

create table if not exists card_claims (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards (id) on delete cascade,
  order_id uuid references orders (id) on delete set null,
  buyer_handle text not null,
  buyer_id uuid references auth.users (id) on delete set null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10, 2) not null check (unit_price > 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'SOLD', 'CANCELLED')),
  claimed_at timestamptz not null default now(),
  confirmed_at timestamptz,
  shipped boolean not null default false,
  -- Buyer-set via mark_claim_received() once shipped = true - the final
  -- stage of the My Dibs order tracker (Pending Payment -> Paid -> Shipped ->
  -- Received), ahead of leaving a review (see reviews table further below).
  received_at timestamptz,
  -- Chosen per card at Add to Cart (not per order) - a single checkout can
  -- mix Ship and Stash claims, which is why this lives here instead of on
  -- `orders` (see the comment there). Locked in once placed; no buyer-facing
  -- way to change it after the fact.
  fulfillment_method text not null default 'SHIP' check (fulfillment_method in ('SHIP', 'STASH'))
);

create index if not exists card_claims_card_id_idx on card_claims (card_id, status);
create index if not exists card_claims_buyer_id_idx on card_claims (buyer_id);
create index if not exists card_claims_order_id_idx on card_claims (order_id);

alter table card_claims enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'card_claims' and policyname = 'buyers can view their own claims'
  ) then
    create policy "buyers can view their own claims" on card_claims for select using (auth.uid() = buyer_id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'card_claims'
  ) then
    alter publication supabase_realtime add table card_claims;
  end if;
end $$;

-- One claim row per already-claimed card (PENDING or SOLD), synthesized
-- from the columns being dropped below. Guarded by a not-already-backfilled
-- check so this whole migration stays safe to paste and run more than once.
insert into card_claims (card_id, order_id, buyer_handle, buyer_id, quantity, unit_price, status, claimed_at, confirmed_at, shipped)
select
  id, order_id, current_claimant, claimant_id, 1, price,
  case status when 'SOLD' then 'SOLD' else 'PENDING' end,
  coalesce(claimed_at, created_at),
  sold_at,
  shipped
from cards
where status in ('PENDING', 'SOLD')
  and current_claimant is not null
  and not exists (select 1 from card_claims where card_claims.card_id = cards.id);

alter table cards drop column if exists current_claimant;
alter table cards drop column if exists claimant_id;
alter table cards drop column if exists claimed_at;
alter table cards drop column if exists order_id;
alter table cards drop column if exists sold_at;
alter table cards drop column if exists shipped;

alter table disputes add column if not exists claim_id uuid references card_claims (id) on delete cascade;

do $$ begin
  if exists (select 1 from pg_indexes where indexname = 'one_open_dispute_per_card_buyer') then
    drop index one_open_dispute_per_card_buyer;
  end if;
end $$;

create unique index if not exists one_open_dispute_per_claim
  on disputes (claim_id)
  where status not in ('RESOLVED_REFUND', 'RESOLVED_DISMISSED');

-- ---------------------------------------------------------------------------
-- MIGRATION 7: order receipt tracking, buyer self-cancel, reviews, rarity.
-- Safe to run once on an existing project; no-ops on re-run.
-- ---------------------------------------------------------------------------

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
  -- Snapshot of cards.admin_id at review time, same pattern as
  -- disputes.seller_admin_id - lets the seller profile page query by
  -- admin_id directly without joining cards.
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

-- No insert/update/delete policy - writes only via submit_review() below,
-- same convention as every other table in this schema.

-- notifications.type gains two values for this batch. Looked up by
-- pg_constraint rather than a hardcoded guessed name (e.g.
-- 'notifications_type_check') - Postgres/Supabase's auto-generated
-- constraint name isn't guaranteed, and guessing wrong would silently no-op.
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
-- SOLD claims aren't self-cancellable that way - once paid, a retraction is
-- a dispute/refund matter, not a plain cancel. Replicates cancelRelist's
-- stock-restore logic (app/admin/actions.ts) in PL/pgSQL since RPCs can't
-- call a Server Action: releases the claimed quantity back to
-- quantity_available, resets price to list_price, cancels the card's
-- dibs_queue, and notifies the owning admin.
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
        -- Needs an explicit cast - see the matching comment in place_order.
        status = (case when v_new_available > 0 then 'AVAILABLE' else 'SOLD' end)::card_status,
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
-- submit_review: the only entry point for creating a review. Mirrors
-- open_dispute's shape - identity via auth.uid(), ownership + eligibility
-- checks, best-effort notification insert. Eligible once a claim has been
-- marked received (see mark_claim_received above).
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

-- ---------------------------------------------------------------------------
-- MIGRATION 8: per-card Ship/Stash choice. Safe to run once on an existing
-- project; no-ops on re-run. Fulfillment method moves from a single
-- whole-order column to a per-claim (and per-queue-entry) column, since a
-- cart can now mix Ship and Stash items in one checkout - see the comments
-- on card_claims.fulfillment_method and orders in the primary blocks above.
-- ---------------------------------------------------------------------------

alter table dibs_queue add column if not exists fulfillment_method text not null default 'SHIP';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'dibs_queue_fulfillment_method_check') then
    alter table dibs_queue add constraint dibs_queue_fulfillment_method_check check (fulfillment_method in ('SHIP', 'STASH'));
  end if;
end $$;

alter table card_claims add column if not exists fulfillment_method text;
update card_claims cc set fulfillment_method = o.fulfillment_method
  from orders o
  where cc.order_id = o.id and cc.fulfillment_method is null and o.fulfillment_method is not null;
update card_claims set fulfillment_method = 'SHIP' where fulfillment_method is null;
alter table card_claims alter column fulfillment_method set not null;
alter table card_claims alter column fulfillment_method set default 'SHIP';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'card_claims_fulfillment_method_check') then
    alter table card_claims add constraint card_claims_fulfillment_method_check check (fulfillment_method in ('SHIP', 'STASH'));
  end if;
end $$;

alter table orders drop column if exists fulfillment_method;

drop function if exists place_order(jsonb, text, text, text, text, text);

create or replace function place_order(
  p_items jsonb,
  p_ship_name text,
  p_ship_phone text,
  p_ship_address text,
  p_ship_zip text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_handle text;
  v_item jsonb;
  v_card_id uuid;
  v_qty int;
  v_fulfillment text;
  v_card cards;
  v_position int;
  v_results jsonb := '[]'::jsonb;
  v_claim_card_ids uuid[] := '{}';
  v_claim_quantities int[] := '{}';
  v_claim_prices numeric[] := '{}';
  v_claim_fulfillments text[] := '{}';
  v_claimed_total numeric := 0;
  v_needs_shipping boolean := false;
  v_order_id uuid;
  v_recent_count int;
  i int;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select handle into v_handle from profiles where id = v_buyer_id;
  if not found then
    raise exception 'Buyer profile not found.';
  end if;

  if not exists (
    select 1 from auth.users where id = v_buyer_id and email_confirmed_at is not null
  ) then
    raise exception 'Please confirm your email before placing an order.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  if p_ship_name is null or trim(p_ship_name) = '' or p_ship_phone is null or trim(p_ship_phone) = '' then
    raise exception 'Name and phone number are required to check out.';
  end if;

  select count(*) into v_recent_count
    from orders
    where buyer_id = v_buyer_id and created_at > now() - interval '1 minute';
  if v_recent_count >= 5 then
    raise exception 'Too many orders placed - please wait a moment and try again';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_card_id := (v_item ->> 'card_id')::uuid;
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::int, 1));
    v_fulfillment := coalesce(v_item ->> 'fulfillment_method', 'SHIP');
    if v_fulfillment not in ('SHIP', 'STASH') then
      v_fulfillment := 'SHIP';
    end if;

    select * into v_card from cards where id = v_card_id for update;

    if not found or v_card.status = 'DRAFT' then
      v_results := v_results || jsonb_build_object('cardId', v_card_id, 'result', 'not_found');
      continue;
    end if;

    if v_card.quantity_available >= v_qty then
      update cards
        set quantity_available = quantity_available - v_qty,
            status = (case when quantity_available - v_qty <= 0 then 'SOLD' else 'AVAILABLE' end)::card_status
        where id = v_card_id;

      v_claim_card_ids := v_claim_card_ids || v_card_id;
      v_claim_quantities := v_claim_quantities || v_qty;
      v_claim_prices := v_claim_prices || v_card.price;
      v_claim_fulfillments := v_claim_fulfillments || v_fulfillment;
      v_claimed_total := v_claimed_total + (v_card.price * v_qty);
      if v_fulfillment = 'SHIP' then
        v_needs_shipping := true;
      end if;
      v_results := v_results || jsonb_build_object(
        'cardId', v_card_id, 'title', v_card.title, 'result', 'claimed', 'price', v_card.price, 'quantity', v_qty
      );
    else
      if not exists (
        select 1 from dibs_queue
        where card_id = v_card_id and buyer_id = v_buyer_id and status = 'WAITING'
      ) then
        select count(*) + 1 into v_position from dibs_queue where card_id = v_card_id and status = 'WAITING';
        insert into dibs_queue (card_id, buyer_id, buyer_handle, requested_quantity, fulfillment_method)
          values (v_card_id, v_buyer_id, v_handle, v_qty, v_fulfillment);
      else
        select count(*) into v_position
          from dibs_queue q
          where q.card_id = v_card_id and q.status = 'WAITING'
            and q.created_at <= (
              select created_at from dibs_queue
              where card_id = v_card_id and buyer_id = v_buyer_id and status = 'WAITING'
              limit 1
            );
      end if;
      v_results := v_results || jsonb_build_object(
        'cardId', v_card_id, 'title', v_card.title, 'result', 'queued', 'position', v_position, 'quantity', v_qty
      );
    end if;
  end loop;

  if array_length(v_claim_card_ids, 1) > 0 then
    if v_needs_shipping and (
      p_ship_address is null or trim(p_ship_address) = '' or p_ship_zip is null or trim(p_ship_zip) = ''
    ) then
      raise exception 'Shipping address and zip code are required to ship your cards.';
    end if;

    insert into orders (
      buyer_id, buyer_handle, total_amount,
      ship_name, ship_phone, ship_address, ship_zip
    )
      values (
        v_buyer_id, v_handle, v_claimed_total,
        p_ship_name, p_ship_phone, p_ship_address, p_ship_zip
      ) returning id into v_order_id;

    for i in 1..array_length(v_claim_card_ids, 1) loop
      insert into card_claims (card_id, order_id, buyer_id, buyer_handle, quantity, unit_price, status, fulfillment_method)
        values (
          v_claim_card_ids[i], v_order_id, v_buyer_id, v_handle,
          v_claim_quantities[i], v_claim_prices[i], 'PENDING', v_claim_fulfillments[i]
        );
    end loop;

    update offers
      set status = 'SUPERSEDED'
      where card_id = any(v_claim_card_ids) and status = 'PENDING';

    begin
      insert into notifications (recipient_id, type, title, body, link)
        select
          c.admin_id,
          'card_claimed',
          count(*) || ' card(s) claimed',
          v_handle || ' claimed ' || count(*) || ' card(s) from your listings.',
          '/admin'
        from cards c
        where c.id = any(v_claim_card_ids) and c.admin_id is not null
        group by c.admin_id;
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('orderId', v_order_id, 'total', v_claimed_total, 'items', v_results);
end;
$$;

revoke execute on function place_order(jsonb, text, text, text, text) from public;
grant execute on function place_order(jsonb, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- MIGRATION 9: Pokemon TCG energy type. Safe to run once on an existing
-- project; no-ops on re-run.
-- ---------------------------------------------------------------------------

alter table cards add column if not exists pokemon_type text;

-- ---------------------------------------------------------------------------
-- MIGRATION 10: Wishlists ("save for later"). Safe to run once on an
-- existing project; no-ops on re-run. Unlike claims/offers this has no
-- cross-table business logic or concurrency to protect, so - unlike every
-- other buyer write in this file - it skips the security-definer RPC layer
-- entirely: the buyer's own browser client inserts/deletes rows directly,
-- guarded purely by RLS (auth.uid() = buyer_id).
-- ---------------------------------------------------------------------------
create table if not exists wishlists (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users (id) on delete cascade,
  card_id uuid not null references cards (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (buyer_id, card_id)
);

create index if not exists wishlists_buyer_id_idx on wishlists (buyer_id, created_at desc);

alter table wishlists enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'wishlists' and policyname = 'buyers can view their own wishlist'
  ) then
    create policy "buyers can view their own wishlist" on wishlists
      for select using (auth.uid() = buyer_id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'wishlists' and policyname = 'buyers can add to their own wishlist'
  ) then
    create policy "buyers can add to their own wishlist" on wishlists
      for insert with check (auth.uid() = buyer_id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'wishlists' and policyname = 'buyers can remove from their own wishlist'
  ) then
    create policy "buyers can remove from their own wishlist" on wishlists
      for delete using (auth.uid() = buyer_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- MIGRATION 11: Payment QR + Cash on Delivery. Safe to run once on an
-- existing project; no-ops on re-run.
-- ---------------------------------------------------------------------------

alter table seller_profiles add column if not exists payment_qr_url text;
alter table seller_profiles add column if not exists cod_enabled boolean not null default false;
alter table seller_profiles add column if not exists cod_weekday smallint;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'seller_profiles_cod_weekday_check') then
    alter table seller_profiles add constraint seller_profiles_cod_weekday_check check (cod_weekday between 0 and 6);
  end if;
end $$;

alter table card_claims add column if not exists payment_method text not null default 'PREPAID';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'card_claims_payment_method_check') then
    alter table card_claims add constraint card_claims_payment_method_check check (payment_method in ('PREPAID', 'COD'));
  end if;
end $$;

alter table dibs_queue add column if not exists payment_method text not null default 'PREPAID';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'dibs_queue_payment_method_check') then
    alter table dibs_queue add constraint dibs_queue_payment_method_check check (payment_method in ('PREPAID', 'COD'));
  end if;
end $$;

create or replace function place_order(
  p_items jsonb,
  p_ship_name text,
  p_ship_phone text,
  p_ship_address text,
  p_ship_zip text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_handle text;
  v_item jsonb;
  v_card_id uuid;
  v_qty int;
  v_fulfillment text;
  v_payment_method text;
  v_card cards;
  v_position int;
  v_results jsonb := '[]'::jsonb;
  v_claim_card_ids uuid[] := '{}';
  v_claim_quantities int[] := '{}';
  v_claim_prices numeric[] := '{}';
  v_claim_fulfillments text[] := '{}';
  v_claim_payment_methods text[] := '{}';
  v_claimed_total numeric := 0;
  v_needs_shipping boolean := false;
  v_order_id uuid;
  v_recent_count int;
  i int;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select handle into v_handle from profiles where id = v_buyer_id;
  if not found then
    raise exception 'Buyer profile not found.';
  end if;

  if not exists (
    select 1 from auth.users where id = v_buyer_id and email_confirmed_at is not null
  ) then
    raise exception 'Please confirm your email before placing an order.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  if p_ship_name is null or trim(p_ship_name) = '' or p_ship_phone is null or trim(p_ship_phone) = '' then
    raise exception 'Name and phone number are required to check out.';
  end if;

  select count(*) into v_recent_count
    from orders
    where buyer_id = v_buyer_id and created_at > now() - interval '1 minute';
  if v_recent_count >= 5 then
    raise exception 'Too many orders placed - please wait a moment and try again';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_card_id := (v_item ->> 'card_id')::uuid;
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::int, 1));
    v_fulfillment := coalesce(v_item ->> 'fulfillment_method', 'SHIP');
    if v_fulfillment not in ('SHIP', 'STASH') then
      v_fulfillment := 'SHIP';
    end if;
    v_payment_method := coalesce(v_item ->> 'payment_method', 'PREPAID');
    if v_payment_method not in ('PREPAID', 'COD') then
      v_payment_method := 'PREPAID';
    end if;

    select * into v_card from cards where id = v_card_id for update;

    if not found or v_card.status = 'DRAFT' then
      v_results := v_results || jsonb_build_object('cardId', v_card_id, 'result', 'not_found');
      continue;
    end if;

    if v_card.quantity_available >= v_qty then
      update cards
        set quantity_available = quantity_available - v_qty,
            status = (case when quantity_available - v_qty <= 0 then 'SOLD' else 'AVAILABLE' end)::card_status
        where id = v_card_id;

      v_claim_card_ids := v_claim_card_ids || v_card_id;
      v_claim_quantities := v_claim_quantities || v_qty;
      v_claim_prices := v_claim_prices || v_card.price;
      v_claim_fulfillments := v_claim_fulfillments || v_fulfillment;
      v_claim_payment_methods := v_claim_payment_methods || v_payment_method;
      v_claimed_total := v_claimed_total + (v_card.price * v_qty);
      if v_fulfillment = 'SHIP' then
        v_needs_shipping := true;
      end if;
      v_results := v_results || jsonb_build_object(
        'cardId', v_card_id, 'title', v_card.title, 'result', 'claimed', 'price', v_card.price, 'quantity', v_qty
      );
    else
      if not exists (
        select 1 from dibs_queue
        where card_id = v_card_id and buyer_id = v_buyer_id and status = 'WAITING'
      ) then
        select count(*) + 1 into v_position from dibs_queue where card_id = v_card_id and status = 'WAITING';
        insert into dibs_queue (card_id, buyer_id, buyer_handle, requested_quantity, fulfillment_method, payment_method)
          values (v_card_id, v_buyer_id, v_handle, v_qty, v_fulfillment, v_payment_method);
      else
        select count(*) into v_position
          from dibs_queue q
          where q.card_id = v_card_id and q.status = 'WAITING'
            and q.created_at <= (
              select created_at from dibs_queue
              where card_id = v_card_id and buyer_id = v_buyer_id and status = 'WAITING'
              limit 1
            );
      end if;
      v_results := v_results || jsonb_build_object(
        'cardId', v_card_id, 'title', v_card.title, 'result', 'queued', 'position', v_position, 'quantity', v_qty
      );
    end if;
  end loop;

  if array_length(v_claim_card_ids, 1) > 0 then
    if v_needs_shipping and (
      p_ship_address is null or trim(p_ship_address) = '' or p_ship_zip is null or trim(p_ship_zip) = ''
    ) then
      raise exception 'Shipping address and zip code are required to ship your cards.';
    end if;

    insert into orders (
      buyer_id, buyer_handle, total_amount,
      ship_name, ship_phone, ship_address, ship_zip
    )
      values (
        v_buyer_id, v_handle, v_claimed_total,
        p_ship_name, p_ship_phone, p_ship_address, p_ship_zip
      ) returning id into v_order_id;

    for i in 1..array_length(v_claim_card_ids, 1) loop
      insert into card_claims (
        card_id, order_id, buyer_id, buyer_handle, quantity, unit_price, status,
        fulfillment_method, payment_method
      )
        values (
          v_claim_card_ids[i], v_order_id, v_buyer_id, v_handle,
          v_claim_quantities[i], v_claim_prices[i], 'PENDING',
          v_claim_fulfillments[i], v_claim_payment_methods[i]
        );
    end loop;

    update offers
      set status = 'SUPERSEDED'
      where card_id = any(v_claim_card_ids) and status = 'PENDING';

    begin
      insert into notifications (recipient_id, type, title, body, link)
        select
          c.admin_id,
          'card_claimed',
          count(*) || ' card(s) claimed',
          v_handle || ' claimed ' || count(*) || ' card(s) from your listings.',
          '/admin'
        from cards c
        where c.id = any(v_claim_card_ids) and c.admin_id is not null
        group by c.admin_id;
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('orderId', v_order_id, 'total', v_claimed_total, 'items', v_results);
end;
$$;

revoke execute on function place_order(jsonb, text, text, text, text) from public;
grant execute on function place_order(jsonb, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- MIGRATION 12: Wanted Cards - a buyer's "can't find it" request for a card
-- that isn't listed yet (name + reference photo), visible to every admin as
-- a shared want-list so any seller can see what buyers are hunting for. Safe
-- to run once on an existing project; no-ops on re-run. Like wishlists, this
-- has no cross-table business logic, so buyer writes go straight through
-- RLS rather than a security-definer RPC; admin reads use the service-role
-- client (bypasses RLS) same as every other admin view in this app - not
-- scoped per-admin, since demand isn't owned by any one seller.
-- ---------------------------------------------------------------------------
create table if not exists wanted_cards (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users (id) on delete cascade,
  buyer_handle text not null,
  card_name text not null,
  photo_url text not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'FULFILLED', 'CLOSED')),
  created_at timestamptz not null default now()
);

create index if not exists wanted_cards_buyer_id_idx on wanted_cards (buyer_id, created_at desc);
create index if not exists wanted_cards_status_idx on wanted_cards (status, created_at desc);

alter table wanted_cards enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'wanted_cards' and policyname = 'buyers can view their own wanted cards'
  ) then
    create policy "buyers can view their own wanted cards" on wanted_cards
      for select using (auth.uid() = buyer_id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'wanted_cards' and policyname = 'buyers can add their own wanted cards'
  ) then
    create policy "buyers can add their own wanted cards" on wanted_cards
      for insert with check (auth.uid() = buyer_id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'wanted_cards' and policyname = 'buyers can remove their own wanted cards'
  ) then
    create policy "buyers can remove their own wanted cards" on wanted_cards
      for delete using (auth.uid() = buyer_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- MIGRATION 13: Sealed Products (booster boxes, packs, ETBs, bundles) as a
-- second product_type on the existing cards table, rather than a parallel
-- system - a sealed listing reuses claiming, cart, shipping, disputes, and
-- reviews exactly as-is. condition_grade/rarity don't apply to a sealed
-- item, but both stay NOT NULL elsewhere in this file (ConditionBadges/
-- RarityBadge and a fair amount of app code assume a real string), so a
-- sealed row just gets fixed placeholder values ('Sealed' / 'Other') that
-- the UI knows to never actually display for product_type = 'SEALED' - see
-- lib/sealedType.ts. Safe to run once on an existing project; no-ops on
-- re-run.
-- ---------------------------------------------------------------------------

alter table cards add column if not exists product_type text not null default 'CARD';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cards_product_type_check') then
    alter table cards add constraint cards_product_type_check check (product_type in ('CARD', 'SEALED'));
  end if;
end $$;

alter table cards add column if not exists sealed_type text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cards_sealed_type_check') then
    alter table cards add constraint cards_sealed_type_check
      check (sealed_type in ('BOOSTER_BOX', 'BOOSTER_PACK', 'ETB', 'BUNDLE'));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cards_product_type_sealed_type_check') then
    alter table cards add constraint cards_product_type_sealed_type_check
      check (
        (product_type = 'SEALED' and sealed_type is not null)
        or (product_type = 'CARD' and sealed_type is null)
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- MIGRATION 14: Offer negotiation rework. Buyer offers -> admin
-- accepts/counters/declines -> if countered, the buyer explicitly accepts or
-- declines that counter -> only then can an ACCEPTED offer be spent through
-- place_order, exactly like a normal purchase (chooses Ship/Stash, Pay
-- Now/COD, goes through checkout) - replacing the old acceptOffer, which
-- inserted a card_claims row (Pending Payment) the instant the admin
-- clicked Accept, before the buyer had done anything. Also adds a 24h
-- auto-expiry for offers the admin never responds to. Safe to run once on
-- an existing project; the alter-column-type calls are themselves
-- idempotent no-ops once status is already text, and everything else is
-- guarded the same way as every other migration in this file.
--
-- State machine: PENDING (awaiting admin) -> COUNTERED (awaiting buyer) ->
-- ACCEPTED (agreed, spendable via place_order) -> FULFILLED (spent). Or
-- PENDING -> ACCEPTED directly (admin accepted the original ask). Terminal
-- dead ends: DECLINED (admin declined), BUYER_DECLINED (buyer declined a
-- counter), EXPIRED (admin never responded within 24h - see
-- expire_stale_offers), SUPERSEDED (stock sold out to someone else while
-- this offer was still open).
--
-- Deliberately no stock hold: an ACCEPTED offer doesn't reserve a unit, it
-- just unlocks a price. If stock sells out before the buyer checks out,
-- place_order returns 'offer_stock_unavailable' for that item and leaves
-- the offer ACCEPTED so they can try again later, same first-come-first-
-- served principle as every other claim in this function.
-- ---------------------------------------------------------------------------

-- status moves from the offer_status enum to text + check (see the comment
-- on the primary `offers` table def near the top of this file) - re-running
-- a text->text USING cast on an already-migrated column is a harmless
-- no-op, which is what makes this safe to run more than once.
alter table offers alter column status drop default;
alter table offers alter column status type text using status::text;
alter table offers alter column status set default 'PENDING';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'offers_status_check') then
    alter table offers add constraint offers_status_check check (
      status in ('PENDING', 'COUNTERED', 'ACCEPTED', 'DECLINED', 'BUYER_DECLINED', 'EXPIRED', 'SUPERSEDED', 'FULFILLED')
    );
  end if;
end $$;

alter table offers add column if not exists counter_amount numeric(10, 2);
alter table offers add column if not exists agreed_amount numeric(10, 2);

alter table card_claims add column if not exists offer_id uuid references offers (id) on delete set null;
create index if not exists card_claims_offer_id_idx on card_claims (offer_id);

-- notifications.type gains three more values for this batch - same
-- pattern-lookup-then-drop-then-recreate approach as the dispute-era
-- migration above, since the auto-generated constraint name isn't
-- guaranteed. Without this, the offer_accepted/offer_declined/offer_expired
-- notifyUser() calls below insert a row that violates the OLD constraint,
-- fails, and gets silently swallowed by notifyUser's own try/catch - the
-- buyer never finds out their offer was accepted, declined, or expired.
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
  'card_claimed', 'queue_promoted',
  'payment_confirmed', 'listing_cancelled', 'dispute_opened',
  'dispute_withdrawn', 'dispute_response', 'dispute_under_review', 'dispute_resolved',
  'claim_cancelled_by_buyer', 'review_received'
));

-- Same signature as before - adds a guard against stacking a second open
-- offer on a card the buyer already has one on.
create or replace function submit_offer(
  p_card_id uuid,
  p_offered_amount numeric,
  p_note text default null
)
returns offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_handle text;
  v_card cards;
  v_offer offers;
  v_recent_count int;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select handle into v_handle from profiles where id = v_buyer_id;
  if not found then
    raise exception 'Buyer profile not found.';
  end if;

  if not exists (
    select 1 from auth.users where id = v_buyer_id and email_confirmed_at is not null
  ) then
    raise exception 'Please confirm your email before making an offer.';
  end if;

  if exists (
    select 1 from offers
    where card_id = p_card_id and buyer_id = v_buyer_id
      and status in ('PENDING', 'COUNTERED', 'ACCEPTED')
  ) then
    raise exception 'You already have an open offer on this card.';
  end if;

  select count(*) into v_recent_count
    from offers
    where buyer_id = v_buyer_id and created_at > now() - interval '1 minute';
  if v_recent_count >= 10 then
    raise exception 'Too many offers submitted - please wait a moment and try again';
  end if;

  select * into v_card from cards where id = p_card_id;

  if not found then
    raise exception 'Card not found';
  end if;

  if v_card.status = 'SOLD' then
    raise exception 'Card is already sold';
  end if;

  if p_offered_amount > v_card.price or p_offered_amount < v_card.price * 0.75 then
    raise exception 'Offer must be between 75%% and 100%% of the listed price';
  end if;

  insert into offers (card_id, buyer_id, buyer_handle, offered_amount, note)
    values (p_card_id, v_buyer_id, v_handle, p_offered_amount, p_note)
    returning * into v_offer;

  if v_card.admin_id is not null then
    begin
      insert into notifications (recipient_id, type, title, body, link)
        values (
          v_card.admin_id,
          'offer_received',
          'New offer received',
          v_handle || ' offered ' || p_offered_amount || ' on "' || v_card.title || '".',
          '/admin/offers'
        );
    exception when others then null;
    end;
  end if;

  return v_offer;
end;
$$;

-- Buyer-callable: responds to an admin's counter with an accept or decline.
-- Mirrors submit_offer's auth-check shape (security definer, auth.uid()
-- ownership check) rather than going through RLS, since this has real
-- business logic (status transition validation) beyond a plain owned-row
-- write.
create or replace function respond_to_offer(p_offer_id uuid, p_accept boolean)
returns offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_offer offers;
  v_card cards;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_offer from offers where id = p_offer_id and buyer_id = v_buyer_id for update;
  if not found then
    raise exception 'Offer not found';
  end if;

  if v_offer.status <> 'COUNTERED' then
    raise exception 'This offer is no longer awaiting your response.';
  end if;

  if p_accept then
    update offers set status = 'ACCEPTED', agreed_amount = v_offer.counter_amount
      where id = p_offer_id
      returning * into v_offer;

    select * into v_card from cards where id = v_offer.card_id;
    if v_card.admin_id is not null then
      begin
        insert into notifications (recipient_id, type, title, body, link)
          values (
            v_card.admin_id,
            'offer_accepted',
            'Counter offer accepted',
            v_offer.buyer_handle || ' accepted your counter of ' || v_offer.counter_amount || ' on "' || v_card.title || '".',
            '/admin/offers'
          );
      exception when others then null;
      end;
    end if;
  else
    update offers set status = 'BUYER_DECLINED'
      where id = p_offer_id
      returning * into v_offer;
  end if;

  return v_offer;
end;
$$;

revoke execute on function respond_to_offer(uuid, boolean) from public;
grant execute on function respond_to_offer(uuid, boolean) to authenticated;

-- Invoked on a schedule via pg_cron (see the cron.schedule call at the very
-- end of this migration), not from a page load - offers need a real clock,
-- not a check-on-visit. Runs as the function owner, not a signed-in buyer,
-- so no auth.uid() check.
create or replace function expire_stale_offers()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer record;
begin
  for v_offer in
    select o.id, o.buyer_id, o.card_id, c.title
    from offers o
    join cards c on c.id = o.card_id
    where o.status = 'PENDING' and o.created_at < now() - interval '24 hours'
  loop
    update offers set status = 'EXPIRED' where id = v_offer.id;
    if v_offer.buyer_id is not null then
      begin
        insert into notifications (recipient_id, type, title, body, link)
          values (
            v_offer.buyer_id,
            'offer_expired',
            'No response from the seller',
            'Your offer on "' || v_offer.title || '" expired after 24 hours with no response - feel free to make a new offer.',
            '/card/' || v_offer.card_id
          );
      exception when others then null;
      end;
    end if;
  end loop;
end;
$$;

-- place_order gains per-item offer_id support: a claim linked to an
-- ACCEPTED offer is charged that offer's agreed_amount instead of
-- cards.price, forces quantity to 1 (offers are single-unit), and marks the
-- offer FULFILLED once spent. Signature is unchanged from the prior
-- version, so no drop is needed and the existing grant below still applies.
create or replace function place_order(
  p_items jsonb,
  p_ship_name text,
  p_ship_phone text,
  p_ship_address text,
  p_ship_zip text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_handle text;
  v_item jsonb;
  v_card_id uuid;
  v_qty int;
  v_fulfillment text;
  v_payment_method text;
  v_offer_id uuid;
  v_offer offers;
  v_card cards;
  v_position int;
  v_results jsonb := '[]'::jsonb;
  v_claim_card_ids uuid[] := '{}';
  v_claim_quantities int[] := '{}';
  v_claim_prices numeric[] := '{}';
  v_claim_fulfillments text[] := '{}';
  v_claim_payment_methods text[] := '{}';
  v_claim_offer_ids uuid[] := '{}';
  v_claimed_total numeric := 0;
  v_needs_shipping boolean := false;
  v_order_id uuid;
  v_recent_count int;
  i int;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select handle into v_handle from profiles where id = v_buyer_id;
  if not found then
    raise exception 'Buyer profile not found.';
  end if;

  if not exists (
    select 1 from auth.users where id = v_buyer_id and email_confirmed_at is not null
  ) then
    raise exception 'Please confirm your email before placing an order.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  if p_ship_name is null or trim(p_ship_name) = '' or p_ship_phone is null or trim(p_ship_phone) = '' then
    raise exception 'Name and phone number are required to check out.';
  end if;

  select count(*) into v_recent_count
    from orders
    where buyer_id = v_buyer_id and created_at > now() - interval '1 minute';
  if v_recent_count >= 5 then
    raise exception 'Too many orders placed - please wait a moment and try again';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_card_id := (v_item ->> 'card_id')::uuid;
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::int, 1));
    v_fulfillment := coalesce(v_item ->> 'fulfillment_method', 'SHIP');
    if v_fulfillment not in ('SHIP', 'STASH') then
      v_fulfillment := 'SHIP';
    end if;
    v_payment_method := coalesce(v_item ->> 'payment_method', 'PREPAID');
    if v_payment_method not in ('PREPAID', 'COD') then
      v_payment_method := 'PREPAID';
    end if;
    v_offer_id := nullif(v_item ->> 'offer_id', '')::uuid;

    select * into v_card from cards where id = v_card_id for update;

    if not found or v_card.status = 'DRAFT' then
      v_results := v_results || jsonb_build_object('cardId', v_card_id, 'result', 'not_found');
      continue;
    end if;

    v_offer := null;
    if v_offer_id is not null then
      select * into v_offer from offers where id = v_offer_id for update;
      if not found or v_offer.buyer_id <> v_buyer_id or v_offer.card_id <> v_card_id or v_offer.status <> 'ACCEPTED' then
        v_results := v_results || jsonb_build_object('cardId', v_card_id, 'result', 'not_found');
        continue;
      end if;
      -- Offers are always single-unit - ignore whatever quantity the client sent.
      v_qty := 1;
    end if;

    if v_card.quantity_available >= v_qty then
      update cards
        set quantity_available = quantity_available - v_qty,
            status = (case when quantity_available - v_qty <= 0 then 'SOLD' else 'AVAILABLE' end)::card_status
        where id = v_card_id;

      v_claim_card_ids := v_claim_card_ids || v_card_id;
      v_claim_quantities := v_claim_quantities || v_qty;
      v_claim_prices := v_claim_prices || coalesce(v_offer.agreed_amount, v_card.price);
      v_claim_fulfillments := v_claim_fulfillments || v_fulfillment;
      v_claim_payment_methods := v_claim_payment_methods || v_payment_method;
      v_claim_offer_ids := v_claim_offer_ids || v_offer_id;
      v_claimed_total := v_claimed_total + (coalesce(v_offer.agreed_amount, v_card.price) * v_qty);
      if v_fulfillment = 'SHIP' then
        v_needs_shipping := true;
      end if;
      if v_offer_id is not null then
        update offers set status = 'FULFILLED' where id = v_offer_id;
      end if;
      v_results := v_results || jsonb_build_object(
        'cardId', v_card_id, 'title', v_card.title, 'result', 'claimed',
        'price', coalesce(v_offer.agreed_amount, v_card.price), 'quantity', v_qty
      );
    elsif v_offer_id is not null then
      -- Don't silently queue an offer-priced item at full price - leave the
      -- offer ACCEPTED and untouched so the buyer can try again once stock
      -- frees up, same as anyone else waiting on this card.
      v_results := v_results || jsonb_build_object(
        'cardId', v_card_id, 'title', v_card.title, 'result', 'offer_stock_unavailable'
      );
    else
      if not exists (
        select 1 from dibs_queue
        where card_id = v_card_id and buyer_id = v_buyer_id and status = 'WAITING'
      ) then
        select count(*) + 1 into v_position from dibs_queue where card_id = v_card_id and status = 'WAITING';
        insert into dibs_queue (card_id, buyer_id, buyer_handle, requested_quantity, fulfillment_method, payment_method)
          values (v_card_id, v_buyer_id, v_handle, v_qty, v_fulfillment, v_payment_method);
      else
        select count(*) into v_position
          from dibs_queue q
          where q.card_id = v_card_id and q.status = 'WAITING'
            and q.created_at <= (
              select created_at from dibs_queue
              where card_id = v_card_id and buyer_id = v_buyer_id and status = 'WAITING'
              limit 1
            );
      end if;
      v_results := v_results || jsonb_build_object(
        'cardId', v_card_id, 'title', v_card.title, 'result', 'queued', 'position', v_position, 'quantity', v_qty
      );
    end if;
  end loop;

  if array_length(v_claim_card_ids, 1) > 0 then
    if v_needs_shipping and (
      p_ship_address is null or trim(p_ship_address) = '' or p_ship_zip is null or trim(p_ship_zip) = ''
    ) then
      raise exception 'Shipping address and zip code are required to ship your cards.';
    end if;

    insert into orders (
      buyer_id, buyer_handle, total_amount,
      ship_name, ship_phone, ship_address, ship_zip
    )
      values (
        v_buyer_id, v_handle, v_claimed_total,
        p_ship_name, p_ship_phone, p_ship_address, p_ship_zip
      ) returning id into v_order_id;

    for i in 1..array_length(v_claim_card_ids, 1) loop
      insert into card_claims (
        card_id, order_id, buyer_id, buyer_handle, quantity, unit_price, status,
        fulfillment_method, payment_method, offer_id
      )
        values (
          v_claim_card_ids[i], v_order_id, v_buyer_id, v_handle,
          v_claim_quantities[i], v_claim_prices[i], 'PENDING',
          v_claim_fulfillments[i], v_claim_payment_methods[i], v_claim_offer_ids[i]
        );
    end loop;

    update offers
      set status = 'SUPERSEDED'
      where card_id = any(v_claim_card_ids) and status in ('PENDING', 'COUNTERED');

    begin
      insert into notifications (recipient_id, type, title, body, link)
        select
          c.admin_id,
          'card_claimed',
          count(*) || ' card(s) claimed',
          v_handle || ' claimed ' || count(*) || ' card(s) from your listings.',
          '/admin'
        from cards c
        where c.id = any(v_claim_card_ids) and c.admin_id is not null
        group by c.admin_id;
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('orderId', v_order_id, 'total', v_claimed_total, 'items', v_results);
end;
$$;

-- One-time setup outside this script: enable the "pg_cron" extension via
-- Supabase Dashboard -> Database -> Extensions (more reliable than the
-- create extension call below, which needs elevated privileges this SQL
-- editor role may not have). Once enabled, the two statements below start a
-- 15-minute sweep for expired offers - safe to re-run, cron.schedule
-- upserts by job name.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('expire-stale-offers', '*/15 * * * *', $$select expire_stale_offers()$$);

-- ---------------------------------------------------------------------------
-- MIGRATION 15: fixes from a full-system audit. A COUNTERED offer the buyer
-- never responds to now expires same as a PENDING one (previously only
-- PENDING did, so an ignored counter locked that buyer out of ever making
-- a new offer on the card, forever). A real unique index now backs "one
-- open offer per buyer per card" instead of a bare read-then-insert check.
-- A buyer promoted from the queue is now charged the price that was in
-- effect when they joined, not whatever the price has become by promotion
-- time. Two new notification types (claim_shipped, wanted_card_fulfilled)
-- cover events that previously notified nobody. Safe to run once on an
-- existing project; no-ops on re-run.
-- ---------------------------------------------------------------------------

-- notifications.type gains two more values - same pattern as the last two
-- times this list grew.
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
  'card_claimed', 'queue_promoted', 'claim_shipped', 'wanted_card_fulfilled',
  'payment_confirmed', 'listing_cancelled', 'dispute_opened',
  'dispute_withdrawn', 'dispute_response', 'dispute_under_review', 'dispute_resolved',
  'claim_cancelled_by_buyer', 'review_received'
));

-- Backstop against a double-submit race, same reasoning/pattern as
-- one_open_dispute_per_claim (see the disputes table above): submit_offer's
-- own check is a read-then-insert and can't fully prevent two concurrent
-- calls from both passing it before either commits.
create unique index if not exists offers_one_open_per_buyer_card
  on offers (card_id, buyer_id)
  where status in ('PENDING', 'COUNTERED', 'ACCEPTED');

-- Same signature as before - the insert is now wrapped to turn a
-- unique_violation (the new index above) into the same friendly message
-- the pre-check already gives, instead of a raw constraint error.
create or replace function submit_offer(
  p_card_id uuid,
  p_offered_amount numeric,
  p_note text default null
)
returns offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_handle text;
  v_card cards;
  v_offer offers;
  v_recent_count int;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select handle into v_handle from profiles where id = v_buyer_id;
  if not found then
    raise exception 'Buyer profile not found.';
  end if;

  if not exists (
    select 1 from auth.users where id = v_buyer_id and email_confirmed_at is not null
  ) then
    raise exception 'Please confirm your email before making an offer.';
  end if;

  if exists (
    select 1 from offers
    where card_id = p_card_id and buyer_id = v_buyer_id
      and status in ('PENDING', 'COUNTERED', 'ACCEPTED')
  ) then
    raise exception 'You already have an open offer on this card.';
  end if;

  select count(*) into v_recent_count
    from offers
    where buyer_id = v_buyer_id and created_at > now() - interval '1 minute';
  if v_recent_count >= 10 then
    raise exception 'Too many offers submitted - please wait a moment and try again';
  end if;

  select * into v_card from cards where id = p_card_id;

  if not found then
    raise exception 'Card not found';
  end if;

  if v_card.status = 'SOLD' then
    raise exception 'Card is already sold';
  end if;

  if p_offered_amount > v_card.price or p_offered_amount < v_card.price * 0.75 then
    raise exception 'Offer must be between 75%% and 100%% of the listed price';
  end if;

  begin
    insert into offers (card_id, buyer_id, buyer_handle, offered_amount, note)
      values (p_card_id, v_buyer_id, v_handle, p_offered_amount, p_note)
      returning * into v_offer;
  exception when unique_violation then
    raise exception 'You already have an open offer on this card.';
  end;

  if v_card.admin_id is not null then
    begin
      insert into notifications (recipient_id, type, title, body, link)
        values (
          v_card.admin_id,
          'offer_received',
          'New offer received',
          v_handle || ' offered ' || p_offered_amount || ' on "' || v_card.title || '".',
          '/admin/offers'
        );
    exception when others then null;
    end;
  end if;

  return v_offer;
end;
$$;

-- Now also expires an ignored COUNTERED offer, using the same 24h-from-
-- created_at cutoff as PENDING (no separate "countered at" timestamp
-- exists) - an approximation of the buyer's actual response window, but
-- bounded and predictable beats never expiring at all.
create or replace function expire_stale_offers()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer record;
begin
  for v_offer in
    select o.id, o.buyer_id, o.card_id, c.title
    from offers o
    join cards c on c.id = o.card_id
    where o.status in ('PENDING', 'COUNTERED') and o.created_at < now() - interval '24 hours'
  loop
    update offers set status = 'EXPIRED' where id = v_offer.id;
    if v_offer.buyer_id is not null then
      begin
        insert into notifications (recipient_id, type, title, body, link)
          values (
            v_offer.buyer_id,
            'offer_expired',
            'No response from the seller',
            'Your offer on "' || v_offer.title || '" expired after 24 hours with no response - feel free to make a new offer.',
            '/card/' || v_offer.card_id
          );
      exception when others then null;
      end;
    end if;
  end loop;
end;
$$;

-- The price actually in effect when a buyer joined the queue, so
-- promoteNextInQueue (app/admin/actions.ts) can charge that instead of
-- silently charging whatever the price has become by promotion time.
-- Nullable - existing WAITING entries predate this column, and
-- promoteNextInQueue falls back to the card's list_price for those, same
-- as it always has.
alter table dibs_queue add column if not exists locked_price numeric(10, 2);

-- Same signature as before - the only change is capturing v_card.price
-- into the new dibs_queue.locked_price column when an item queues instead
-- of claiming.
create or replace function place_order(
  p_items jsonb,
  p_ship_name text,
  p_ship_phone text,
  p_ship_address text,
  p_ship_zip text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_handle text;
  v_item jsonb;
  v_card_id uuid;
  v_qty int;
  v_fulfillment text;
  v_payment_method text;
  v_offer_id uuid;
  v_offer offers;
  v_card cards;
  v_position int;
  v_results jsonb := '[]'::jsonb;
  v_claim_card_ids uuid[] := '{}';
  v_claim_quantities int[] := '{}';
  v_claim_prices numeric[] := '{}';
  v_claim_fulfillments text[] := '{}';
  v_claim_payment_methods text[] := '{}';
  v_claim_offer_ids uuid[] := '{}';
  v_claimed_total numeric := 0;
  v_needs_shipping boolean := false;
  v_order_id uuid;
  v_recent_count int;
  i int;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select handle into v_handle from profiles where id = v_buyer_id;
  if not found then
    raise exception 'Buyer profile not found.';
  end if;

  if not exists (
    select 1 from auth.users where id = v_buyer_id and email_confirmed_at is not null
  ) then
    raise exception 'Please confirm your email before placing an order.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  if p_ship_name is null or trim(p_ship_name) = '' or p_ship_phone is null or trim(p_ship_phone) = '' then
    raise exception 'Name and phone number are required to check out.';
  end if;

  select count(*) into v_recent_count
    from orders
    where buyer_id = v_buyer_id and created_at > now() - interval '1 minute';
  if v_recent_count >= 5 then
    raise exception 'Too many orders placed - please wait a moment and try again';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_card_id := (v_item ->> 'card_id')::uuid;
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::int, 1));
    v_fulfillment := coalesce(v_item ->> 'fulfillment_method', 'SHIP');
    if v_fulfillment not in ('SHIP', 'STASH') then
      v_fulfillment := 'SHIP';
    end if;
    v_payment_method := coalesce(v_item ->> 'payment_method', 'PREPAID');
    if v_payment_method not in ('PREPAID', 'COD') then
      v_payment_method := 'PREPAID';
    end if;
    v_offer_id := nullif(v_item ->> 'offer_id', '')::uuid;

    select * into v_card from cards where id = v_card_id for update;

    if not found or v_card.status = 'DRAFT' then
      v_results := v_results || jsonb_build_object('cardId', v_card_id, 'result', 'not_found');
      continue;
    end if;

    v_offer := null;
    if v_offer_id is not null then
      select * into v_offer from offers where id = v_offer_id for update;
      if not found or v_offer.buyer_id <> v_buyer_id or v_offer.card_id <> v_card_id or v_offer.status <> 'ACCEPTED' then
        v_results := v_results || jsonb_build_object('cardId', v_card_id, 'result', 'not_found');
        continue;
      end if;
      -- Offers are always single-unit - ignore whatever quantity the client sent.
      v_qty := 1;
    end if;

    if v_card.quantity_available >= v_qty then
      update cards
        set quantity_available = quantity_available - v_qty,
            status = (case when quantity_available - v_qty <= 0 then 'SOLD' else 'AVAILABLE' end)::card_status
        where id = v_card_id;

      v_claim_card_ids := v_claim_card_ids || v_card_id;
      v_claim_quantities := v_claim_quantities || v_qty;
      v_claim_prices := v_claim_prices || coalesce(v_offer.agreed_amount, v_card.price);
      v_claim_fulfillments := v_claim_fulfillments || v_fulfillment;
      v_claim_payment_methods := v_claim_payment_methods || v_payment_method;
      v_claim_offer_ids := v_claim_offer_ids || v_offer_id;
      v_claimed_total := v_claimed_total + (coalesce(v_offer.agreed_amount, v_card.price) * v_qty);
      if v_fulfillment = 'SHIP' then
        v_needs_shipping := true;
      end if;
      if v_offer_id is not null then
        update offers set status = 'FULFILLED' where id = v_offer_id;
      end if;
      v_results := v_results || jsonb_build_object(
        'cardId', v_card_id, 'title', v_card.title, 'result', 'claimed',
        'price', coalesce(v_offer.agreed_amount, v_card.price), 'quantity', v_qty
      );
    elsif v_offer_id is not null then
      -- Don't silently queue an offer-priced item at full price - leave the
      -- offer ACCEPTED and untouched so the buyer can try again once stock
      -- frees up, same as anyone else waiting on this card.
      v_results := v_results || jsonb_build_object(
        'cardId', v_card_id, 'title', v_card.title, 'result', 'offer_stock_unavailable'
      );
    else
      if not exists (
        select 1 from dibs_queue
        where card_id = v_card_id and buyer_id = v_buyer_id and status = 'WAITING'
      ) then
        select count(*) + 1 into v_position from dibs_queue where card_id = v_card_id and status = 'WAITING';
        insert into dibs_queue (card_id, buyer_id, buyer_handle, requested_quantity, fulfillment_method, payment_method, locked_price)
          values (v_card_id, v_buyer_id, v_handle, v_qty, v_fulfillment, v_payment_method, v_card.price);
      else
        select count(*) into v_position
          from dibs_queue q
          where q.card_id = v_card_id and q.status = 'WAITING'
            and q.created_at <= (
              select created_at from dibs_queue
              where card_id = v_card_id and buyer_id = v_buyer_id and status = 'WAITING'
              limit 1
            );
      end if;
      v_results := v_results || jsonb_build_object(
        'cardId', v_card_id, 'title', v_card.title, 'result', 'queued', 'position', v_position, 'quantity', v_qty
      );
    end if;
  end loop;

  if array_length(v_claim_card_ids, 1) > 0 then
    if v_needs_shipping and (
      p_ship_address is null or trim(p_ship_address) = '' or p_ship_zip is null or trim(p_ship_zip) = ''
    ) then
      raise exception 'Shipping address and zip code are required to ship your cards.';
    end if;

    insert into orders (
      buyer_id, buyer_handle, total_amount,
      ship_name, ship_phone, ship_address, ship_zip
    )
      values (
        v_buyer_id, v_handle, v_claimed_total,
        p_ship_name, p_ship_phone, p_ship_address, p_ship_zip
      ) returning id into v_order_id;

    for i in 1..array_length(v_claim_card_ids, 1) loop
      insert into card_claims (
        card_id, order_id, buyer_id, buyer_handle, quantity, unit_price, status,
        fulfillment_method, payment_method, offer_id
      )
        values (
          v_claim_card_ids[i], v_order_id, v_buyer_id, v_handle,
          v_claim_quantities[i], v_claim_prices[i], 'PENDING',
          v_claim_fulfillments[i], v_claim_payment_methods[i], v_claim_offer_ids[i]
        );
    end loop;

    update offers
      set status = 'SUPERSEDED'
      where card_id = any(v_claim_card_ids) and status in ('PENDING', 'COUNTERED');

    begin
      insert into notifications (recipient_id, type, title, body, link)
        select
          c.admin_id,
          'card_claimed',
          count(*) || ' card(s) claimed',
          v_handle || ' claimed ' || count(*) || ' card(s) from your listings.',
          '/admin'
        from cards c
        where c.id = any(v_claim_card_ids) and c.admin_id is not null
        group by c.admin_id;
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('orderId', v_order_id, 'total', v_claimed_total, 'items', v_results);
end;
$$;

-- ---------------------------------------------------------------------------
-- Seed data (optional) - a few sample cards so the grid isn't empty. Only
-- runs cleanly on a fresh install (re-running inserts duplicates); skip this
-- block entirely on an existing project.
-- ---------------------------------------------------------------------------
insert into cards (title, set_name, price, list_price, condition_grade, rarity, pokemon_type, images, seller_handle, seller_messenger, is_flash_sale, franchise)
values
  ('Charizard', 'Base Set Unlimited', 2400, 2400, 'PSA 10', 'Hyper Rare', 'Fire', '{}', '@apex_cards', 'CardUnion1', true, 'pokemon'),
  ('Umbreon VMAX', 'Evolving Skies', 850, 850, 'PSA 9', 'Ultra Rare', 'Dark', '{}', '@vault_hobbyist', 'CardUnion1', false, 'pokemon'),
  ('Monkey D. Luffy', 'Romance Dawn', 1800, 1800, 'Raw NM', 'Rare', null, '{}', '@apex_cards', 'CardUnion1', false, 'one-piece'),
  ('Roronoa Zoro', 'Paramount War', 950, 950, 'Raw NM', 'Uncommon', null, '{}', '@apex_cards', 'CardUnion1', false, 'one-piece');
