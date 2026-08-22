import { CardStatus } from "@/types/marketplace";

const ALLOWED_TRANSITIONS: Record<CardStatus, CardStatus[]> = {
  // Publishing a bulk-upload draft (see Rapid Fill, publishDrafts in
  // app/admin/actions.ts) is the only way out of DRAFT - nothing goes back
  // into it once published.
  DRAFT: ["AVAILABLE"],
  AVAILABLE: ["PENDING"],
  PENDING: ["AVAILABLE", "SOLD"],
  SOLD: [],
};

/** Whether a card may move from `from` to `to`. */
export function canTransitionCardStatus(from: CardStatus, to: CardStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
