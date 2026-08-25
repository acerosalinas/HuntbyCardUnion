export interface Franchise {
  slug: string;
  label: string;
}

/** Known franchises. Add an entry here to add a new pedestal + browse page. */
export const FRANCHISES: Franchise[] = [
  { slug: "pokemon", label: "Pokémon" },
  { slug: "one-piece", label: "One Piece" },
];

/** Case-insensitive on purpose - stored/URL casing has drifted before (e.g. legacy rows saved as "Pokemon"), and slug/label lookups should never silently fail over that. */
export function getFranchiseBySlug(slug: string): Franchise | undefined {
  return FRANCHISES.find((f) => f.slug.toLowerCase() === slug.toLowerCase());
}

/**
 * Resolves any casing of a stored franchise value back to its canonical
 * slug so downstream `=== "pokemon"` comparisons - the Type filter,
 * franchise-scoped rarity dropdown, admin Type field - don't silently fail
 * on casing drift. Falls back to the raw value unchanged if it doesn't match
 * any known franchise.
 */
export function normalizeFranchise(value: string | null): string | null {
  if (!value) return value;
  return getFranchiseBySlug(value)?.slug ?? value;
}
