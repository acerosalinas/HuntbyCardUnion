"use client";

import { createContext, useContext, useState } from "react";

export type CategoryFilter = "ALL" | "RAW" | "GRADED" | "FLASH_SALE";

interface MarketplaceFilterContextValue {
  query: string;
  setQuery: (q: string) => void;
  category: CategoryFilter;
  setCategory: (c: CategoryFilter) => void;
}

const MarketplaceFilterContext = createContext<MarketplaceFilterContextValue | null>(null);

export function MarketplaceFilterProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("ALL");

  return (
    <MarketplaceFilterContext.Provider value={{ query, setQuery, category, setCategory }}>
      {children}
    </MarketplaceFilterContext.Provider>
  );
}

export function useMarketplaceFilter(): MarketplaceFilterContextValue {
  const ctx = useContext(MarketplaceFilterContext);
  if (!ctx) throw new Error("useMarketplaceFilter must be used within MarketplaceFilterProvider");
  return ctx;
}
