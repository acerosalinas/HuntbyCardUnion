/**
 * Allowed offer range as a fraction of a card's listed price - kept in sync
 * with the matching check in submit_offer() (supabase/schema.sql /
 * migration_offer_hold.sql). Changing either side here without updating the
 * SQL check (or vice versa) lets the frontend accept an offer the backend
 * then rejects, or the other way around.
 */
export const MIN_OFFER_FRACTION = 0.8;
export const MAX_OFFER_FRACTION = 1.2;

export function minOfferFor(price: number): number {
  return Math.ceil(price * MIN_OFFER_FRACTION);
}

export function maxOfferFor(price: number): number {
  return Math.floor(price * MAX_OFFER_FRACTION);
}
