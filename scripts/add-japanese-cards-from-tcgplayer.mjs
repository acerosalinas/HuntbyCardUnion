// Fills the gaps in the Japanese catalog from TCGplayer's Japanese card list (mirrored by https://tcgcsv.com, free,
// no key). TCGplayer has an English name and a picture for nearly every Japanese card, including trainers and
// energy, which TCGdex only names in Japanese. This script:
//   - adds Japanese cards the catalog is missing (trainers, energy, cards TCGdex lacks), with English names
//   - gives cards without a picture one (cards that already have a picture are left alone)
// Run scripts/import-pokemon-catalog.mjs --lang=ja first. Safe to re-run.
//
// Usage:
//   node scripts/add-japanese-cards-from-tcgplayer.mjs             (do it)
//   node scripts/add-japanese-cards-from-tcgplayer.mjs --dry-run   (count only, write nothing)
//   node scripts/add-japanese-cards-from-tcgplayer.mjs --set=SV1S  (just one set)

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

const dryRun = process.argv.includes("--dry-run");
const onlySet = process.argv.find((a) => a.startsWith("--set="))?.slice(6) ?? null;
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
const day = (iso) => (iso ? Date.parse(String(iso).slice(0, 10)) : NaN);
const DAY = 86400000;
const searchText = (parts) => parts.filter(Boolean).join(" ").toLowerCase();

// "Paras - 001/172 (Mirror Holofoil)" -> "Paras"
const FINISH = /\s*\((?:[^)]*(?:holofoil|foil|mirror|reverse|ball|promo)[^)]*)\)\s*$/i;
const cleanName = (n) =>
  n
    .replace(/\s*-\s*\d+\/[A-Za-z0-9-]+(?:\s*\([^)]*\))?\s*$/, "")
    .replace(FINISH, "")
    .replace(/\s*\(\d+\/[A-Za-z0-9-]+\)\s*$/, "")
    .replace(/\s*-\s*[A-Za-z0-9-]*\d+(?:\/[A-Za-z0-9-]+)?\s*$/, "")
    .trim();

// ---- TCGplayer groups (one per set/product) and their cards
const groups = (await getJson(`${TCGCSV}/groups`)).results;
const byCode = new Map();
for (const g of groups) {
  const m = /^([A-Za-z0-9-]+):/.exec(g.name);
  if (!m) continue;
  const k = letters(m[1]);
  if (!byCode.has(k)) byCode.set(k, []);
  byCode.get(k).push(g);
}

const productCache = new Map();
async function cardsOf(group) {
  if (productCache.has(group.groupId)) return productCache.get(group.groupId);
  const products = (await getJson(`${TCGCSV}/${group.groupId}/products`).catch(() => ({ results: [] }))).results;
  const numbered = new Map(); // normalised number -> { raw, name, image, plain }
  const named = []; // cards with no printed number (old sets)
  for (const p of products) {
    const num = p.extendedData?.find((e) => e.name === "Number")?.value;
    const hasRarity = p.extendedData?.some((e) => e.name === "Rarity");
    if (!num && !hasRarity) continue; // a box, pack or other sealed product
    const entry = { name: cleanName(p.name), image: p.imageUrl ?? null, plain: !FINISH.test(p.name) };
    if (num && /\d/.test(num)) {
      const raw = String(num).split("/")[0].trim();
      const k = stripZeros(raw);
      const have = numbered.get(k);
      if (!have || (entry.plain && !have.plain)) numbered.set(k, { ...entry, raw });
    } else {
      named.push(entry);
    }
  }
  const out = { numbered, named };
  productCache.set(group.groupId, out);
  return out;
}

// ---- what the catalog has now
const have = new Map();
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from("pokemon_catalog_cards")
    .select("id, name, lang, set_id, set_name, local_id, image_url, set_release, search")
    .eq("lang", "ja")
    .order("id")
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  for (const r of data) have.set(r.id, r);
  if (data.length < 1000) break;
}
console.log(`${have.size} Japanese cards in the catalog${dryRun ? " (dry run)" : ""}.`);

const sets = (await getJson(`${TCGDEX}/sets`)).filter((s) => !onlySet || s.id === onlySet);
let added = 0;
let pictured = 0;
const unmatched = [];
const upserts = [];

