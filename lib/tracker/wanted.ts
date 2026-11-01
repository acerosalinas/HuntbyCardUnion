/** A buyer's open "Can't find a card?" request that might be the card just entered in a live. */
export interface WantedRequest {
  id: string;
  buyerId: string | null;
  buyerHandle: string;
  cardName: string;
}

export type MatchStrength = "exact" | "same" | "maybe";

export interface WantedMatch {
  wantedId: string;
  buyerId: string | null;
  buyerHandle: string;
  cardName: string;
  strength: MatchStrength;
  /** The buyer was already told about this card (so the button shows "Notified"). */
  notified: boolean;
}

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9À-ɏ]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

/** "Charizard ex (151 006)" -> ["charizard", "ex"]; "Pikachu 031" -> ["pikachu"]. Trailing card numbers don't change which card it is. */
function baseWords(name: string): string[] {
  const w = words(name.split("(")[0]);
  while (w.length > 1 && /^\d+$/.test(w[w.length - 1])) w.pop();
  return w;
}

/**
 * How well a card entered in a live matches a buyer's request:
 *  exact - same text apart from punctuation/case (e.g. both picked from the catalog),
 *  same  - same card name, ignoring the set/number in brackets and a trailing number,
 *  maybe - one name's words all appear in the other ("Kirlia" vs "Kirlia fairy 2 copies"), worth a look.
 * null when they don't look related.
 */
export function matchStrength(saleName: string, wantedName: string): MatchStrength | null {
  const a = words(saleName).join(" ");
  const b = words(wantedName).join(" ");
  if (!a || !b) return null;
  if (a === b) return "exact";
  const x = baseWords(saleName);
  const y = baseWords(wantedName);
  if (x.length === 0 || y.length === 0) return null;
  if (x.join(" ") === y.join(" ")) return "same";
  const contains = (big: string[], small: string[]) => small.every((w) => big.includes(w)) && small.some((w) => w.length >= 3);
  return contains(y, x) || contains(x, y) ? "maybe" : null;
}

const RANK: Record<MatchStrength, number> = { exact: 0, same: 1, maybe: 2 };

/**
 * For each card, the requests it matches (strongest first, one per buyer, at most 3), flagging the ones the buyer was
 * already told about. Loose "maybe" matches are left out: they were mostly noise during a live.
 */
export function matchWanted(
  sales: { id: string; cardName: string }[],
  requests: WantedRequest[],
  notified: Set<string>,
): Record<string, WantedMatch[]> {
  const out: Record<string, WantedMatch[]> = {};
  for (const s of sales) {
    const found: WantedMatch[] = [];
    for (const r of requests) {
      const strength = matchStrength(s.cardName, r.cardName);
      if (!strength || strength === "maybe") continue;
      found.push({ wantedId: r.id, buyerId: r.buyerId, buyerHandle: r.buyerHandle, cardName: r.cardName, strength, notified: notified.has(`${r.id}:${s.id}`) });
    }
    const sorted = found.sort((p, q) => RANK[p.strength] - RANK[q.strength]);
    // A buyer who asked for the same card twice is still one buyer to tell.
    const onePerBuyer = sorted.filter((m, i) => !m.buyerId || sorted.findIndex((o) => o.buyerId === m.buyerId) === i);
    if (onePerBuyer.length > 0) out[s.id] = onePerBuyer.slice(0, 3);
  }
  return out;
}

export interface CardHistory {
  count: number;
  last: { amount: number; date: string } | null;
  average: number;
  min: number;
  max: number;
}

/** What a card's history looks like to the seller: its sales in lives, and its current marketplace listings. */
export interface CardInsight {
  sales: CardHistory | null;
  /** Cheapest available marketplace listing of the same card, and how many are listed. */
  listed: { count: number; lowest: number } | null;
}

/** Summary of what one catalog card sold for across the owner's lives (amounts newest-first). */
export function summarizeHistory(rows: { amount: number; date: string }[]): CardHistory | null {
  if (rows.length === 0) return null;
  const amounts = rows.map((r) => r.amount);
  const total = amounts.reduce((n, a) => n + a, 0);
  return {
    count: rows.length,
    last: rows[0],
    average: Math.round((total / rows.length) * 100) / 100,
    min: Math.min(...amounts),
    max: Math.max(...amounts),
  };
}
