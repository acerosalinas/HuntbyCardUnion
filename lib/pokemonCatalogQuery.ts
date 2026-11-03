import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { CATALOG_MAX_RESULTS, CatalogCard, catalogSearchAttempts, parseCatalogQuery, rankCatalogMatches } from "@/lib/pokemonCatalog";

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
  const READ = CATALOG_MAX_RESULTS * 3; // read more than is shown, so the ranking can pick the best
  const RESERVE_OLDEST = 12; // when a name has more printings than fit, the bottom of the list is kept for the oldest ones
  // Try the search as typed first, then looser versions (see catalogSearchAttempts) until something is found.
  for (const { tokens, lang } of catalogSearchAttempts(text)) {
    const read = (oldestFirst: boolean, limit: number) => {
      let q = db
        .from("pokemon_catalog_cards")
        .select("id, name, set_name, local_id, image_url, lang, set_release")
        .eq("lang", lang)
        .order("set_release", { ascending: oldestFirst, nullsFirst: false })
        .limit(limit);
      for (const t of tokens) q = q.ilike("search", `%${escapeLike(t)}%`);
      return q;
    };
    const { data, error } = await read(false, READ);
    if (error) {
      const missing = /pokemon_catalog_cards|schema cache|does not exist/i.test(error.message);
      return { cards: [], error: missing ? "The card catalog isn't set up yet." : error.message };
    }
    if (!data || data.length === 0) continue;
    // Rank against what was typed, so an exact printed number comes first even when a looser search found the cards.
    const ranked = rankCatalogMatches(data, typed.join(" "));
    let shown = ranked.slice(0, CATALOG_MAX_RESULTS);
    if (data.length >= READ) {
      // Truncated (a very common name): newest-first alone would never reach the vintage printings.
      const { data: oldest } = await read(true, CATALOG_MAX_RESULTS);
      const head = ranked.slice(0, CATALOG_MAX_RESULTS - RESERVE_OLDEST);
      const taken = new Set(head.map((r) => r.id));
      const extra = rankCatalogMatches((oldest ?? []).filter((r) => !taken.has(r.id)), typed.join(" ")).slice(0, RESERVE_OLDEST);
      shown = [...head, ...extra];
    }
    return {
      cards: shown.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        setName: r.set_name as string,
        number: r.local_id as string,
        image: (r.image_url as string | null) ?? null,
        lang: (r.lang as string | null) ?? "en",
        year: typeof r.set_release === "string" && /^\d{4}/.test(r.set_release) ? Number(r.set_release.slice(0, 4)) : null,
      })),
    };
  }
  return { cards: [] };
}
