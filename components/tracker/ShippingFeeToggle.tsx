"use client";

import { Truck } from "lucide-react";
import { cn } from "@/lib/utils";

/** Off by default everywhere: a copied invoice only carries a shipping fee when you switch this on. */
export function ShippingFeeToggle({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title="Add the shipping fee to copied invoices"
      onClick={() => onChange(!on)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
        on ? "border-gold bg-gold/15 text-foreground" : "border-card-border text-foreground-muted hover:text-foreground",
      )}
    >
      <Truck size={14} />
      Shipping fee: {on ? "added" : "not added"}
    </button>
  );
}
