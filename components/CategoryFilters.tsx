"use client";

import { cn } from "@/lib/utils";
import { CategoryFilter, useMarketplaceFilter } from "@/components/MarketplaceFilterProvider";

const options: { value: CategoryFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "RAW", label: "Raw" },
  { value: "GRADED", label: "Graded" },
  { value: "FLASH_SALE", label: "Flash Sale" },
];

export function CategoryFilters({ className }: { className?: string }) {
  const { category, setCategory } = useMarketplaceFilter();

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setCategory(opt.value)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-medium tracking-wide transition-colors",
            category === opt.value
              ? "border-gold bg-gold text-navy-950"
              : "border-card-border text-foreground-muted hover:border-gold/50 hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
