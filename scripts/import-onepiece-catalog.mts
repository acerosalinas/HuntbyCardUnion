// Fills onepiece_catalog_cards from the OPTCG API (https://optcgapi.com, free, no API key).
// Run supabase/migration_onepiece_catalog.sql first. Safe to re-run: it updates existing cards and adds new ones (run it again when a new set comes out).
//
// Usage:
//   npx tsx scripts/import-onepiece-catalog.mts              (import everything)
//   npx tsx scripts/import-onepiece-catalog.mts --dry-run    (fetch and count, write nothing)
//
// The API is run by one person for free: this makes just two requests (all set cards, all starter-deck cards) and prices are not stored.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { normalizeOnePieceCard, OnePieceCatalogRow, OptcgRawCard } from "../lib/onepieceCatalog";

const API = "https://optcgapi.com/api";
const ENDPOINTS = ["allSetCards", "allSTCards"] as const;
const dryRun = process.argv.includes("--dry-run");

// Local runs read .env.local; a scheduler provides the same values as environment variables.
const env: Record<string, string | undefined> = { ...process.env };
try {
  for (const line of readFileSync("./.env.local", "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && !line.startsWith("#")) env[line.slice(0, i)] ??= line.slice(i + 1).replace(/^"|"$/g, "");
  }
} catch {
  // no .env.local here
}

async function fetchAll(endpoint: string): Promise<OptcgRawCard[]> {
  const res = await fetch(`${API}/${endpoint}/`, { headers: { "User-Agent": "CardUnionCatalogImport/1.0" } });
  if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status}`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error(`${endpoint}: unexpected response`);
  return data as OptcgRawCard[];
}

const rows = new Map<string, OnePieceCatalogRow>();
for (const endpoint of ENDPOINTS) {
  const cards = await fetchAll(endpoint);
  let kept = 0;
  for (const raw of cards) {
    const row = normalizeOnePieceCard(raw);
    // The same printing can appear in a set and a starter deck: keep the first.
    if (row && !rows.has(row.id)) {
      rows.set(row.id, row);
      kept++;
    }
  }
  console.log(`${endpoint}: ${cards.length} cards, ${kept} new printings`);
}
const list = [...rows.values()];
const byRarity = new Map<string, number>();
for (const r of list) byRarity.set(r.rarity, (byRarity.get(r.rarity) ?? 0) + 1);
console.log(`${list.length} printings in total. By shop rarity:`, Object.fromEntries([...byRarity.entries()].sort((a, b) => b[1] - a[1])));
console.log("Sample:", list.slice(0, 3).map((r) => `${r.name}${r.variant ? ` (${r.variant})` : ""} ${r.card_code} [${r.rarity}]`).join(" | "));
if (dryRun) {
  console.log("Dry run: nothing written.");
  process.exit(0);
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.");
const db = createClient(url, key, { auth: { persistSession: false } });

let written = 0;
for (let i = 0; i < list.length; i += 500) {
  const { error } = await db.from("onepiece_catalog_cards").upsert(list.slice(i, i + 500), { onConflict: "id" });
  if (error) {
    throw new Error(/onepiece_catalog_cards|schema cache|does not exist/i.test(error.message) ? "The table doesn't exist yet: run supabase/migration_onepiece_catalog.sql in the Supabase SQL editor first." : error.message);
  }
  written += Math.min(500, list.length - i);
}
console.log(`Done: ${written} printings saved.`);
