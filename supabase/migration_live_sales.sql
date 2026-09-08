-- Live Sales - a super admin running a Facebook Live stream can assign a
-- card straight to a buyer's account (findBuyerByHandle/assignLiveSale/
-- removeLiveSale in app/admin/actions.ts) instead of checking it out under
-- their own account. is_live_sale marks which card_claims rows came from
-- that flow, so the new /admin/live-sales page can show just those -
-- separate from the regular Sales Log, which still shows every sale
-- regardless of channel. Run this once in the Supabase SQL editor. Safe to
-- run more than once.

alter table card_claims add column if not exists is_live_sale boolean not null default false;

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
  'card_claimed', 'queue_promoted', 'claim_shipped', 'wanted_card_fulfilled', 'ship_requested',
  'payment_confirmed', 'listing_cancelled', 'dispute_opened',
  'dispute_withdrawn', 'dispute_response', 'dispute_under_review', 'dispute_resolved',
  'claim_cancelled_by_buyer', 'review_received', 'live_sale_assigned'
));
