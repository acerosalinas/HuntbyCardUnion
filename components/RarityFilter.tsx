"use client";

import { Select } from "@/components/ui/Select";
import { RARITIES } from "@/lib/rarity";
import { useMarketplaceFilter } from "@/components/MarketplaceFilterProvider";

export function RarityFilter({ className }: { className?: string }) {
  const { rarity, setRarity } = useMarketplaceFilter();

  return (
    <Select value={rarity} onChange={(e) => setRarity(e.target.value)} className={className}>
      <option value="ALL">All Rarities</option>
      {RARITIES.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </Select>
  );
}
