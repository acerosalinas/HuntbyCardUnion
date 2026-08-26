-- Sealed Products migration.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to paste and run more than once.
--
-- What this does: adds product_type ('CARD' default, or 'SEALED') and
-- sealed_type ('BOOSTER_BOX' | 'BOOSTER_PACK' | 'ETB' | 'BUNDLE') to cards.
-- Sealed listings reuse the exact same claim/cart/shipping/dispute/review
-- pipeline as singles - condition_grade/rarity stay NOT NULL for them too,
-- just holding fixed placeholder values ('Sealed' / 'Other') the UI knows
-- to never actually display for product_type = 'SEALED'.

alter table cards add column if not exists product_type text not null default 'CARD';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cards_product_type_check') then
    alter table cards add constraint cards_product_type_check check (product_type in ('CARD', 'SEALED'));
  end if;
end $$;

alter table cards add column if not exists sealed_type text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cards_sealed_type_check') then
    alter table cards add constraint cards_sealed_type_check
      check (sealed_type in ('BOOSTER_BOX', 'BOOSTER_PACK', 'ETB', 'BUNDLE'));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cards_product_type_sealed_type_check') then
    alter table cards add constraint cards_product_type_sealed_type_check
      check (
        (product_type = 'SEALED' and sealed_type is not null)
        or (product_type = 'CARD' and sealed_type is null)
      );
  end if;
end $$;
