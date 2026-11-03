-- Open sign-ups + safeguards that replace "an admin must approve every new account". Run once in the Supabase SQL
-- editor. Safe to re-run. Run it BEFORE (or together with) deploying the matching code, never after.
--
-- 1. Anyone may use the site straight after signing up. An admin can still put an account ON HOLD (the Hold button on
--    the Manage page sets `approved: false` on the account); this function is what the database rules use to tell.
-- 2. A held account can't start anything new, even by calling the database directly: no claim, offer or dibs.
-- 3. New accounts can't hoard: while an account is under 3 days old it can have at most 10 unpaid orders at once
--    (40 after that). Live-sale cards an admin assigns are not counted. This stops throwaway accounts reserving the
--    whole shop without paying.

-- 1. "Is this account allowed in?" - open by default; only an explicit hold says no.
create or replace function public.is_approved()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('ADMIN', 'SUPER_ADMIN'), false)
      or coalesce((auth.jwt() -> 'app_metadata' ->> 'approved'), 'true') <> 'false';
$$;

grant execute on function public.is_approved() to anon, authenticated, service_role;

-- 2 + 3. One guard on everything a buyer can start.
create or replace function public.guard_buyer_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meta jsonb;
  v_created timestamptz;
  v_open int;
  v_limit int;
begin
  if new.buyer_id is null then
    return new;
  end if;

  select raw_app_meta_data, created_at into v_meta, v_created from auth.users where id = new.buyer_id;
  if v_meta is null then
    return new;
  end if;

  if coalesce(v_meta ->> 'approved', 'true') = 'false' and coalesce(v_meta ->> 'role', '') not in ('ADMIN', 'SUPER_ADMIN') then
    raise exception 'This account is on hold. Please message us on TikTok @cardunion or Facebook (Card Union).';
  end if;

  if tg_table_name = 'card_claims' then
    if coalesce(new.is_live_sale, false) = false and new.status = 'PENDING' then
      select count(*) into v_open
      from card_claims
      where buyer_id = new.buyer_id and status = 'PENDING' and coalesce(is_live_sale, false) = false;
      v_limit := case when now() - v_created < interval '3 days' then 10 else 40 end;
      if v_open >= v_limit then
        raise exception 'You have too many unpaid orders at once (the limit right now is %). Please get your open orders paid or cancelled first.', v_limit;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_buyer_activity_claims on public.card_claims;
create trigger guard_buyer_activity_claims before insert on public.card_claims
  for each row execute function public.guard_buyer_activity();

drop trigger if exists guard_buyer_activity_offers on public.offers;
create trigger guard_buyer_activity_offers before insert on public.offers
  for each row execute function public.guard_buyer_activity();

drop trigger if exists guard_buyer_activity_dibs on public.dibs_queue;
create trigger guard_buyer_activity_dibs before insert on public.dibs_queue
  for each row execute function public.guard_buyer_activity();
