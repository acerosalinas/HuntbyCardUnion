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
  /** Release year of the card's set, when known - helps tell a vintage printing from a modern one at a glance. */
  year: number | null;
}

/** The most cards one search shows. Common names (Pikachu) have hundreds of printings, so this is a window, not the full list. */
export const CATALOG_MAX_RESULTS = 60;

/**
 * "charizard  151" -> ["charizard", "151"]. Each word has to appear somewhere in a card's name, set or number.
 * A number copied the way it is printed on the card works too: "088/071" and "#088" both become "088".
 */
export function searchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^#/, "").replace(/^(\d+)\/\d+$/, "$1"))
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

const isNumber = (t: string) => /^\d+$/.test(t);
const stripZeros = (t: string) => (isNumber(t) ? t.replace(/^0+(?=\d)/, "") : t);

/**
 * The searches to try, in order, until one finds cards - so a slightly-off search shows the closest cards instead of an
 * empty list:
 *  1. exactly what was typed;
 *  2. numbers without their leading zeros ("088" also finds a card stored as "88");
 *  3. English-only searches also look at the Japanese cards;
 *  4. dropping the number, so a wrong or missing number still lists that Pokemon's cards.
 */
export function catalogSearchAttempts(query: string): { tokens: string[]; lang: "en" | "ja" }[] {
  const { tokens, lang } = parseCatalogQuery(query);
  if (tokens.length === 0) return [];
  const langs: ("en" | "ja")[] = lang === "en" ? ["en", "ja"] : ["ja"];
  const variants: string[][] = [tokens];
  const stripped = tokens.map(stripZeros);
  if (stripped.join(" ") !== tokens.join(" ")) variants.push(stripped);
  const words = tokens.filter((t) => !isNumber(t));
  const relaxed = words.length > 0 && words.length < tokens.length ? [words] : [];

  const out: { tokens: string[]; lang: "en" | "ja" }[] = [];
  const seen = new Set<string>();
  for (const group of [variants, relaxed]) {
    for (const l of langs) {
      for (const t of group) {
        const key = `${l}:${t.join(" ")}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ tokens: t, lang: l });
        }
      }
    }
  }
  return out;
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
export function rankCatalogMatches<T extends { name: string; lang?: string; local_id?: string }>(rows: T[], query: string): T[] {
  const tokens = searchTokens(query);
  const first = tokens[0] ?? "";
  const numbers = tokens.filter(isNumber).map(stripZeros);
  const score = (r: T) => {
    const n = r.name.toLowerCase();
    // The card whose printed number is the one typed comes first ("grimer 088" -> Grimer #088 before Grimer #188).
    const exactNumber = numbers.length > 0 && r.local_id !== undefined && numbers.includes(stripZeros(String(r.local_id))) ? -5000 : 0;
    // English cards win a tie with an equally good Japanese one.
    return exactNumber + (n === first ? 0 : n.startsWith(first) ? 1 : 2) * 1000 + Math.min(n.length, 999) + (r.lang === "ja" ? 0.5 : 0);
  };
  return rows.map((r, i) => ({ r, i, s: score(r) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.r);
}
