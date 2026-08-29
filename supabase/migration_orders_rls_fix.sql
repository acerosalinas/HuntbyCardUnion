-- Hotfix: the `orders` table's RLS select policy was "publicly readable"
-- (using (true)) - meaning any visitor, with no login at all, could read
-- every buyer's real name/phone/home address (ship_name, ship_phone,
-- ship_address, ship_zip) via the public REST API. That policy predates
-- buyer accounts and the ship_* columns and was never revisited. Run this
-- once in the Supabase SQL editor. Safe to paste and run more than once.
--
-- Nothing in the app reads `orders` directly from the browser - buyer order
-- history is already read through card_claims (already owner-scoped), and
-- admin reads go through the service-role client (bypasses RLS anyway) -
-- so this is a pure security tightening with no functional change.

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
