// Gives Japanese catalog cards that TCGdex has no picture for a picture from Limitless (https://limitlesstcg.com),
// which lists every Japanese set with a small image per card. Only cards with an empty image_url are touched.
// Safe to re-run. Run scripts/import-pokemon-catalog.mjs --lang=ja first.
//
// Usage:
//   node scripts/fill-japanese-pictures.mjs             (fill every Japanese set with gaps)
//   node scripts/fill-japanese-pictures.mjs --dry-run   (count what would be filled, write nothing)
//   node scripts/fill-japanese-pictures.mjs --set=M2a   (just one set)

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

async function getText(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
      if (res.ok) return await res.text();
      if (res.status === 404) return null;
    } catch {
      // retry below
    }
    await new Promise((r) => setTimeout(r, 1000 * i));
  }
  throw new Error(`Gave up on ${url}`);
}

// TCGdex and Limitless spell a few set codes differently.
const LIMITLESS_CODE = { "SV-P": "SVP", "M-P": "MP" };

const stripZeros = (n) => String(n).replace(/^0+(?=.)/, "").toLowerCase();

// Every Japanese card still without a picture, grouped by set.
const missing = new Map();
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from("pokemon_catalog_cards")
    .select("id, name, lang, set_id, set_name, local_id, set_release, search")
    .eq("lang", "ja")
    .is("image_url", null)
    .order("id")
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  for (const r of data) {
    if (onlySet && r.set_id !== onlySet) continue;
    if (!missing.has(r.set_id)) missing.set(r.set_id, []);
    missing.get(r.set_id).push(r);
  }
  if (data.length < 1000) break;
}
const total = [...missing.values()].reduce((n, rows) => n + rows.length, 0);
console.log(`${total} Japanese cards without a picture, in ${missing.size} sets${dryRun ? " (dry run)" : ""}.`);

let filled = 0;
const noPage = [];
for (const [setId, rows] of missing) {
  const html = await getText(`https://limitlesstcg.com/cards/jp/${encodeURIComponent(LIMITLESS_CODE[setId] ?? setId)}`);
  if (!html) {
    noPage.push(setId);
    continue;
  }
  const pictures = new Map();
  for (const m of html.matchAll(/href="\/cards\/jp\/[^/"]+\/([^"]+)"[^>]*><img[^>]*src="(https:\/\/limitlesstcg\.nyc3\.cdn\.digitaloceanspaces\.com\/[^"]+_SM\.png)"/g)) {
    pictures.set(stripZeros(decodeURIComponent(m[1])), m[2]);
  }
  const updates = rows.flatMap((r) => {
    const url = pictures.get(stripZeros(r.local_id));
    return url ? [{ ...r, image_url: url }] : [];
  });
  if (!dryRun && updates.length > 0) {
    const { error } = await supabase.from("pokemon_catalog_cards").upsert(updates, { onConflict: "id" });
    if (error) throw new Error(`${setId}: ${error.message}`);
  }
  filled += updates.length;
  process.stdout.write(`\r${setId}: ${updates.length}/${rows.length}   running total ${filled}/${total}      `);
  await new Promise((r) => setTimeout(r, 400));
}
console.log(`\nDone. ${filled} of ${total} cards ${dryRun ? "could be " : ""}filled; ${total - filled} still have no picture.`);
if (noPage.length > 0) console.log(`No Limitless page for: ${noPage.join(", ")}`);
