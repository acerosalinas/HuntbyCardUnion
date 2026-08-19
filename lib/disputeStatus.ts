import { DisputeStatus } from "@/types/marketplace";

export const TERMINAL_DISPUTE_STATUSES: DisputeStatus[] = ["RESOLVED_REFUND", "RESOLVED_DISMISSED"];

export function isDisputeResolved(status: DisputeStatus): boolean {
  return TERMINAL_DISPUTE_STATUSES.includes(status);
}

const ALLOWED_TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  OPEN: ["SELLER_RESPONDED", "UNDER_REVIEW", "RESOLVED_REFUND", "RESOLVED_DISMISSED"],
  SELLER_RESPONDED: ["UNDER_REVIEW", "RESOLVED_REFUND", "RESOLVED_DISMISSED"],
  UNDER_REVIEW: ["RESOLVED_REFUND", "RESOLVED_DISMISSED"],
  RESOLVED_REFUND: [],
  RESOLVED_DISMISSED: [],
};

/** Whether a dispute may move from `from` to `to`. Resolutions are terminal - see supabase/schema.sql / project plan for why reopening isn't supported. */
export function canTransitionDispute(from: DisputeStatus, to: DisputeStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
