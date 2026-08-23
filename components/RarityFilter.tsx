"use client";

import { useEffect } from "react";
import { Select } from "@/components/ui/Select";
import { raritiesForFranchise } from "@/lib/rarity";
import { useMarketplaceFilter } from "@/components/MarketplaceFilterProvider";

export function RarityFilter({ franchiseSlug, className }: { franchiseSlug: string | null; className?: string }) {
  const { rarity, setRarity } = useMarketplaceFilter();
  const options = raritiesForFranchise(franchiseSlug);

  // Switching from "All Cards" (or between franchises) can leave a
  // previously-selected rarity that doesn't exist in the new scope's list -
  // reset rather than hold a <select> value with no matching <option>.
  useEffect(() => {
    if (rarity !== "ALL" && !options.includes(rarity)) {
      setRarity("ALL");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-check when the franchise scope (and therefore `options`) actually changes, not on every rarity selection
  }, [franchiseSlug]);

  return (
    <Select value={rarity} onChange={(e) => setRarity(e.target.value)} className={className}>
      <option value="ALL">All Rarities</option>
      {options.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </Select>
  );
}
