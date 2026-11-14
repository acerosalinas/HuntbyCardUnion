/**
 * One Piece Card Game catalog helpers (pure - no imports, so the import script can use them too).
 * Source data: the free OPTCG API (https://optcgapi.com, no key). One entry is one printing, including parallel / alternate-art / manga versions.
 */

/** A card as the OPTCG API returns it (only the fields we use). */
export interface OptcgRawCard {
  card_name: string;
  card_set_id: string; // "OP01-001"
  set_name: string;
  set_id: string; // "OP-01"
  rarity: string; // "L" "C" "UC" "R" "SR" "SEC" "TR" "PR"
  card_color?: string | null;
  card_type?: string | null;
  card_image_id: string; // "OP01-001", "OP01-001_p1" for a parallel printing
  card_image?: string | null;
}

/** One row of onepiece_catalog_cards. */
export interface OnePieceCatalogRow {
  id: string;
  card_code: string;
  name: string;
  variant: string | null;
  set_id: string;
  set_name: string;
  rarity_code: string;
  /** One of lib/rarity.ts's One Piece tiers. */
  rarity: string;
  color: string | null;
  card_type: string | null;
  image_url: string | null;
  /** Lower-case "name variant code set" so a search is one ILIKE per typed word. */
  search: string;
}

/** A pair of brackets that describes the ART of a printing, not the character ("Mr.3 (Galdino)" is a name; "(Parallel)" is a printing). */
const VARIANT_WORDS = /parallel|alternate art|reprint|^sp$|^spr$|foil|full art|manga|box topper|wanted poster|dash pack|pandaman art|super alternate|^tr$/i;
const CARD_CODE_LIKE = /^[A-Z]{1,3}\d{2}-\d{3}$/;

/**
 * "Monkey.D.Luffy (024) (Parallel)" -> { name: "Monkey.D.Luffy", variant: "Parallel" }.
 * The "(024)" is the card number (already in the code) and is dropped; "(Parallel)" and friends are kept as the variant; any other bracket
 * is part of the character's name ("Mr.3 (Galdino)") and stays in it.
 */
export function parseOnePieceName(raw: string): { name: string; variant: string | null } {
  const variants: string[] = [];
  const name = raw
    .replace(/\s*\(([^)]*)\)/g, (whole, inner: string) => {
      const t = inner.trim();
      if (/^\d+$/.test(t)) return "";
      if (VARIANT_WORDS.test(t) || CARD_CODE_LIKE.test(t)) {
        variants.push(t);
        return "";
      }
      return whole;
    })
    .replace(/\s+/g, " ")
    .trim();
  return { name, variant: variants.length > 0 ? variants.join(", ") : null };
}

const RARITY_BY_CODE: Record<string, string> = {
  L: "Leader",
  C: "Common",
  UC: "Uncommon",
  R: "Rare",
  SR: "Super Rare",
  SEC: "Secret Rare",
  TR: "Treasure Rare",
};

/** The site's One Piece rarity tier for a printing: art variants (manga, special, parallel) outrank the plain rarity code. */
export function mapOnePieceRarity(code: string, variant: string | null): string {
  const v = (variant ?? "").toLowerCase();
  if (/manga/.test(v)) return "Manga Rare";
  if (/(^|, )spr?($|,)|special/.test(v)) return "Special Rare";
  if (/super alternate|super parallel/.test(v)) return "Pirate Crew Super Parallel";
  if (/alternate art|parallel/.test(v)) return "Parallel Rare (Alternate Art)";
  return RARITY_BY_CODE[code.trim().toUpperCase()] ?? "Other";
}

/** A catalog entry ready to store, or null when it has no usable id or name. */
export function normalizeOnePieceCard(raw: OptcgRawCard): OnePieceCatalogRow | null {
  const id = (raw.card_image_id || raw.card_set_id || "").trim();
  if (!id || !raw.card_name?.trim()) return null;
  const { name, variant } = parseOnePieceName(raw.card_name);
  const code = (raw.card_set_id || id).trim();
  return {
    id,
    card_code: code,
    name,
    variant,
    set_id: raw.set_id,
    set_name: raw.set_name,
    rarity_code: raw.rarity,
    rarity: mapOnePieceRarity(raw.rarity, variant),
    color: raw.card_color ?? null,
    card_type: raw.card_type ?? null,
    image_url: raw.card_image ?? null,
    search: [name, variant ?? "", code, raw.set_id, raw.set_name].join(" ").toLowerCase().replace(/\s+/g, " ").trim(),
  };
}

/** How a card reads in a listing title: "Roronoa Zoro OP01-001 (Parallel)". */
export function onePieceListingTitle(card: { name: string; number: string; variant?: string | null }): string {
  return `${card.name} ${card.number}${card.variant ? ` (${card.variant})` : ""}`;
}

/** Only pictures from the OPTCG API's own image folder may be copied into the shop's storage. */
export const OPTCG_IMAGE_PREFIX = "https://optcgapi.com/media/static/Card_Images/";
export const isOptcgImage = (url: string) => url.startsWith(OPTCG_IMAGE_PREFIX) && !url.includes("..") && /\.(jpe?g|png|webp)$/i.test(url);
