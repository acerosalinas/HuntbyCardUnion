-- Live Tracker: mark a single card unpaid again (fix a "paid" tick made by mistake).
-- Run once in the Supabase SQL editor AFTER migration_live_tracker_payment_cards.sql.
-- Safe to paste and run more than once.
--
-- A card is paid through payments that were recorded AGAINST it (ticked cards,
-- the one-tap Paid button, a confirmed customer proof). Marking it unpaid takes
-- exactly that card's share back out of those payments: the share is removed,
-- the payment shrinks by the same amount (or disappears if that was all of it),
-- so the customer's balance goes back up. Everything happens in one transaction.
-- Payments NOT recorded against specific cards (older automatic ones) are
-- untouched - those are undone from the Payments list instead.

create or replace function tracker_revert_card_payment(p_owner uuid, p_sale uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_amount numeric;
  v_total numeric := 0;
begin
  perform 1 from tracker_sales where id = p_sale and owner_id = p_owner;
  if not found then
    raise exception 'Card not found.';
  end if;

  for r in
    select a.payment_id, sum(a.amount) as share
    from tracker_payment_allocations a
    where a.sale_id = p_sale and a.owner_id = p_owner
    group by a.payment_id
  loop
    select amount into v_amount from tracker_payments where id = r.payment_id and owner_id = p_owner for update;
    if not found then
      continue;
    end if;

    delete from tracker_payment_allocations where payment_id = r.payment_id and sale_id = p_sale and owner_id = p_owner;

    if v_amount - r.share <= 0.004 then
      -- That card was the whole payment. Remove the payment instead of shrinking it to 0 (payments must be > 0).
      delete from tracker_payments where id = r.payment_id and owner_id = p_owner;
    else
      update tracker_payments set amount = round(v_amount - r.share, 2) where id = r.payment_id and owner_id = p_owner;
    end if;
    v_total := v_total + r.share;
  end loop;

  return v_total;
end;
$$;

revoke all on function tracker_revert_card_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function tracker_revert_card_payment(uuid, uuid) to service_role;

-- Mark a card unpaid even when it was paid by an AUTOMATIC payment (one never tied to
-- specific cards). The app works out which payment covered which card, then:
--   1. FREEZES every other card's coverage as explicit rows (so removing this card's money
--      can't let the remaining money slide back onto it, it being the oldest), then
--   2. deletes this card's rows and takes its share out of each payment that covered it
--      (a payment that was entirely this card is removed, never shrunk to 0).
-- All in one transaction. p_freeze / p_reductions are computed by the server action.
create or replace function tracker_revert_card_full(p_owner uuid, p_sale uuid, p_freeze jsonb, p_reductions jsonb)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_amount numeric;
  v_total numeric := 0;
begin
  perform 1 from tracker_sales where id = p_sale and owner_id = p_owner;
  if not found then
    raise exception 'Card not found.';
  end if;

  insert into tracker_payment_allocations (owner_id, payment_id, sale_id, amount)
  select p_owner, (e ->> 'payment_id')::uuid, (e ->> 'sale_id')::uuid, (e ->> 'amount')::numeric
  from jsonb_array_elements(p_freeze) e
  where (e ->> 'sale_id')::uuid <> p_sale
    and (e ->> 'amount')::numeric > 0
    and exists (select 1 from tracker_payments p where p.id = (e ->> 'payment_id')::uuid and p.owner_id = p_owner)
    and exists (select 1 from tracker_sales s where s.id = (e ->> 'sale_id')::uuid and s.owner_id = p_owner);

  delete from tracker_payment_allocations where sale_id = p_sale and owner_id = p_owner;

  for r in
    select (e ->> 'payment_id')::uuid as payment_id, (e ->> 'amount')::numeric as amount
    from jsonb_array_elements(p_reductions) e
  loop
    select amount into v_amount from tracker_payments where id = r.payment_id and owner_id = p_owner for update;
    if not found then
      continue;
    end if;
    if v_amount - r.amount <= 0.004 then
      delete from tracker_payments where id = r.payment_id and owner_id = p_owner;
    else
      update tracker_payments set amount = round(v_amount - r.amount, 2) where id = r.payment_id and owner_id = p_owner;
    end if;
    v_total := v_total + r.amount;
  end loop;

  return v_total;
end;
$$;

revoke all on function tracker_revert_card_full(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function tracker_revert_card_full(uuid, uuid, jsonb, jsonb) to service_role;
