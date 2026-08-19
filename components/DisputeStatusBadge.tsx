import { Badge } from "@/components/ui/Badge";
import { DisputeStatus } from "@/types/marketplace";
import { DISPUTE_STATUS_LABELS } from "@/lib/disputeLabels";

const TONES: Record<DisputeStatus, "pending" | "gold" | "available" | "neutral"> = {
  OPEN: "pending",
  SELLER_RESPONDED: "gold",
  UNDER_REVIEW: "gold",
  RESOLVED_REFUND: "available",
  RESOLVED_DISMISSED: "neutral",
};

export function DisputeStatusBadge({ status }: { status: DisputeStatus }) {
  return <Badge tone={TONES[status]}>{DISPUTE_STATUS_LABELS[status]}</Badge>;
}
