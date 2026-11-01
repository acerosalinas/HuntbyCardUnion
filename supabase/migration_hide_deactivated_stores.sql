-- Hides a seller's whole store when their admin account is deactivated (and brings it back on reactivation).
-- Run once in the Supabase SQL editor. Safe to re-run. Run migration_row_level_security.sql first.
--
-- How it works: seller_profiles gets an `active` flag that the Manage page flips together with the account ban.
-- While it is false, the seller's profile and all their listings disappear from the marketplace, the sellers page,
-- the home page and search, and nobody can start a new claim, offer or dibs on them. A buyer who already has an
-- order, claim or offer with that seller can still see those cards in My Dibs. Admin pages (service key) still see
-- everything, so you can manage or reactivate the store.

alter table public.seller_profiles add column if not exists active boolean not null default true;

-- Stores whose admin is already deactivated (banned) right now.
update public.seller_profiles sp
set active = false
from auth.users u
where u.id = sp.admin_id
  and u.banned_until is not null
  and u.banned_until > now();

-- Answers "is this seller's store hidden?" without being limited by the row rules themselves.
create or replace function public.seller_is_hidden(p_admin uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from seller_profiles where admin_id = p_admin and active = false);
$$;

grant execute on function public.seller_is_hidden(uuid) to anon, authenticated, service_role;

-- Seller profiles: the public sees active stores only.
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'seller_profiles' and cmd = 'SELECT' loop
    execute format('drop policy %I on public.seller_profiles', p.policyname);
  end loop;
end $$;

create policy "active sellers are public" on public.seller_profiles for select using (active);

-- Cards: hidden with their seller, except for a buyer's own claims and offers (so their order history stays readable).
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'cards' and cmd = 'SELECT' loop
    execute format('drop policy %I on public.cards', p.policyname);
  end loop;
end $$;

create policy "cards are publicly readable" on public.cards for select using (
  status <> 'DRAFT'
  and (
    admin_id is null
    or not public.seller_is_hidden(admin_id)
    or exists (select 1 from public.card_claims c where c.card_id = cards.id and c.buyer_id = auth.uid())
    or exists (select 1 from public.offers o where o.card_id = cards.id and o.buyer_id = auth.uid())
  )
);

-- Nobody can start something new with a hidden store, even by calling the database directly.
create or replace function public.block_hidden_seller()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_admin uuid;
begin
  select admin_id into v_admin from cards where id = new.card_id;
  if v_admin is not null and public.seller_is_hidden(v_admin) then
    raise exception 'This seller''s store is currently unavailable.';
  end if;
  return new;
end;
$$;

drop trigger if exists block_hidden_seller_claims on public.card_claims;
create trigger block_hidden_seller_claims before insert on public.card_claims
  for each row execute function public.block_hidden_seller();

drop trigger if exists block_hidden_seller_offers on public.offers;
create trigger block_hidden_seller_offers before insert on public.offers
  for each row execute function public.block_hidden_seller();

drop trigger if exists block_hidden_seller_dibs on public.dibs_queue;
create trigger block_hidden_seller_dibs before insert on public.dibs_queue
  for each row execute function public.block_hidden_seller();
