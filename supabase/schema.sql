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
create type offer_status as enum ('PENDING', 'ACCEPTED', 'DECLINED', 'SUPERSEDED');
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
  images text[] not null default '{}',
  seller_handle text not null,
  seller_messenger text not null,
  status card_status not null default 'AVAILABLE',
  current_claimant text,
  -- The authenticated buyer behind current_claimant, if they have a real
  -- account (see `profiles` below). Null for historical claims made before
  -- buyer accounts existed - current_claimant (display text) still works for
  -- those, they just can't receive account-based notifications.
  claimant_id uuid references auth.users (id) on delete set null,
  -- When the current PENDING period started (claim, offer acceptance, or
  -- queue promotion) - not the same as created_at, which is listing time.
  claimed_at timestamptz,
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
  -- Sale tracking for the admin Sales Log tab.
  sold_at timestamptz,
  shipped boolean not null default false,
  created_at timestamptz not null default now()
);

create index cards_admin_id_idx on cards (admin_id);
create index cards_franchise_idx on cards (franchise);
create index cards_claimant_id_idx on cards (claimant_id);

create table offers (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards (id) on delete cascade,
  buyer_handle text not null,
  buyer_id uuid references auth.users (id) on delete set null,
  offered_amount numeric(10, 2) not null check (offered_amount > 0),
  note text,
  status offer_status not null default 'PENDING',
  created_at timestamptz not null default now()
);

create index offers_card_id_idx on offers (card_id);
create index offers_buyer_id_idx on offers (buyer_id);
create index cards_status_idx on cards (status);

-- ---------------------------------------------------------------------------
-- dibs_queue: buyers waiting in line for a card that's already PENDING.
-- place_order() adds to this queue instead of failing; the admin's
-- "Next in Queue" action (promoteNextInQueue in app/admin/actions.ts) pops
-- the earliest WAITING entry and makes that buyer the new current_claimant.
-- ---------------------------------------------------------------------------
create table dibs_queue (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards (id) on delete cascade,
  buyer_handle text not null,
  buyer_id uuid references auth.users (id) on delete set null,
  status queue_status not null default 'WAITING',
  created_at timestamptz not null default now()
);

create index dibs_queue_card_id_idx on dibs_queue (card_id, status);
create index dibs_queue_buyer_id_idx on dibs_queue (card_id, buyer_id, status);

-- ---------------------------------------------------------------------------
-- orders: a buyer's checkout receipt for one or more cards claimed together
-- via the cart ("Add to Cart" -> "Place Order"). Cards link back via
-- cards.order_id. total_amount is a snapshot of what was actually claimed
-- (cards that were already taken or went to the queue instead aren't
-- included), so it can differ from the sum of everything the buyer put in
-- their cart. confirmed_at is set once by try_claim_order_confirmation() the
-- moment every card in the order has been marked SOLD or detached (canceled)
-- - see that function below for why this needs to be atomic.
-- ---------------------------------------------------------------------------
create table orders (
  id uuid primary key default gen_random_uuid(),
  buyer_handle text not null,
  buyer_id uuid references auth.users (id) on delete set null,
  total_amount numeric(10, 2) not null default 0,
  confirmed_at timestamptz,
  -- Fulfillment, collected at checkout (see place_order below) and shown to
  -- the seller in the consolidated Messenger message. Nullable at the
  -- column level - historical orders predate this and can't be backfilled -
  -- but place_order requires them for every new order. STASH doesn't need a
  -- real address, so ship_address/ship_zip are only meaningful for SHIP.
  ship_name text,
  ship_phone text,
  ship_address text,
  ship_zip text,
  fulfillment_method text check (fulfillment_method in ('SHIP', 'STASH')),
  created_at timestamptz not null default now()
);

create index orders_buyer_handle_idx on orders (buyer_handle);

alter table cards add column if not exists order_id uuid references orders (id) on delete set null;
create index if not exists cards_order_id_idx on cards (order_id);

-- ---------------------------------------------------------------------------
-- profiles: a buyer's verified identity. Created automatically by the
-- handle_new_user trigger below when someone signs up via
-- supabase.auth.signUp({ email, password, options: { data: { handle,
-- full_name } } }) - never inserted directly by app code. RLS is
-- owner-only: every public display site already reads a denormalized
-- buyer_handle/current_claimant TEXT column on cards/offers/dibs_queue/
-- orders, so nothing needs to publicly join profiles, and full_name (real
-- PII, unlike the pseudonymous handle) should never be world-readable.
-- Admin reads bypass RLS via the service-role client as usual.
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null check (handle ~ '^@[A-Za-z0-9_]{3,20}$'),
  full_name text not null,
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
create policy "orders are publicly readable" on orders for select using (true);
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
-- real enum (unlike card_status/offer_status/dispute_status elsewhere in
-- this file): this list grows every time a new event needs a notification,
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
    'offer_received', 'offer_countered', 'card_claimed', 'queue_promoted',
    'payment_confirmed', 'listing_cancelled', 'dispute_opened',
    'dispute_withdrawn', 'dispute_response', 'dispute_under_review', 'dispute_resolved'
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

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'orders' and policyname = 'orders are publicly readable'
  ) then
    create policy "orders are publicly readable" on orders for select using (true);
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
-- one instead of replacing it), and the single-param place_order(uuid[])
-- from earlier in this file (still current on any project run before
-- shipping/fulfillment collection existed) has to actually be gone before
-- the 6-param version below takes over that name.
drop function if exists place_order(uuid[]);