async function flush(force = false) {
  if (dryRun || (!force && upserts.length < 500)) return;
  while (upserts.length > 0) {
    const batch = upserts.splice(0, 500);
    const { error } = await supabase.from("pokemon_catalog_cards").upsert(batch, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
}

for (let i = 0; i < sets.length; i += 4) {
  const details = await Promise.all(sets.slice(i, i + 4).map((s) => getJson(`${TCGDEX}/sets/${encodeURIComponent(s.id)}`).catch(() => null)));
  for (const set of details) {
    if (!set) continue;
    const cards = set.cards ?? [];
    const mine = cards.map((c) => have.get(`ja:${c.id}`)).filter(Boolean);

    // The TCGplayer set: the one with the same code, otherwise the one released the same day whose card names agree.
    let found = byCode.get(letters(set.id)) ?? [];
    if (found.length === 0 && mine.length > 0 && set.releaseDate) {
      const near = groups.filter((g) => Math.abs(day(g.publishedOn) - day(set.releaseDate)) <= DAY);
      const names = new Set(mine.map((r) => r.name.toLowerCase()));
      let best = null;
      for (const g of near) {
        const { numbered, named } = await cardsOf(g);
        const theirs = [...[...numbered.values()].map((e) => e.name), ...named.map((e) => e.name)];
        const score = theirs.filter((n) => names.has(n.toLowerCase())).length;
        if (score >= 5 && score >= mine.length * 0.3 && (!best || score > best.score)) best = { g, score };
      }
      if (best) found = [best.g];
    }
    if (found.length === 0) {
      unmatched.push(set.id);
      continue;
    }

    const numbered = new Map();
    const named = [];
    for (const g of found) {
      const c = await cardsOf(g);
      for (const [k, v] of c.numbered) if (!numbered.has(k) || (v.plain && !numbered.get(k).plain)) numbered.set(k, v);
      named.push(...c.named);
    }
    const nameCount = new Map();
    for (const e of named) nameCount.set(e.name.toLowerCase(), (nameCount.get(e.name.toLowerCase()) ?? 0) + 1);
    const myCount = new Map();
    for (const r of mine) myCount.set(r.name.toLowerCase(), (myCount.get(r.name.toLowerCase()) ?? 0) + 1);

    const seen = new Set();
    const row = (id, name, localId, image) => ({
      id,
      lang: "ja",
      name,
      set_id: set.id,
      set_name: set.id,
      local_id: localId,
      image_url: image,
      set_release: typeof set.releaseDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(set.releaseDate) ? set.releaseDate.slice(0, 10) : null,
      search: searchText([name, set.id, localId]),
    });

    for (const c of cards) {
      const id = `ja:${c.id}`;
      const k = stripZeros(c.localId);
      seen.add(k);
      const entry = numbered.get(k);
      const current = have.get(id);
      if (current) {
        if (current.image_url) continue;
        let image = entry?.image ?? null;
        if (!image && numbered.size === 0) {
          // Old sets have no printed numbers on TCGplayer: match by English name when it is unambiguous.
          const nm = current.name.toLowerCase();
          if (nameCount.get(nm) === 1 && myCount.get(nm) === 1) image = named.find((e) => e.name.toLowerCase() === nm)?.image ?? null;
        }
        if (image) {
          upserts.push({ ...current, image_url: image });
          pictured++;
        }
      } else if (entry) {
        upserts.push(row(id, entry.name, String(c.localId), c.image ?? entry.image));
        added++;
      }
    }
    // Cards TCGplayer lists that TCGdex doesn't have at all.
    for (const [k, entry] of numbered) {
      if (seen.has(k)) continue;
      const id = `ja:${set.id}-${entry.raw}`;
      if (have.has(id)) continue;
      upserts.push(row(id, entry.name, entry.raw, entry.image));
      added++;
    }
    await flush();
  }
  process.stdout.write(`\r${Math.min(i + 4, sets.length)}/${sets.length} sets   +${added} new cards   +${pictured} pictures      `);
}
await flush(true);
console.log(`\nDone. ${added} cards ${dryRun ? "would be " : ""}added, ${pictured} pictures ${dryRun ? "would be " : ""}filled.`);
if (unmatched.length > 0) console.log(`No TCGplayer match for ${unmatched.length} set(s): ${unmatched.join(", ")}`);
