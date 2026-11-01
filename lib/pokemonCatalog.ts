/** A Pokemon card from the shared catalog, as the tracker's card search shows it. */
export interface CatalogCard {
  id: string;
  name: string;
  setName: string;
  /** The number printed on the card within its set. */
  number: string;
  /** Base image address (no quality/extension), or null. */
  image: string | null;
  /** "en" or "ja". */
  lang: string;
}

/** "charizard  151" -> ["charizard", "151"]. Each word has to appear somewhere in a card's name, set or number. */
export function searchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[%_\\,()]/g, ""))
    .filter((t) => t.length > 0)
    .slice(0, 5);
}

const JAPANESE_WORDS = new Set(["jp", "jpn", "japan", "japanese"]);

/**
 * "charizard jp 006" -> { tokens: ["charizard", "006"], lang: "ja" }. Typing JP (or japanese) anywhere asks for
 * Japanese cards only; without it only English cards are searched.
 */
export function parseCatalogQuery(query: string): { tokens: string[]; lang: "en" | "ja" } {
  const all = searchTokens(query);
  const tokens = all.filter((t) => !JAPANESE_WORDS.has(t));
  return { tokens, lang: tokens.length < all.length ? "ja" : "en" };
}

/** What goes into the card-name box when a match is picked, e.g. "Charizard (Base Set 4)". */
export function catalogCardLabel(card: Pick<CatalogCard, "name" | "setName" | "number"> & { lang?: string }): string {
  return `${card.name} (${card.setName} ${card.number})${card.lang === "ja" ? " [JP]" : ""}`;
}

/** Where catalog pictures live; a listing photo starting with this is a stand-in, not an upload. */
export const CATALOG_IMAGE_HOST = "https://assets.tcgdex.net/";
const LIMITLESS_IMAGE_HOST = "https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/";

const TCGPLAYER_IMAGE_HOST = "https://tcgplayer-cdn.tcgplayer.com/";

export function isCatalogImage(url: string): boolean {
  return url.startsWith(CATALOG_IMAGE_HOST) || url.startsWith(LIMITLESS_IMAGE_HOST) || url.startsWith(TCGPLAYER_IMAGE_HOST);
}

/**
 * Picture for a catalog card. TCGdex pictures are stored as a base address (add /low.webp or /high.webp);
 * pictures filled in from Limitless are a full address of the small version (_SM.png), with _LG.png for large;
 * TCGplayer ones are a full address of the 200px version (_200w.jpg), with _in_1000x1000.jpg for large.
 */
export function catalogImageUrl(image: string | null, size: "low" | "high" = "low"): string | null {
  if (!image) return null;
  if (image.startsWith(TCGPLAYER_IMAGE_HOST)) return size === "high" ? image.replace(/_200w\.jpg$/, "_in_1000x1000.jpg") : image;
  if (image.startsWith(LIMITLESS_IMAGE_HOST)) return size === "high" ? image.replace(/_SM\.png$/, "_LG.png") : image;
  return `${image}/${size}.webp`;
}

/**
 * Best matches first: a name that starts with the first typed word, then shorter names (a plain "Pikachu"
 * before "Pikachu VMAX Rainbow"), then newer sets. `rows` arrive newest-set-first, which is kept as the tie-break.
 */
export function rankCatalogMatches<T extends { name: string; lang?: string }>(rows: T[], query: string): T[] {
  const first = searchTokens(query)[0] ?? "";
  const score = (r: T) => {
    const n = r.name.toLowerCase();
    // English cards win a tie with an equally good Japanese one.
    return (n === first ? 0 : n.startsWith(first) ? 1 : 2) * 1000 + Math.min(n.length, 999) + (r.lang === "ja" ? 0.5 : 0);
  };
  return rows.map((r, i) => ({ r, i, s: score(r) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.r);
}
