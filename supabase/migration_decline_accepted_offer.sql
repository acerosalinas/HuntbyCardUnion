-- Decline-an-accepted-offer migration.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to paste and run more than once.
--
-- What this does: respond_to_offer(p_offer_id, p_accept) previously only
-- worked on a COUNTERED offer (accept or decline the counter). Now a buyer
-- can also call it with p_accept = false on an ACCEPTED offer, to back out
-- of a price they already agreed to but haven't spent yet via place_order
-- (no card_claims row exists until then, so there's nothing to unwind on
-- the claim side). The admin-side equivalent (declineOffer in
-- app/admin/actions.ts) needs no DB change - it's a plain Server Action.

-- Buyer-callable: responds to an admin's counter with an accept or decline,
-- OR backs out of an offer already ACCEPTED (p_accept = false only - "undo"
-- makes no sense once already accepted, and a card_claims row only ever
-- gets created via place_order's own offer_id handling, never here, so
-- there's nothing to unwind on the claim side). Mirrors submit_offer's
-- auth-check shape (security definer, auth.uid() ownership check) rather
-- than going through RLS, since this has real business logic (status
-- transition validation) beyond a plain owned-row write.
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

  if v_offer.status = 'ACCEPTED' then
    if p_accept then
      raise exception 'This offer is already accepted.';
    end if;
    update offers set status = 'BUYER_DECLINED'
      where id = p_offer_id
      returning * into v_offer;
    return v_offer;
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
