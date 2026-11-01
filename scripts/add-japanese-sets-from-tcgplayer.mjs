// Adds the Japanese sets TCGdex doesn't have, from TCGplayer's Japanese card list (mirrored by https://tcgcsv.com, free,
// no key): the newest releases, starter and battle decks, special sets, and the big SV-P / M-P promo sets (which the
// other Japanese scripts can't match because TCGplayer names them without a set code). It also adds each set's
// English name to the search text of cards already in the catalog, so "151 jp" finds Pokemon Card 151.
//
// Order: scripts/import-pokemon-catalog.mjs --lang=ja, then scripts/add-japanese-cards-from-tcgplayer.mjs, then this.
// Safe to re-run: existing cards are never overwritten (only their search text is widened), new ones are added.
//
// Usage:
//   node scripts/add-japanese-sets-from-tcgplayer.mjs --dry-run     (count and show a sample, write nothing)
//   node scripts/add-japanese-sets-from-tcgplayer.mjs               (do it)
//   node scripts/add-japanese-sets-from-tcgplayer.mjs --no-enrich   (skip widening the search text of existing cards)

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

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

const dryRun = process.argv.includes("--dry-run");
const enrich = !process.argv.includes("--no-enrich");
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const TCGDEX = "https://api.tcgdex.net/v2/ja";
const TCGCSV = "https://tcgcsv.com/tcgplayer/85"; // category 85 = Pokemon Japan

async function getJson(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "HuntByCardUnion-catalog-import/1.0" } });
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) throw new Error(`${res.status} ${url}`);
    } catch (err) {
      if (i === tries) throw err;
    }
    await new Promise((r) => setTimeout(r, 800 * i));
  }
  throw new Error(`Gave up on ${url}`);
}

const letters = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const stripZeros = (n) => String(n).replace(/^0+(?=.)/, "").toLowerCase();
const searchText = (parts) => parts.filter(Boolean).join(" ").toLowerCase();
const day = (iso) => (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null);

// "Paras - 001/172 (Mirror Holofoil)" -> "Paras"
const FINISH = /\s*\((?:[^)]*(?:holofoil|foil|mirror|reverse|ball|promo)[^)]*)\)\s*$/i;
// Also drops a trailing printed number: " - 001/172", " - 005/M-P", "-743/742" or "(143/175)".
const cleanName = (n) =>
  n
    .replace(/\s*-\s*\d+\/[A-Za-z0-9-]+(?:\s*\([^)]*\))?\s*$/, "") // " - 211/SV-P (Championship Series 2025)"
    .replace(FINISH, "")
    .replace(/\s*\(\d+\/[A-Za-z0-9-]+\)\s*$/, "")
    .replace(/\s*-\s*[A-Za-z0-9-]*\d+(?:\/[A-Za-z0-9-]+)?\s*$/, "")
    .trim();

/** "SV2a: Pokemon Card 151" -> { code: "SV2a", rest: "Pokemon Card 151" }; "SV-P Promotional Cards" -> { code: "SV-P", rest: "Promotional Cards" }. */
function splitName(name) {
  let m = /^([A-Za-z0-9+.-]+):\s*(.+)$/.exec(name);
  if (m) return { code: m[1], rest: m[2], coded: true };
  m = /^([A-Za-z0-9-]+)\s+(Promotional Cards)$/i.exec(name);
  if (m) return { code: m[1], rest: name, coded: false };
  return { code: null, rest: name, coded: false };
}

const groups = (await getJson(`${TCGCSV}/groups`)).results;
const tcgdexSets = await getJson(`${TCGDEX}/sets`);
const tcgdexCodes = new Set(tcgdexSets.map((s) => letters(s.id)));

// ---- what the catalog has now
const have = new Map();
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from("pokemon_catalog_cards")
    .select("id, lang, name, set_id, set_name, local_id, image_url, set_release, search")
    .eq("lang", "ja")
    .order("id")
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  for (const r of data) have.set(r.id, r);
  if (data.length < 1000) break;
}
console.log(`${have.size} Japanese cards in the catalog${dryRun ? " (dry run)" : ""}; ${groups.length} TCGplayer Japanese sets.`);

const cache = new Map();
async function cardsOf(group) {
  if (cache.has(group.groupId)) return cache.get(group.groupId);
  const products = (await getJson(`${TCGCSV}/${group.groupId}/products`).catch(() => ({ results: [] }))).results;
  const numbered = new Map(); // normalised number -> { raw, name, image, plain }
  const unnumbered = new Map(); // lower-case name -> { id, name, image, plain }
  for (const p of products) {
    const num = p.extendedData?.find((e) => e.name === "Number")?.value;
    const hasRarity = p.extendedData?.some((e) => e.name === "Rarity");
    if (!num && !hasRarity) continue; // a box, pack or other sealed product
    const entry = { name: cleanName(p.name), image: p.imageUrl ?? null, plain: !FINISH.test(p.name), productId: p.productId };
    if (!entry.name) continue;
    if (num && /\d/.test(num)) {
      const raw = String(num).split("/")[0].trim();
      const k = stripZeros(raw);
      const cur = numbered.get(k);
      if (!cur || (entry.plain && !cur.plain)) numbered.set(k, { ...entry, raw });
    } else {
      const k = entry.name.toLowerCase();
      const cur = unnumbered.get(k);
      if (!cur || (entry.plain && !cur.plain)) unnumbered.set(k, entry);
    }
  }
  const out = { numbered, unnumbered };
  cache.set(group.groupId, out);
  return out;
}