create or replace function place_order(
  p_card_ids uuid[],
  p_ship_name text,
  p_ship_phone text,
  p_ship_address text,
  p_ship_zip text,
  p_fulfillment_method text
)
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

  if p_fulfillment_method not in ('SHIP', 'STASH') then
    raise exception 'Choose Ship Out or Stash With Us before checking out.';
  end if;
  if p_ship_name is null or trim(p_ship_name) = '' or p_ship_phone is null or trim(p_ship_phone) = '' then
    raise exception 'Name and phone number are required to check out.';
  end if;
  if p_fulfillment_method = 'SHIP' and (
    p_ship_address is null or trim(p_ship_address) = '' or p_ship_zip is null or trim(p_ship_zip) = ''
  ) then
    raise exception 'Shipping address and zip code are required to ship your cards.';
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
    insert into orders (
      buyer_id, buyer_handle, total_amount,
      ship_name, ship_phone, ship_address, ship_zip, fulfillment_method
    )
      values (
        v_buyer_id, v_handle, v_claimed_total,
        p_ship_name, p_ship_phone, p_ship_address, p_ship_zip, p_fulfillment_method
      ) returning id into v_order_id;

    update cards
      set status = 'PENDING', current_claimant = v_handle, claimant_id = v_buyer_id,
          claimed_at = now(), order_id = v_order_id
      where id = any(v_claimed_ids);

    update offers
      set status = 'SUPERSEDED'
      where card_id = any(v_claimed_ids) and status = 'PENDING';

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
        where c.id = any(v_claimed_ids) and c.admin_id is not null
        group by c.admin_id;
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('orderId', v_order_id, 'total', v_claimed_total, 'items', v_results);
end;
$$;

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

revoke execute on function place_order(uuid[], text, text, text, text, text) from public;
grant execute on function place_order(uuid[], text, text, text, text, text) to authenticated;

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
  -- Denormalized for display only - never used in any ownership/RLS
  -- decision. One order can span cards from multiple admins; a dispute is
  -- always scoped to a single card, so seller_admin_id (below) is always
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
-- that as a friendly error rather than a raw constraint violation.
create unique index if not exists one_open_dispute_per_card_buyer
  on disputes (card_id, buyer_id)
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
-- submit_offer/place_order. Eligibility: the card must be SOLD and the
-- caller must be its claimant_id - tracing the rest of this schema, status
-- only ever becomes SOLD via the admin confirmPaid action, so SOLD already
-- implies payment was confirmed; no separate orders.confirmed_at check is
-- needed. Capped at 2 lifetime disputes per (card, buyer) regardless of
-- outcome, to prevent repeat-filing abuse after a dismissal, plus the usual
-- per-buyer rate limit.
-- ---------------------------------------------------------------------------
create or replace function open_dispute(
  p_card_id uuid,
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

  select * into v_card from cards where id = p_card_id;
  if not found then
    raise exception 'Card not found';
  end if;
  if v_card.status != 'SOLD' or v_card.claimant_id is distinct from v_buyer_id then
    raise exception 'You can only open a dispute for an item you bought.';
  end if;

  select count(*) into v_lifetime_count
    from disputes where card_id = p_card_id and buyer_id = v_buyer_id;
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
    insert into disputes (card_id, order_id, buyer_id, seller_admin_id, reason, description)
      values (p_card_id, v_card.order_id, v_buyer_id, v_card.admin_id, p_reason, p_description)
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
-- Seed data (optional) - a few sample cards so the grid isn't empty. Only
-- runs cleanly on a fresh install (re-running inserts duplicates); skip this
-- block entirely on an existing project.
-- ---------------------------------------------------------------------------
insert into cards (title, set_name, price, list_price, condition_grade, images, seller_handle, seller_messenger, is_flash_sale, franchise)
values
  ('Charizard', 'Base Set Unlimited', 2400, 2400, 'PSA 10', '{}', '@apex_cards', 'CardUnion1', true, 'pokemon'),
  ('Umbreon VMAX', 'Evolving Skies', 850, 850, 'PSA 9', '{}', '@vault_hobbyist', 'CardUnion1', false, 'pokemon'),
  ('Monkey D. Luffy', 'Romance Dawn', 1800, 1800, 'Raw NM', '{}', '@apex_cards', 'CardUnion1', false, 'one-piece'),
  ('Roronoa Zoro', 'Paramount War', 950, 950, 'Raw NM', '{}', '@apex_cards', 'CardUnion1', false, 'one-piece');
