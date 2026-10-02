"use client";

import { Clock } from "lucide-react";
import { useCountdown } from "@/hooks/useCountdown";
import { formatCountdown } from "@/lib/utils";

/**
 * Live "time left on this offer's hold" readout (duration is seller-configurable, see seller_profiles.offer_hold_hours) - see
 * migration_offer_hold.sql. `heldUntil` is null once the seller has
 * countered or accepted (no more auto-expiry at that point), in which case
 * this renders nothing rather than a stale/meaningless countdown.
 */
export function HoldCountdown({ heldUntil, className }: { heldUntil: number | null; className?: string }) {
  const remainingMs = useCountdown(heldUntil);
  if (!heldUntil) return null;
  return (
    <span className={className ?? "flex items-center gap-1 text-pending"}>
      <Clock size={12} />
      {remainingMs > 0 ? `${formatCountdown(remainingMs)} left` : "Expiring any moment"}
    </span>
  );
}
