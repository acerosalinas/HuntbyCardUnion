export interface Franchise {
  slug: string;
  label: string;
}

/** Known franchises. Add an entry here to add a new pedestal + browse page. */
export const FRANCHISES: Franchise[] = [
  { slug: "pokemon", label: "Pokémon" },
  { slug: "one-piece", label: "One Piece" },
];

export function getFranchiseBySlug(slug: string): Franchise | undefined {
  return FRANCHISES.find((f) => f.slug === slug);
}
