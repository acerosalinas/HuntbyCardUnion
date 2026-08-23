import { cn } from "@/lib/utils";

export type ClaimStage = "PENDING_PAYMENT" | "PAID" | "SHIPPED" | "RECEIVED";

const STAGE_ORDER: ClaimStage[] = ["PENDING_PAYMENT", "PAID", "SHIPPED", "RECEIVED"];

const STAGE_LABELS: Record<ClaimStage, string> = {
  PENDING_PAYMENT: "Pending Payment",
  PAID: "Paid",
  SHIPPED: "Shipped",
  RECEIVED: "Received",
};

/** Compact 4-segment progress bar for a claim's Pending Payment -> Paid -> Shipped -> Received tracker. */
export function ClaimStageTracker({
  stage,
  fulfillmentMethod,
}: {
  stage: ClaimStage;
  fulfillmentMethod?: "SHIP" | "STASH" | null;
}) {
  const currentIndex = STAGE_ORDER.indexOf(stage);
  const label = stage === "SHIPPED" && fulfillmentMethod === "STASH" ? "Stashed" : STAGE_LABELS[stage];

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        {STAGE_ORDER.map((s, i) => (
          <div key={s} className={cn("h-1.5 flex-1 rounded-full", i <= currentIndex ? "bg-gold" : "bg-card-border")} />
        ))}
      </div>
      <p className="text-xs font-medium text-foreground-muted">{label}</p>
    </div>
  );
}
