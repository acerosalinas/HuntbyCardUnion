"use client";

import { createContext, useContext, useState } from "react";

export type CategoryFilter = "ALL" | "RAW" | "GRADED" | "SEALED" | "FLASH_SALE";

interface MarketplaceFilterContextValue {
  query: string;
  setQuery: (q: string) => void;
  category: CategoryFilter;
  setCategory: (c: CategoryFilter) => void;
  /** A Rarity value (see lib/rarity.ts) or "ALL" - a separate field from `category` since rarity has too many values for the pill-style filter. */
  rarity: string;
  setRarity: (r: string) => void;
  /** A Pokemon TCG energy type value (see lib/pokemonType.ts) or "ALL" - Pokemon-only, PokemonTypeFilter hides itself unless franchiseScope === "pokemon". */
  pokemonType: string;
  setPokemonType: (t: string) => void;
  /**
   * The franchise slug the currently-viewed card grid is scoped to, or null
   * if it mixes franchises (e.g. the all-cards marketplace, or a seller who
   * lists more than one game) - set by whichever grid component is actually
   * mounted (Marketplace.tsx for /marketplace and /[franchise], or
   * SellerListingsView.tsx for a seller's profile, deriving it from that
   * seller's own cards since the URL alone doesn't say which game(s) they
   * sell). RarityFilter reads this to show only that franchise's rarity
   * tiers instead of every game's combined.
   */
  franchiseScope: string | null;
  setFranchiseScope: (slug: string | null) => void;
}

const MarketplaceFilterContext = createContext<MarketplaceFilterContextValue | null>(null);

export function MarketplaceFilterProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("ALL");
  const [rarity, setRarity] = useState("ALL");
  const [pokemonType, setPokemonType] = useState("ALL");
  const [franchiseScope, setFranchiseScope] = useState<string | null>(null);

  return (
    <MarketplaceFilterContext.Provider
      value={{
        query,
        setQuery,
        category,
        setCategory,
        rarity,
        setRarity,
        pokemonType,
        setPokemonType,
        franchiseScope,
        setFranchiseScope,
      }}
    >
      {children}
    </MarketplaceFilterContext.Provider>
  );
}

export function useMarketplaceFilter(): MarketplaceFilterContextValue {
  const ctx = useContext(MarketplaceFilterContext);
  if (!ctx) throw new Error("useMarketplaceFilter must be used within MarketplaceFilterProvider");
  return ctx;
}