// ---- Phase 1: sets TCGdex doesn't have (or promo sets the other script can't match)
const parsed = groups.map((g) => ({ g, ...splitName(g.name) }));
const handledElsewhere = (p) => p.coded && p.code && tcgdexCodes.has(letters(p.code));
const todo = parsed.filter((p) => !handledElsewhere(p));
const codeCount = new Map();
for (const p of todo) if (p.code) codeCount.set(letters(p.code), (codeCount.get(letters(p.code)) ?? 0) + 1);

const upserts = [];
let added = 0;
let setsAdded = 0;
const sample = [];
const odd = new Set();
async function flush(force = false) {
  if (dryRun || (!force && upserts.length < 500)) return;
  while (upserts.length > 0) {
    const batch = upserts.splice(0, 500);
    const { error } = await supabase.from("pokemon_catalog_cards").upsert(batch, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
}

for (let i = 0; i < todo.length; i += 6) {
  await Promise.all(todo.slice(i, i + 6).map((p) => cardsOf(p.g)));
  for (const p of todo.slice(i, i + 6)) {
    const { numbered, unnumbered } = await cardsOf(p.g);
    if (numbered.size + unnumbered.size === 0) continue;
    const unique = p.code && codeCount.get(letters(p.code)) === 1;
    // A code shared by several decks ("SV:") can't name a set on its own, so those use the TCGplayer id and show their name.
    const setId = unique ? p.code : `tcgp${p.g.groupId}`;
    const setName = unique ? p.code : p.rest.length > 60 ? `${p.rest.slice(0, 57)}...` : p.rest;
    const release = day(p.g.publishedOn);
    const mk = (id, entry, localId) => ({
      id,
      lang: "ja",
      name: entry.name,
      set_id: setId,
      set_name: setName,
      local_id: localId,
      image_url: entry.image,
      set_release: release,
      search: searchText([entry.name, setName, p.rest !== setName ? p.rest : null, localId === "-" ? null : localId]),
    });
    let n = 0;
    for (const [, entry] of numbered) {
      const id = `ja:${setId}-${entry.raw}`;
      if (have.has(id)) continue;
      const row = mk(id, entry, entry.raw);
      upserts.push(row);
      if (sample.length < 12 && n === 0) sample.push(`${row.id} | ${row.name} | ${row.set_name}`);
      if (odd.size < 25 && /\/|\s-\s|\d{3,}/.test(row.name)) odd.add(`${row.id} | ${row.name}`);
      n++;
    }
    for (const [, entry] of unnumbered) {
      const id = `ja:${setId}-p${entry.productId}`;
      if (have.has(id)) continue;
      upserts.push(mk(id, entry, "-"));
      n++;
    }
    if (n > 0) {
      added += n;
      setsAdded++;
    }
    await flush();
  }
  process.stdout.write(`\r${Math.min(i + 6, todo.length)}/${todo.length} sets   +${added} cards in ${setsAdded} sets      `);
}
await flush(true);
console.log(`\nPhase 1: ${added} cards ${dryRun ? "would be " : ""}added from ${setsAdded} sets that TCGdex doesn't list.`);
if (sample.length > 0) console.log(`Examples:\n  ${sample.join("\n  ")}`);
if (odd.size > 0) console.log(`Names that still look odd (check these):\n  ${[...odd].join("\n  ")}`);

// ---- Phase 2: widen the search text of existing cards with their set's English name ("151 jp" -> Pokemon Card 151)
if (enrich) {
  const byCode = new Map();
  for (const p of parsed) if (p.coded && p.code) byCode.set(letters(p.code), [...(byCode.get(letters(p.code)) ?? []), p]);
  let widened = 0;
  const changes = [];
  for (const row of have.values()) {
    const matches = byCode.get(letters(row.set_id)) ?? [];
    if (matches.length !== 1) continue; // no English name, or several sets share the code: don't guess
    const english = matches[0].rest.toLowerCase();
    if ((row.search ?? "").includes(english)) continue;
    changes.push({ ...row, search: `${row.search} ${english}`.trim() });
    widened++;
  }
  if (!dryRun) {
    for (let j = 0; j < changes.length; j += 500) {
      const { error } = await supabase.from("pokemon_catalog_cards").upsert(changes.slice(j, j + 500), { onConflict: "id" });
      if (error) throw new Error(error.message);
    }
  }
  console.log(`Phase 2: ${widened} existing cards ${dryRun ? "would get" : "got"} their set's English name in the search text.`);
}
console.log("Done.");
