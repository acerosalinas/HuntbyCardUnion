/**
 * Rarity vocabulary is per-franchise (Pokémon and One Piece TCG use entirely
 * different rarity tiers) - the admin listing forms show only the tiers for
 * whichever franchise is currently selected. "Other" is appended to every
 * list as a catch-all so a seller is never blocked by a card that doesn't
 * fit a known tier.
 */

const POKEMON_RARITIES = [
  "Common",
  "Uncommon",
  "Rare",
  "Double Rare",
  "Ultra Rare",
  "Illustration Rare",
  "Special Illustration Rare",
  "Hyper Rare",
  "ACE SPEC Rare",
  "Shiny Rare",
  "Shiny Ultra Rare",
  "Mega Attack Rare",
  "Mega Hyper Rare",
  "Other",
] as const;

const ONE_PIECE_RARITIES = [
  "Common",
  "Uncommon",
  "Leader",
  "Rare",
  "Super Rare",
  "Secret Rare",
  "Parallel Rare (Alternate Art)",
  "Special Rare",
  "Pirate Crew Super Parallel",
  "Treasure Rare",
  "Manga Rare",
  "Other",
] as const;

/** The "BASE TIERS" from each game's own rarity chart - everything else is a chase/secret tier. Drives RarityBadge's tone. */
const POKEMON_BASE_TIERS = new Set<string>(["Common", "Uncommon", "Rare", "Double Rare", "Ultra Rare", "Other"]);
const ONE_PIECE_BASE_TIERS = new Set<string>(["Common", "Uncommon", "Leader", "Rare", "Other"]);

const FRANCHISE_RARITIES: Record<string, readonly string[]> = {
  pokemon: POKEMON_RARITIES,
  "one-piece": ONE_PIECE_RARITIES,
};

/** Union of every franchise's rarities, deduped - used where there's no single franchise in context (e.g. the marketplace-wide rarity filter). */
export const RARITIES: string[] = [...new Set(Object.values(FRANCHISE_RARITIES).flat())];

export const DEFAULT_RARITY = "Other";

/** The rarity dropdown options for a given franchise slug - falls back to the full combined list for an unknown/future franchise. */
export function raritiesForFranchise(franchiseSlug: string | null | undefined): readonly string[] {
  if (!franchiseSlug) return RARITIES;
  return FRANCHISE_RARITIES[franchiseSlug] ?? RARITIES;
}

/** Bucketed into 2 tones rather than one per rarity - "chase" cards (a franchise's secret/collector tiers) get the eye-catching treatment, base tiers stay neutral. */
export function rarityTone(franchiseSlug: string | null | undefined, rarity: string): "rarity-standard" | "rarity-chase" {
  const baseTiers =
    franchiseSlug === "pokemon" ? POKEMON_BASE_TIERS : franchiseSlug === "one-piece" ? ONE_PIECE_BASE_TIERS : null;
  if (!baseTiers) return "rarity-standard";
  return baseTiers.has(rarity) ? "rarity-standard" : "rarity-chase";
}
