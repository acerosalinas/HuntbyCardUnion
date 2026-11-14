import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { CATALOG_MAX_RESULTS, CatalogCard, searchTokens } from "@/lib/pokemonCatalog";

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const looksLikeCode = (t: string) => /\d/.test(t);

interface Row {
  id: string;
  card_code: string;
  name: string;
  variant: string | null;
  set_name: string;
  rarity: string;
  image_url: string | null;
}

/** Best matches first: the card whose code was typed, then names starting with the first word, then plain printings before art variants, then shorter names. */
function rank(rows: Row[], tokens: string[]): Row[] {
  const first = tokens.find((t) => !looksLikeCode(t)) ?? tokens[0] ?? "";
  const codes = tokens.filter(looksLikeCode);
  const score = (r: Row) => {
    const n = r.name.toLowerCase();
    const exactCode = codes.some((c) => r.card_code.toLowerCase() === c || r.card_code.toLowerCase().replace("-", "") === c.replace("-", "")) ? -5000 : 0;
    return exactCode + (n === first ? 0 : n.startsWith(first) ? 1 : 2) * 1000 + (r.variant ? 200 : 0) + Math.min(n.length, 99);
  };
  return rows.map((r, i) => ({ r, i, s: score(r) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.r);
}

/**
 * One Piece cards matching what's typed (name, code or set), best matches first. Never throws.
 * Callers decide who may search - this only reads the catalog.
 */
export async function queryOnePieceCatalog(query: string): Promise<{ cards: CatalogCard[]; error?: string }> {
  const text = typeof query === "string" ? query.slice(0, 80) : "";
  const tokens = searchTokens(text);
  if (tokens.length === 0 || tokens.join("").length < 2) return { cards: [] };

  const db = createAdminClient();
  // As typed first; then, if that finds nothing, just the words (a wrong or missing code still lists that character's cards).
  const words = tokens.filter((t) => !looksLikeCode(t));
  const attempts = words.length > 0 && words.length < tokens.length ? [tokens, words] : [tokens];
  for (const attempt of attempts) {
    let q = db.from("onepiece_catalog_cards").select("id, card_code, name, variant, set_name, rarity, image_url").order("card_code", { ascending: true }).limit(CATALOG_MAX_RESULTS * 3);
    for (const t of attempt) q = q.ilike("search", `%${escapeLike(t)}%`);
    const { data, error } = await q;
    if (error) {
      const missing = /onepiece_catalog_cards|schema cache|does not exist/i.test(error.message);
      return { cards: [], error: missing ? "The One Piece card catalog isn't set up yet." : error.message };
    }
    if (!data || data.length === 0) continue;
    return {
      cards: rank(data as Row[], attempt)
        .slice(0, CATALOG_MAX_RESULTS)
        .map((r) => ({ id: r.id, name: r.name, setName: r.set_name, number: r.card_code, image: r.image_url, lang: "en", year: null, variant: r.variant, rarity: r.rarity })),
    };
  }
  return { cards: [] };
}
