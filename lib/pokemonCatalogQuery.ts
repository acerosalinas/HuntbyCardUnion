import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { CatalogCard, catalogSearchAttempts, parseCatalogQuery, rankCatalogMatches } from "@/lib/pokemonCatalog";

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Pokemon cards matching what's typed (name, set or number), best matches first. Never throws.
 * Callers decide who may search - this only reads the catalog.
 */
export async function queryCatalog(query: string): Promise<{ cards: CatalogCard[]; error?: string }> {
  const text = typeof query === "string" ? query.slice(0, 80) : "";
  const { tokens: typed } = parseCatalogQuery(text);
  if (typed.length === 0 || typed.join("").length < 2) return { cards: [] };

  const db = createAdminClient();
  // Try the search as typed first, then looser versions (see catalogSearchAttempts) until something is found.
  for (const { tokens, lang } of catalogSearchAttempts(text)) {
    let q = db
      .from("pokemon_catalog_cards")
      .select("id, name, set_name, local_id, image_url, lang")
      .eq("lang", lang)
      .order("set_release", { ascending: false, nullsFirst: false })
      .limit(60);
    for (const t of tokens) q = q.ilike("search", `%${escapeLike(t)}%`);
    const { data, error } = await q;
    if (error) {
      const missing = /pokemon_catalog_cards|schema cache|does not exist/i.test(error.message);
      return { cards: [], error: missing ? "The card catalog isn't set up yet." : error.message };
    }
    if (!data || data.length === 0) continue;
    // Rank against what was typed, so an exact printed number comes first even when a looser search found the cards.
    const ranked = rankCatalogMatches(data, typed.join(" ")).slice(0, 8);
    return {
      cards: ranked.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        setName: r.set_name as string,
        number: r.local_id as string,
        image: (r.image_url as string | null) ?? null,
        lang: (r.lang as string | null) ?? "en",
      })),
    };
  }
  return { cards: [] };
}
