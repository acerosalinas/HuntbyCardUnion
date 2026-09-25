"use client";

import { ArrowUpDown } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { SortOption, useMarketplaceFilter } from "@/components/MarketplaceFilterProvider";
import { cn } from "@/lib/utils";

const OPTIONS: { value: SortOption; label: string }[] = [
  { value: "NEWEST", label: "Newest first" },
  { value: "OLDEST", label: "Oldest first" },
  { value: "PRICE_LOW", label: "Price: low to high" },
  { value: "PRICE_HIGH", label: "Price: high to low" },
];

/** Compact sort dropdown shared by every card grid - a native select, so phones get their own picker. */
export function SortMenu({ className }: { className?: string }) {
  const { sort, setSort } = useMarketplaceFilter();

  return (
    <label className={cn("relative inline-flex items-center", className)}>
      <span className="sr-only">Sort listings</span>
      <ArrowUpDown size={14} className="pointer-events-none absolute left-2.5 text-foreground-muted" />
      <Select value={sort} onChange={(e) => setSort(e.target.value as SortOption)} className="w-auto py-1.5 pl-8 pr-3">
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  );
}
