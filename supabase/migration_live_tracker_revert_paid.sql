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
    perform 1 from tracker_payments where id = r.payment_id and owner_id = p_owner for update;
    delete from tracker_payment_allocations where payment_id = r.payment_id and sale_id = p_sale and owner_id = p_owner;
    update tracker_payments set amount = round(amount - r.share, 2) where id = r.payment_id and owner_id = p_owner;
    -- Nothing left of that payment: remove it (its remaining allocation rows go with it).
    delete from tracker_payments where id = r.payment_id and owner_id = p_owner and amount <= 0;
    v_total := v_total + r.share;
  end loop;

  return v_total;
end;
$$;

revoke all on function tracker_revert_card_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function tracker_revert_card_payment(uuid, uuid) to service_role;
