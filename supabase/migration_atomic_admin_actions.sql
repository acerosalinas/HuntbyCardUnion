-- Atomic admin claim/stock mutations.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to run more than once - every
-- function is `create or replace`. Already included in full supabase/schema.sql
-- for fresh installs; this file exists only so it can be applied on its own
-- to a database that predates it.
--
-- What this does: the buyer-facing mutations in schema.sql (place_order,
-- cancel_claim, offers) all lock their rows with `for update` inside one
-- function call, so two concurrent buyers can never both succeed against
-- the same stock. The admin-side equivalents in app/admin/actions.ts
-- (confirmPaid, cancelRelist, promoteNextInQueue, assignLiveSale/
-- removeLiveSale, resolveDisputeRestock) didn't have that: they read a
-- claim/card, checked its status in JavaScript, then issued separate
-- .update() calls - two admin actions racing on the same claim (e.g. a
-- double-clicked "Confirm Paid" landing at the same time as a stale second
-- tab's "Cancel & Relist") could both pass the status check before either
-- write landed, leaving a claim marked paid while its stock was also
-- restored as if cancelled. These functions move the check-and-write into
-- one locked transaction, same pattern as cancel_claim.
-- ---------------------------------------------------------------------------

create or replace function confirm_paid_claim(p_claim_id uuid)
returns card_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim card_claims;
begin
  select * into v_claim from card_claims where id = p_claim_id for update;
  if not found then
    raise exception 'Claim not found';
  end if;
  if v_claim.status != 'PENDING' then
    raise exception 'This claim is no longer awaiting payment - it may have already been confirmed or cancelled.';
  end if;

  update card_claims
    set status = 'SOLD', confirmed_at = now()
    where id = p_claim_id
    returning * into v_claim;

  return v_claim;
end;
$$;

create or replace function cancel_relist_claim(p_claim_id uuid)
returns table (out_card_id uuid, out_buyer_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim card_claims;
  v_card cards;
  v_open_disputes int;
  v_new_available int;
begin
  select * into v_claim from card_claims where id = p_claim_id for update;
  if not found then
    raise exception 'Claim not found';
  end if;
  if v_claim.status != 'PENDING' then
    raise exception 'This claim is no longer awaiting payment - it may have already been cancelled or confirmed.';
  end if;

  select count(*) into v_open_disputes
    from disputes
    where claim_id = p_claim_id
      and status not in ('RESOLVED_REFUND', 'RESOLVED_DISMISSED');
  if v_open_disputes > 0 then
    raise exception 'This claim has an open dispute - resolve it before relisting.';
  end if;

  select * into v_card from cards where id = v_claim.card_id for update;
  if not found then
    raise exception 'Card not found';
  end if;

  update card_claims set status = 'CANCELLED' where id = p_claim_id;

  -- Restores the real listed price too, in case this claim came from an
  -- accepted offer and the card's `price` still carried that discount.
  v_new_available := v_card.quantity_available + v_claim.quantity;
  update cards
    set quantity_available = v_new_available,
        status = (case when v_new_available > 0 then 'AVAILABLE' else 'SOLD' end)::card_status,
        price = v_card.list_price
    where id = v_claim.card_id;

  return query select v_claim.card_id, v_claim.buyer_id;
end;
$$;

create or replace function promote_next_in_queue(p_card_id uuid)
returns table (out_promoted boolean, out_buyer_id uuid, out_buyer_handle text, out_unit_price numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card cards;
  v_next dibs_queue;
  v_unit_price numeric(10, 2);
  v_new_available int;
begin
  select * into v_card from cards where id = p_card_id for update;
  if not found then
    raise exception 'Card not found';
  end if;

  select * into v_next
    from dibs_queue
    where card_id = p_card_id
      and status = 'WAITING'
      and requested_quantity <= v_card.quantity_available
    order by created_at asc
    limit 1
    for update;

  if not found then
    return query select false, null::uuid, null::text, null::numeric;
    return;
  end if;

  v_unit_price := coalesce(v_next.locked_price, v_card.list_price);

  insert into card_claims (card_id, buyer_id, buyer_handle, quantity, unit_price, status, fulfillment_method, payment_method)
  values (p_card_id, v_next.buyer_id, v_next.buyer_handle, v_next.requested_quantity, v_unit_price, 'PENDING', v_next.fulfillment_method, v_next.payment_method);

  v_new_available := v_card.quantity_available - v_next.requested_quantity;
  update cards
    set quantity_available = v_new_available,
        status = (case when v_new_available > 0 then 'AVAILABLE' else 'SOLD' end)::card_status
    where id = p_card_id;

  update dibs_queue set status = 'PROMOTED' where id = v_next.id;

  return query select true, v_next.buyer_id, v_next.buyer_handle, v_unit_price;
end;
$$;

create or replace function assign_live_sale(
  p_card_id uuid,
  p_buyer_id uuid,
  p_buyer_handle text,
  p_fulfillment_method text,
  p_payment_method text
)
returns table (out_unit_price numeric, out_card_title text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card cards;
  v_new_available int;
begin
  select * into v_card from cards where id = p_card_id for update;
  if not found then
    raise exception 'Card not found';
  end if;
  if v_card.quantity_available <= 0 then
    raise exception 'This card has no stock left to assign.';
  end if;

  insert into card_claims (card_id, buyer_id, buyer_handle, quantity, unit_price, status, fulfillment_method, payment_method, is_live_sale)
  values (p_card_id, p_buyer_id, p_buyer_handle, 1, v_card.price, 'PENDING', p_fulfillment_method, p_payment_method, true);

  v_new_available := v_card.quantity_available - 1;
  update cards
    set quantity_available = v_new_available,
        status = (case when v_new_available > 0 then 'AVAILABLE' else 'SOLD' end)::card_status
    where id = p_card_id;

  return query select v_card.price, v_card.title;
end;
$$;

create or replace function remove_live_sale_claim(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim card_claims;
  v_card cards;
  v_open_disputes int;
  v_new_available int;
begin
  select * into v_claim from card_claims where id = p_claim_id for update;
  if not found then
    raise exception 'Claim not found';
  end if;
  if not v_claim.is_live_sale then
    raise exception 'Only live-assigned sales can be removed here.';
  end if;
  if v_claim.status != 'SOLD' then
    raise exception 'Only a confirmed sale can be removed - cancel a pending one instead.';
  end if;

  select count(*) into v_open_disputes
    from disputes
    where claim_id = p_claim_id
      and status not in ('RESOLVED_REFUND', 'RESOLVED_DISMISSED');
  if v_open_disputes > 0 then
    raise exception 'This claim has an open dispute - resolve it before removing.';
  end if;

  select * into v_card from cards where id = v_claim.card_id for update;
  if not found then
    raise exception 'Card not found';
  end if;

  v_new_available := v_card.quantity_available + v_claim.quantity;
  update cards
    set quantity_available = v_new_available,
        status = 'AVAILABLE'::card_status
    where id = v_claim.card_id;

  delete from card_claims where id = p_claim_id;
end;
$$;

create or replace function resolve_dispute_restock(p_dispute_id uuid, p_relist boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispute disputes;
  v_claim card_claims;
  v_card cards;
  v_new_available int;
begin
  select * into v_dispute from disputes where id = p_dispute_id for update;
  if not found then
    raise exception 'Dispute not found';
  end if;
  if v_dispute.status != 'RESOLVED_REFUND' then
    raise exception 'This dispute hasn''t been resolved as a refund.';
  end if;
  if v_dispute.claim_id is null then
    raise exception 'This dispute has no linked claim to restock.';
  end if;

  select * into v_claim from card_claims where id = v_dispute.claim_id for update;
  if not found then
    raise exception 'Claim not found';
  end if;
  if v_claim.status != 'SOLD' then
    raise exception 'This claim has already been dealt with.';
  end if;

  select * into v_card from cards where id = v_claim.card_id for update;
  if not found then
    raise exception 'Card not found';
  end if;

  update card_claims set status = 'CANCELLED' where id = v_dispute.claim_id;

  if p_relist then
    v_new_available := v_card.quantity_available + v_claim.quantity;
    update cards
      set quantity_available = v_new_available,
          status = (case when v_new_available > 0 then 'AVAILABLE' else 'SOLD' end)::card_status,
          price = v_card.list_price
      where id = v_claim.card_id;
  end if;

  return v_claim.card_id;
end;
$$;
