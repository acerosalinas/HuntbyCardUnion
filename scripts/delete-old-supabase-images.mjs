// One-off cleanup - permanently deletes every file from the Supabase
// Storage "card-images" bucket, now that scripts/migrate-to-r2.mjs has
// copied everything to Cloudflare R2 and repointed every DB row (cards,
// seller_profiles, wanted_cards) at the new R2 URLs. Run only after
// confirming (via that script's dry-run / DB check) that nothing still
// references the old Supabase URLs - this is irreversible.
//
// Usage:
//   node scripts/delete-old-supabase-images.mjs --dry-run   (list only)
//   node scripts/delete-old-supabase-images.mjs             (actually delete)

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const envText = readFileSync("./.env.local", "utf8");
const env = {};
for (const rawLine of envText.split("\n")) {
  const line = rawLine.replace(/\r$/, "");
  const eq = line.indexOf("=");
  if (eq === -1 || line.startsWith("#")) continue;
  env[line.slice(0, eq)] = line.slice(eq + 1).trim();
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const BUCKET = "card-images";
const FOLDERS = ["", "avatars", "payment-qr", "wanted"];
const dryRun = process.argv.includes("--dry-run");

async function listAllFiles(folder) {
  const files = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET).list(folder, { limit: 1000, offset });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const entry of data) {
      if (entry.id === null) continue;
      files.push(folder ? `${folder}/${entry.name}` : entry.name);
    }
    if (data.length < 1000) break;
    offset += 1000;
  }
  return files;
}

async function main() {
  let allFiles = [];
  for (const folder of FOLDERS) {
    allFiles = allFiles.concat(await listAllFiles(folder));
  }
  console.log(`${allFiles.length} files found.\n`);

  if (dryRun) {
    allFiles.forEach((f) => console.log("WOULD DELETE", f));
    return;
  }

  let deleted = 0;
  const BATCH = 100; // Supabase Storage remove() batch limit is generous, but keep chunks small and reliable
  for (let i = 0; i < allFiles.length; i += BATCH) {
    const batch = allFiles.slice(i, i + BATCH);
    const { data, error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) throw error;
    deleted += data?.length ?? batch.length;
    console.log(`Deleted ${deleted}/${allFiles.length}`);
  }

  console.log(`\nDone. Deleted ${deleted} files.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
