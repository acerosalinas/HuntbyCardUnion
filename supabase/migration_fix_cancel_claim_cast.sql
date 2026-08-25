-- Fixes the same bug that hit place_order earlier: a bare `case when ... end`
-- assigned to cards.status resolves to plain text, not the card_status enum,
-- even though every branch is a valid label - Postgres then rejects it with
-- "column "status" is of type card_status but expression is of type text".
-- cancel_claim was fixed for this in schema.sql a while back, but that fix
-- apparently never made it to the live database - run this once in the
-- Supabase SQL editor. Safe to run more than once (create or replace).

create or replace function cancel_claim(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_claim card_claims;
  v_card cards;
  v_new_available int;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_claim from card_claims where id = p_claim_id for update;
  if not found or v_claim.buyer_id is distinct from v_buyer_id then
    raise exception 'Claim not found.';
  end if;
  if v_claim.status != 'PENDING' then
    raise exception 'This claim can no longer be cancelled - it has already been paid or cancelled.';
  end if;

  select * into v_card from cards where id = v_claim.card_id for update;
  if not found then
    raise exception 'Card not found.';
  end if;

  update card_claims set status = 'CANCELLED' where id = p_claim_id;

  v_new_available := v_card.quantity_available + v_claim.quantity;
  update cards
    set quantity_available = v_new_available,
        status = (case when v_new_available > 0 then 'AVAILABLE' else 'SOLD' end)::card_status,
        price = v_card.list_price
    where id = v_claim.card_id;

  update dibs_queue set status = 'CANCELLED' where card_id = v_claim.card_id and status = 'WAITING';

  if v_card.admin_id is not null then
    begin
      insert into notifications (recipient_id, type, title, body, link)
        values (
          v_card.admin_id,
          'claim_cancelled_by_buyer',
          'Buyer cancelled a claim',
          v_claim.buyer_handle || ' cancelled their claim on "' || v_card.title || '".',
          '/admin'
        );
    exception when others then null;
    end;
  end if;
end;
$$;

revoke execute on function cancel_claim(uuid) from public;
grant execute on function cancel_claim(uuid) to authenticated;
