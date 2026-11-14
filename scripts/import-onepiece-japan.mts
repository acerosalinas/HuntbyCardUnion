// Adds the JAPANESE One Piece Card Game sets and cards to onepiece_catalog_cards, read from the official Japanese card list
// (https://www.onepiece-cardgame.com/cardlist/ - one page per set, about 60 requests, ~1.2 s apart).
// Run scripts/import-onepiece-catalog.mts first (English cards): Japanese cards are matched to their English name by card code.
// No SQL migration needed. Safe to re-run: updates existing cards and adds new ones (run it again when a new Japanese set comes out).
//
// Usage:
//   npx tsx scripts/import-onepiece-japan.mts              (import everything)
//   npx tsx scripts/import-onepiece-japan.mts --dry-run    (fetch and count, write nothing)

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import type { OnePieceCatalogRow } from "../lib/onepieceCatalog";
import { EnglishInfo, JP_SITE, normalizeJpCard, parseJpCards, parseJpSeries } from "../lib/onepieceJapan";

const dryRun = process.argv.includes("--dry-run");
const env: Record<string, string | undefined> = { ...process.env };
try {
  for (const line of readFileSync("./.env.local", "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && !line.startsWith("#")) env[line.slice(0, i)] ??= line.slice(i + 1).replace(/^"|"$/g, "");
  }
} catch {
  // no .env.local here
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.");
const db = createClient(url, key, { auth: { persistSession: false } });

const get = async (path: string) => {
  const res = await fetch(`${JP_SITE}${path}`, { headers: { "User-Agent": "CardUnionCatalogImport/1.0", "Accept-Language": "ja" } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// What the English catalog already knows, by card code (the plain printing wins) and by set id.
const english = new Map<string, EnglishInfo>();
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from("onepiece_catalog_cards").select("id, card_code, name, set_name, variant").not("id", "like", "jp:%").range(from, from + 999);
  if (error) throw new Error(error.message);
  for (const r of data ?? []) if (!english.has(r.card_code) || !r.variant) english.set(r.card_code, { name: r.name, setName: r.set_name });
  if (!data || data.length < 1000) break;
}
console.log(`English catalog: ${english.size} card codes to match against.`);

const series = parseJpSeries(await get("/cardlist/"));
console.log(`${series.length} Japanese sets found.`);
const rows = new Map<string, OnePieceCatalogRow>();
for (const s of series) {
  await wait(1200);
  const cards = parseJpCards(await get(`/cardlist/?series=${s.value}`));
  let kept = 0;
  for (const c of cards) {
    const row = normalizeJpCard(c, s, english.get(c.code));
    // A card can be listed in several sets (reprints): keep the first.
    if (!rows.has(row.id)) {
      rows.set(row.id, row);
      kept++;
    }
  }
  console.log(`${s.title}: ${cards.length} cards, ${kept} new`);
}
const list = [...rows.values()];
const matched = list.filter((r) => english.has(r.card_code)).length;
console.log(`${list.length} Japanese printings; ${matched} have an English name, ${list.length - matched} are Japanese-only so far.`);
console.log("Sample:", list.slice(0, 3).map((r) => `${r.name} ${r.card_code} [${r.rarity}] ${r.set_name}`).join(" | "));
if (dryRun) {
  console.log("Dry run: nothing written.");
  process.exit(0);
}

let written = 0;
for (let i = 0; i < list.length; i += 500) {
  const { error } = await db.from("onepiece_catalog_cards").upsert(list.slice(i, i + 500), { onConflict: "id" });
  if (error) throw new Error(error.message);
  written += Math.min(500, list.length - i);
}
console.log(`Done: ${written} Japanese printings saved.`);
