"use client";

import { useEffect } from "react";
import { Select } from "@/components/ui/Select";
import { POKEMON_TYPES } from "@/lib/pokemonType";
import { useMarketplaceFilter } from "@/components/MarketplaceFilterProvider";

/** Pokemon-only filter - renders nothing unless the current grid is scoped to the Pokemon franchise. */
export function PokemonTypeFilter({ className }: { className?: string }) {
  const { pokemonType, setPokemonType, franchiseScope } = useMarketplaceFilter();
  const isPokemon = franchiseScope === "pokemon";

  // Leaving the Pokemon scope should clear a stale type selection rather
  // than silently keep filtering a grid that no longer shows the dropdown.
  useEffect(() => {
    if (!isPokemon && pokemonType !== "ALL") {
      setPokemonType("ALL");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-check when the franchise scope changes, not on every type selection
  }, [isPokemon]);

  if (!isPokemon) return null;

  return (
    <Select value={pokemonType} onChange={(e) => setPokemonType(e.target.value)} className={className}>
      <option value="ALL">All Types</option>
      {POKEMON_TYPES.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </Select>
  );
}
