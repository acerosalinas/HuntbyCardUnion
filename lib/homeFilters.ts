import { getFranchiseBySlug } from "@/lib/franchises";
import { matchesCardFilter } from "@/lib/cardFilter";
import { CardItem } from "@/types/marketplace";

/** A quick filter on the home page's shelf. Only chips that match at least one card are offered. */
export interface HomeChip {
  id: string;
  label: string;
  count: number;
  test: (card: CardItem) => boolean;
}

/** Cards at or under this price get the "budget" chip. */
export const BUDGET_CHIP_PRICE = 100;

const isRawCondition = (grade: string) => /^raw/i.test(grade.trim());

/** "All" first, then the games, then price / condition / kind chips - each with how many cards it holds, and none that would show an empty shelf. */
export function buildChips(cards: CardItem[]): HomeChip[] {
  const defs: { id: string; label: string; test: (c: CardItem) => boolean }[] = [];
  const slugs = [...new Set(cards.map((c) => c.franchise).filter((s): s is string => Boolean(s)))];
  for (const slug of slugs) defs.push({ id: `franchise:${slug}`, label: getFranchiseBySlug(slug)?.label ?? slug, test: (c) => c.franchise === slug });
  defs.push(
    { id: "budget", label: `₱${BUDGET_CHIP_PRICE} & under`, test: (c) => c.price <= BUDGET_CHIP_PRICE },
    { id: "graded", label: "Graded", test: (c) => c.productType === "CARD" && !isRawCondition(c.conditionGrade) },
    { id: "sealed", label: "Sealed", test: (c) => c.productType === "SEALED" },
    { id: "mystery", label: "Mystery packs", test: (c) => c.productType === "MYSTERY" },
    { id: "flash", label: "Flash sale", test: (c) => c.isFlashSale },
  );
  return [
    { id: "all", label: "All", count: cards.length, test: () => true },
    ...defs.map((d) => ({ ...d, count: cards.filter(d.test).length })).filter((d) => d.count > 0),
  ];
}

/** The cards a typed search should suggest: titles that start with it first, then other matches, newest first within each, at most `limit`. Empty for a blank search. */
export function suggestCards(cards: CardItem[], query: string, limit = 6): CardItem[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits = cards.filter((c) => matchesCardFilter(c, { query: q, category: "ALL", rarity: "ALL" }));
  const starts = (c: CardItem) => (c.title.toLowerCase().startsWith(q) ? 0 : 1);
  return hits.sort((a, b) => starts(a) - starts(b) || b.createdAt - a.createdAt).slice(0, limit);
}
