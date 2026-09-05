-- Raises the minimum offer from 75% to 85% of listed price, and adds
-- cards.is_negotiable - an admin-set per-card toggle for whether buyers can
-- Make Offer at all (CardDetail hides the button client-side; this is the
-- server-side backstop, since a client check alone can't actually stop a
-- direct RPC call). Run this once in the Supabase SQL editor. Safe to run
-- more than once.

alter table cards add column if not exists is_negotiable boolean not null default true;

create or replace function submit_offer(
  p_card_id uuid,
  p_offered_amount numeric,
  p_note text default null
)
returns offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_handle text;
  v_card cards;
  v_offer offers;
  v_recent_count int;
begin
  if v_buyer_id is null then
    raise exception 'Not signed in.';
  end if;

  select handle into v_handle from profiles where id = v_buyer_id;
  if not found then
    raise exception 'Buyer profile not found.';
  end if;

  if not exists (
    select 1 from auth.users where id = v_buyer_id and email_confirmed_at is not null
  ) then
    raise exception 'Please confirm your email before making an offer.';
  end if;

  if exists (
    select 1 from offers
    where card_id = p_card_id and buyer_id = v_buyer_id
      and status in ('PENDING', 'COUNTERED', 'ACCEPTED')
  ) then
    raise exception 'You already have an open offer on this card.';
  end if;

  select count(*) into v_recent_count
    from offers
    where buyer_id = v_buyer_id and created_at > now() - interval '1 minute';
  if v_recent_count >= 10 then
    raise exception 'Too many offers submitted - please wait a moment and try again';
  end if;

  select * into v_card from cards where id = p_card_id;

  if not found then
    raise exception 'Card not found';
  end if;

  if v_card.status = 'SOLD' then
    raise exception 'Card is already sold';
  end if;

  if not v_card.is_negotiable then
    raise exception 'This listing is not open to offers.';
  end if;

  if p_offered_amount > v_card.price or p_offered_amount < v_card.price * 0.85 then
    raise exception 'Offer must be between 85%% and 100%% of the listed price';
  end if;

  begin
    insert into offers (card_id, buyer_id, buyer_handle, offered_amount, note)
      values (p_card_id, v_buyer_id, v_handle, p_offered_amount, p_note)
      returning * into v_offer;
  exception when unique_violation then
    raise exception 'You already have an open offer on this card.';
  end;

  if v_card.admin_id is not null then
    begin
      insert into notifications (recipient_id, type, title, body, link)
        values (
          v_card.admin_id,
          'offer_received',
          'New offer received',
          v_handle || ' offered ' || p_offered_amount || ' on "' || v_card.title || '".',
          '/admin/offers'
        );
    exception when others then null;
    end;
  end if;

  return v_offer;
end;
$$;
