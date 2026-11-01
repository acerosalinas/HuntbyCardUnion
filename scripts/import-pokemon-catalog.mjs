// Fills pokemon_catalog_cards from the TCGdex API (https://api.tcgdex.net, free, no API key).
// Run supabase/migration_pokemon_catalog.sql first. Safe to re-run: it updates existing cards and adds new ones.
//
// Usage:
//   node scripts/import-pokemon-catalog.mjs                     (every English set)
//   node scripts/import-pokemon-catalog.mjs --lang=ja           (every Japanese set)
//   node scripts/import-pokemon-catalog.mjs --dry-run           (fetch and count, write nothing)
//   node scripts/import-pokemon-catalog.mjs --set=swsh3         (just one set)
//
// Japanese cards: TCGdex only has their Japanese names, so each Pokemon card gets its English name (looked up
// through its National Dex number, English names from PokeAPI). Cards with no English name (trainers, energy)
// are skipped, and no Japanese text is stored: a set shows as its code (e.g. SV1S).
// Japanese ids are stored as "ja:<id>" so they can never clash with an English card.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// Local runs read .env.local; a scheduler (GitHub Actions) provides the same values as environment variables.
let envText = "";
try {
  envText = readFileSync("./.env.local", "utf8");
} catch {
  // no .env.local here
}
const env = {};
for (const rawLine of envText.split("\n")) {
  const line = rawLine.replace(/\r$/, "");
  const eq = line.indexOf("=");
  if (eq === -1 || line.startsWith("#")) continue;
  env[line.slice(0, eq)] = line.slice(eq + 1).trim();
}
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) env[k] ??= process.env[k];

const LANG = process.argv.find((a) => a.startsWith("--lang="))?.slice(7) ?? "en";
if (!["en", "ja"].includes(LANG)) throw new Error(`Unsupported --lang=${LANG} (use en or ja).`);
const API = `https://api.tcgdex.net/v2/${LANG}`;
const dryRun = process.argv.includes("--dry-run");
const onlySet = process.argv.find((a) => a.startsWith("--set="))?.slice(6) ?? null;
const idFor = (id) => (LANG === "en" ? id : `${LANG}:${id}`);

const supabase = dryRun ? null : createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function getJson(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) throw new Error(`${res.status} ${url}`);
    } catch (err) {
      if (i === tries) throw err;
    }
    await new Promise((r) => setTimeout(r, 800 * i));
  }
  throw new Error(`Gave up on ${url}`);
}

/** Runs fn over items a few at a time, in order. */
async function inGroups(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

const searchText = (parts) => parts.filter(Boolean).join(" ").toLowerCase();
const toDate = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

// ---- Japanese only: National Dex number -> English name, and card id -> dex number
const englishByCard = new Map();
if (LANG === "ja") {
  const species = await getJson("https://pokeapi.co/api/v2/pokemon-species?limit=2000");
  const pretty = (slug) => slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const dexNames = species.results.map((s) => ({ dex: Number(s.url.split("/").filter(Boolean).pop()), name: pretty(s.name) }));
  console.log(`Matching ${dexNames.length} Pokemon to Japanese cards...`);
  let done = 0;
  await inGroups(dexNames, 8, async ({ dex, name }) => {
    const cards = await getJson(`${API}/cards?dexId=eq:${dex}`).catch(() => []);
    for (const c of cards) if (!englishByCard.has(c.id)) englishByCard.set(c.id, name);
    done++;
    if (done % 50 === 0) process.stdout.write(`\r${done}/${dexNames.length} Pokemon`);
  });
  console.log(`\n${englishByCard.size} Japanese cards got an English name.`);
}

const sets = await getJson(`${API}/sets`);
const wanted = onlySet ? sets.filter((s) => s.id === onlySet) : sets;
if (wanted.length === 0) throw new Error(onlySet ? `No set "${onlySet}".` : "The API returned no sets.");
console.log(`${wanted.length} ${LANG} set(s) to read${dryRun ? " (dry run)" : ""}...`);

let total = 0;
let written = 0;
const skippedSets = [];

// A few sets at a time, to be polite to the free API.
for (let i = 0; i < wanted.length; i += 4) {
  const batch = wanted.slice(i, i + 4);
  const details = await Promise.all(
    batch.map((s) =>
      getJson(`${API}/sets/${encodeURIComponent(s.id)}`).catch((err) => {
        skippedSets.push(`${s.id} (${err.message})`);
        return null;
      }),
    ),
  );
  for (const set of details) {
    if (!set) continue;
    const rows = (set.cards ?? [])
      .filter((c) => c.id && c.name && c.localId != null && (LANG !== "ja" || englishByCard.has(c.id)))
      .map((c) => {
        const english = LANG === "ja" ? englishByCard.get(c.id) : null;
        return {
          id: idFor(c.id),
          lang: LANG,
          name: english ?? c.name,
          set_id: set.id,
          // The Japanese set name is Japanese text; the set code reads the same everywhere.
          set_name: LANG === "ja" ? set.id : set.name,
          local_id: String(c.localId),
          image_url: c.image ?? null,
          set_release: toDate(set.releaseDate),
          search: searchText([english ?? c.name, LANG === "ja" ? set.id : set.name, String(c.localId)]),
        };
      });
    total += rows.length;
    if (!dryRun && rows.length > 0) {
      for (let j = 0; j < rows.length; j += 500) {
        const { error } = await supabase.from("pokemon_catalog_cards").upsert(rows.slice(j, j + 500), { onConflict: "id" });
        if (error) {
          console.error(`Failed writing ${set.id}: ${error.message}`);
          if (/pokemon_catalog_cards|schema cache|does not exist/i.test(error.message)) {
            console.error("Run supabase/migration_pokemon_catalog.sql in the Supabase SQL editor first.");
          }
          process.exit(1);
        }
        written += Math.min(500, rows.length - j);
      }
    }
  }
  process.stdout.write(`\r${Math.min(i + 4, wanted.length)}/${wanted.length} sets, ${total} cards`);
}
console.log(`\nDone. ${total} cards read${dryRun ? "" : `, ${written} written`}.`);
if (skippedSets.length > 0) console.log(`Skipped ${skippedSets.length} set(s) - re-run to retry them:\n  ${skippedSets.join("\n  ")}`);
