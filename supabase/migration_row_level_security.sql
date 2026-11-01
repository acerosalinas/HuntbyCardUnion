-- Row level security + function permissions hardening. Run once in the Supabase SQL editor. Safe to re-run.
--
-- Why: the public "anon" key ships in every browser, so what it can reach is what anyone on the internet can reach.
-- A security audit found:
--   1. `orders` readable by anyone, signed out included - buyer names, phone numbers and shipping addresses.
--   2. Admin-only database functions (confirm_paid_claim, accept_offer_admin, cancel_relist_claim, ...) callable by
--      anyone: a customer could mark their own unpaid order as paid.
--   3. `offers` (amounts, notes, buyer ids) readable by anyone.
-- The app only ever calls the admin functions from the server with the service-role key, which this does not touch.

-- ---------------------------------------------------------------------------
-- 0. "Is this person approved?" - same rule as lib/accessGate.ts, read from the sign-in token.
-- ---------------------------------------------------------------------------
create or replace function public.is_approved()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'approved') = 'true', false)
      or coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('ADMIN', 'SUPER_ADMIN'), false);
$$;

grant execute on function public.is_approved() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Row level security on every table. A table with RLS on and no policy is closed to the public key entirely,
--    which is right for tables only the server touches (tracker_*, rate_limits, removed_users, the card catalog).
--    The server's service-role key bypasses RLS, so nothing the app does server-side is affected.
-- ---------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. orders: owner-only. Drops every existing policy first, so a leftover "publicly readable" one cannot survive.
-- ---------------------------------------------------------------------------
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'orders' loop
    execute format('drop policy %I on public.orders', p.policyname);
  end loop;
end $$;

create policy "buyers can view their own orders" on public.orders for select using (auth.uid() = buyer_id);

-- ---------------------------------------------------------------------------
-- 3. offers: owner-only. The admin inventory's "Negotiating" badge used to read every PENDING offer directly;
--    it now asks this function, which returns card ids only (no amounts, notes or buyers).
-- ---------------------------------------------------------------------------
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'offers' loop
    execute format('drop policy %I on public.offers', p.policyname);
  end loop;
end $$;

create policy "buyers can view their own offers" on public.offers for select using (auth.uid() = buyer_id);

create or replace function public.negotiating_card_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct card_id from offers where status = 'PENDING';
$$;

revoke all on function public.negotiating_card_ids() from public;
grant execute on function public.negotiating_card_ids() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Direct writes from the browser need an approved account (the wishlist and wanted-card forms write straight to
--    their tables). Restrictive policies are ANDed with the existing "own rows" policies.
-- ---------------------------------------------------------------------------
drop policy if exists "approved accounts only" on public.wishlists;
create policy "approved accounts only" on public.wishlists as restrictive for insert to authenticated with check (public.is_approved());

drop policy if exists "approved accounts only" on public.wanted_cards;
create policy "approved accounts only" on public.wanted_cards as restrictive for insert to authenticated with check (public.is_approved());

-- ---------------------------------------------------------------------------
-- 5. Function permissions. Postgres/Supabase grant EXECUTE on new functions to anon and authenticated by default, and
--    `revoke ... from public` does not undo those explicit grants - so each function is set explicitly here.
--    (a) Admin / server-only functions: service role only.
-- ---------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'confirm_paid_claim', 'cancel_relist_claim', 'promote_next_in_queue', 'assign_live_sale', 'remove_live_sale_claim',
        'resolve_dispute_restock', 'accept_offer_admin', 'counter_offer_admin', 'decline_offer_admin',
        'expire_stale_offers', 'release_expired_dibs', 'try_claim_order_confirmation', 'rate_limit_hit',
        'tracker_confirm_claim', 'tracker_set_plan', 'tracker_mark_shipped', 'tracker_undo_shipment',
        'tracker_revert_card_payment', 'tracker_revert_card_full'
      ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

--    (b) Buyer-facing functions (called from the browser): signed-in users only, never the anonymous key.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'submit_offer', 'place_order', 'respond_to_offer', 'cancel_claim', 'mark_claim_received',
        'open_dispute', 'withdraw_dispute', 'submit_review'
      ])
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
