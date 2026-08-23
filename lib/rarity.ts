export const RARITIES = ["Common", "Uncommon", "Rare", "Ultra Rare", "Secret Rare", "Promo", "Other"] as const;

export type Rarity = (typeof RARITIES)[number];

export const DEFAULT_RARITY: Rarity = "Other";

/** Bucketed into 2 tones rather than one per rarity - "chase" cards get the eye-catching treatment, everything else stays neutral. */
export const RARITY_TONE: Record<Rarity, "rarity-standard" | "rarity-chase"> = {
  Common: "rarity-standard",
  Uncommon: "rarity-standard",
  Rare: "rarity-standard",
  Other: "rarity-standard",
  "Ultra Rare": "rarity-chase",
  "Secret Rare": "rarity-chase",
  Promo: "rarity-chase",
};

export function rarityTone(rarity: string): "rarity-standard" | "rarity-chase" {
  return RARITY_TONE[rarity as Rarity] ?? "rarity-standard";
}
