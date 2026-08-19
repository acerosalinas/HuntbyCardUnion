import { DisputeReason, DisputeStatus } from "@/types/marketplace";

export const DISPUTE_REASON_LABELS: Record<DisputeReason, string> = {
  ITEM_NOT_RECEIVED: "Item Not Received",
  NOT_AS_DESCRIBED: "Not as Described",
  DAMAGED_IN_TRANSIT: "Damaged in Transit",
  OTHER: "Other",
};

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  OPEN: "Open",
  SELLER_RESPONDED: "Seller Responded",
  UNDER_REVIEW: "Under Review",
  RESOLVED_REFUND: "Resolved — Refunded",
  RESOLVED_DISMISSED: "Resolved — Dismissed",
};
