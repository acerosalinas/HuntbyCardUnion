"use client";

import { Search } from "lucide-react";
import { useMarketplaceFilter } from "@/components/MarketplaceFilterProvider";

export function SearchBar({ className }: { className?: string }) {
  const { query, setQuery } = useMarketplaceFilter();

  return (
    <div className={className}>
      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search card, set, player, or grade..."
          className="w-full rounded-full border border-card-border bg-background-elevated py-2 pl-9 pr-4 text-sm text-foreground placeholder:text-foreground-muted outline-none transition-colors focus:border-gold focus:ring-2 focus:ring-gold/20"
        />
      </div>
    </div>
  );
}
