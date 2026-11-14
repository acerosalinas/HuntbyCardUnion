/**
 * Japanese One Piece Card Game catalog helpers (pure - no imports of our own server code, so the import script can use them).
 * Source: the official Japanese card list (onepiece-cardgame.com/cardlist), one page per set. Run by the import script only - never at request time.
 */
import { JP_IMAGE_PREFIX as JP_IMAGES, mapOnePieceRarity, OnePieceCatalogRow } from "./onepieceCatalog";

export const JP_SITE = "https://www.onepiece-cardgame.com";
/** Pictures of the Japanese cards live in this folder of the official site. */
export const JP_IMAGE_PREFIX = JP_IMAGES;
/** Japanese catalog rows are told apart from English ones by this id prefix ("jp:OP01-001"). */
export const JP_ID_PREFIX = "jp:";
export const isJapaneseCatalogId = (id: string) => id.startsWith(JP_ID_PREFIX);

export interface JpSeries {
  /** The site's series number, e.g. "550101". */
  value: string;
  /** "ブースターパック ROMANCE DAWN【OP-01】" */
  title: string;
}

export interface JpCard {
  /** "OP01-001", "OP01-001_p1" for a parallel printing, "OP01-001_r1" for a reprint in another set. */
  id: string;
  code: string;
  rarityCode: string;
  cardType: string;
  name: string;
  /** The Japanese colour word(s), e.g. "赤" or "赤/緑". */
  color: string;
  imageUrl: string | null;
  /** The set line shown on the card ("ROMANCE DAWN【OP-01】"). */
  setLine: string;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (m) => ENTITIES[m] ?? m);
/** Page text with markup removed ("A &lt;br&gt; B" and "A<br>B" both become "A B"). */
const plain = (s: string) => decode(decode(s).replace(/<[^>]*>/g, " ")).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/** Every set the site lists (boosters, starter decks, promos...), newest first as the site shows them. */
export function parseJpSeries(html: string): JpSeries[] {
  const select = /<select[^>]*name="series"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";
  const out: JpSeries[] = [];
  for (const m of select.matchAll(/<option[^>]*value="(\d+)"[^>]*>([\s\S]*?)<\/option>/g)) {
    const title = plain(m[2]);
    if (title) out.push({ value: m[1], title });
  }
  return out;
}

/** The cards on one set's page. */
export function parseJpCards(html: string): JpCard[] {
  const out: JpCard[] = [];
  const seen = new Set<string>();
  for (const chunk of html.split('<dl class="modalCol" id="').slice(1)) {
    const id = /^([^"]+)"/.exec(chunk)?.[1];
    if (!id || seen.has(id)) continue;
    const info = /<div class="infoCol">([\s\S]*?)<\/div>/.exec(chunk)?.[1] ?? "";
    const spans = [...info.matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1].trim());
    const name = plain(/<div class="cardName">([\s\S]*?)<\/div>/.exec(chunk)?.[1] ?? "");
    if (!name) continue;
    const img = /data-src="[^"]*\/images\/cardlist\/card\/([^"?]+)/.exec(chunk)?.[1];
    seen.add(id);
    out.push({
      id,
      code: id.replace(/_[pr]\d+$/i, ""),
      rarityCode: spans[1] ?? "",
      cardType: spans[2] ?? "",
      name,
      color: plain(/<div class="color"><h3>[^<]*<\/h3>([\s\S]*?)<\/div>/.exec(chunk)?.[1] ?? ""),
      imageUrl: img ? JP_IMAGE_PREFIX + img : null,
      setLine: plain(/<h3>入手情報<\/h3>([\s\S]*?)<div/.exec(chunk)?.[1] ?? ""),
    });
  }
  return out;
}

const COLORS: Record<string, string> = { 赤: "Red", 緑: "Green", 青: "Blue", 紫: "Purple", 黒: "Black", 黄: "Yellow" };
/** "赤/緑" -> "Red/Green"; anything unknown is left as is. */
export function jpColorToEnglish(color: string): string | null {
  const parts = color.split(/[\/／]/).map((p) => p.trim()).filter(Boolean);
  return parts.length === 0 ? null : parts.map((p) => COLORS[p] ?? p).join("/");
}

/** What the English catalog already knows about a card code (so a Japanese card can be found by its English name too). */
export interface EnglishInfo {
  name: string;
  setName: string;
}

/** "OP01-001" -> "OP-01", "ST05-003" -> "ST-05", "P-012" -> "P" ; null when it isn't a known shape. */
export function setIdOfCode(code: string): string | null {
  const m = /^([A-Z]+)-?(\d{2})-\d+$/.exec(code);
  if (m) return `${m[1]}-${m[2]}`;
  const p = /^([A-Z]+)-\d+$/.exec(code);
  return p ? p[1] : null;
}

/** A Japanese card as a catalog row. The English name leads when we know it; the Japanese name stays searchable. */
export function normalizeJpCard(card: JpCard, series: JpSeries, english?: EnglishInfo | null): OnePieceCatalogRow {
  const variant = /_p\d+$/i.test(card.id) ? "Parallel" : /_r\d+$/i.test(card.id) ? "Reprint" : null;
  const setId = setIdOfCode(card.code) ?? "JP";
  const jpSet = series.title;
  const baseSet = english?.setName ?? jpSet;
  return {
    id: JP_ID_PREFIX + card.id,
    card_code: card.code,
    name: english?.name ?? card.name,
    variant,
    set_id: setId,
    set_name: `${baseSet} (Japanese)`,
    rarity_code: card.rarityCode,
    rarity: mapOnePieceRarity(card.rarityCode, variant),
    color: jpColorToEnglish(card.color),
    card_type: card.cardType || null,
    image_url: card.imageUrl,
    search: [english?.name ?? "", card.name, variant ?? "", card.code, setId, english?.setName ?? "", jpSet, "japanese jp 日本語"].join(" ").toLowerCase().replace(/\s+/g, " ").trim(),
  };
}
