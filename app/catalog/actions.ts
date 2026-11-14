"use server";

import { getCurrentAdmin } from "@/lib/adminAuth";
import { getCurrentBuyer } from "@/lib/buyerAuth";
import type { CatalogCard } from "@/lib/pokemonCatalog";
import { queryCatalog } from "@/lib/pokemonCatalogQuery";
import { queryOnePieceCatalog } from "@/lib/onepieceCatalogQuery";
import { allowRequest } from "@/lib/rateLimit";

/** Card search for listing forms and wishlist requests. Any signed-in admin or buyer; signed-out visitors get nothing. */
export async function searchPokemonCards(query: string): Promise<{ cards: CatalogCard[]; error?: string }> {
  const [admin, buyer] = await Promise.all([getCurrentAdmin(), getCurrentBuyer()]);
  if (!admin && !buyer) return { cards: [] };
  // Generous: typing in the search box sends a request per pause. This only stops a script hammering the catalog.
  if (!(await allowRequest("catalog", (admin?.id ?? buyer?.id) as string, 120, 60))) return { cards: [] };
  return queryCatalog(query);
}

/** One Piece card search for the listing form, used when the seller picks the One Piece franchise. Same rules as the Pokemon search. */
export async function searchOnePieceCards(query: string): Promise<{ cards: CatalogCard[]; error?: string }> {
  const [admin, buyer] = await Promise.all([getCurrentAdmin(), getCurrentBuyer()]);
  if (!admin && !buyer) return { cards: [] };
  if (!(await allowRequest("catalog-onepiece", (admin?.id ?? buyer?.id) as string, 120, 60))) return { cards: [] };
  return queryOnePieceCatalog(query);
}
