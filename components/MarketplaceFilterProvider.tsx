"use client";

import { createContext, useContext, useState } from "react";

export type CategoryFilter = "ALL" | "RAW" | "GRADED" | "FLASH_SALE";

interface MarketplaceFilterContextValue {
  query: string;
  setQuery: (q: string) => void;
  category: CategoryFilter;
  setCategory: (c: CategoryFilter) => void;
  /** A Rarity value (see lib/rarity.ts) or "ALL" - a separate field from `category` since rarity has too many values for the pill-style filter. */
  rarity: string;
  setRarity: (r: string) => void;
}

const MarketplaceFilterContext = createContext<MarketplaceFilterContextValue | null>(null);

export function MarketplaceFilterProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("ALL");
  const [rarity, setRarity] = useState("ALL");

  return (
    <MarketplaceFilterContext.Provider value={{ query, setQuery, category, setCategory, rarity, setRarity }}>
      {children}
    </MarketplaceFilterContext.Provider>
  );
}

export function useMarketplaceFilter(): MarketplaceFilterContextValue {
  const ctx = useContext(MarketplaceFilterContext);
  if (!ctx) throw new Error("useMarketplaceFilter must be used within MarketplaceFilterProvider");
  return ctx;
}
