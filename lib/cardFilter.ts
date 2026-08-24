import { CardItem } from "@/types/marketplace";
import { CategoryFilter } from "@/components/MarketplaceFilterProvider";

function isGraded(conditionGrade: string): boolean {
  return !/^raw/i.test(conditionGrade.trim());
}

/** Shared predicate behind the search bar / category pills / rarity dropdown - used by both the marketplace grid and a seller's own listings grid. */
export function matchesCardFilter(
  card: CardItem,
  { query, category, rarity }: { query: string; category: CategoryFilter; rarity: string },
): boolean {
  if (category === "RAW" && isGraded(card.conditionGrade)) return false;
  if (category === "GRADED" && !isGraded(card.conditionGrade)) return false;
  if (category === "FLASH_SALE" && !card.isFlashSale) return false;
  if (rarity !== "ALL" && card.rarity !== rarity) return false;

  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    card.title.toLowerCase().includes(q) ||
    card.setName.toLowerCase().includes(q) ||
    card.sellerHandle.toLowerCase().includes(q) ||
    card.conditionGrade.toLowerCase().includes(q) ||
    card.rarity.toLowerCase().includes(q)
  );
}
