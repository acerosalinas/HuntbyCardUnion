import { CardStatus } from "@/types/marketplace";

const ALLOWED_TRANSITIONS: Record<CardStatus, CardStatus[]> = {
  // Publishing a bulk-upload draft (see Rapid Fill, publishDrafts in
  // app/admin/actions.ts) is the only way out of DRAFT - nothing goes back
  // into it once published. PENDING is no longer a row-level status (a card
  // can have some units claimed and some still available at once, tracked
  // per-buyer in card_claims) - AVAILABLE/SOLD is now driven purely by
  // quantity_available, in either direction, by whichever action changes it
  // (place_order, confirmPaid, cancelRelist, promoteNextInQueue, acceptOffer).
  DRAFT: ["AVAILABLE"],
  AVAILABLE: ["SOLD"],
  PENDING: [],
  SOLD: ["AVAILABLE"],
};

/** Whether a card may move from `from` to `to`. */
export function canTransitionCardStatus(from: CardStatus, to: CardStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
