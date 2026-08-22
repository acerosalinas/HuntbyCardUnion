import { Badge } from "@/components/ui/Badge";
import { CardStatus } from "@/types/marketplace";

const config: Record<CardStatus, { label: string; tone: "available" | "pending" | "sold" | "neutral" }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  AVAILABLE: { label: "Available", tone: "available" },
  PENDING: { label: "Dibs Pending", tone: "pending" },
  SOLD: { label: "Sold", tone: "sold" },
};

export function StatusBadge({ status }: { status: CardStatus }) {
  const { label, tone } = config[status];
  return <Badge tone={tone}>{label}</Badge>;
}
