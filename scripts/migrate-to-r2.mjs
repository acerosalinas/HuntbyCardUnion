// One-off maintenance script - copies every image out of the Supabase
// Storage "card-images" bucket into the new Cloudflare R2 bucket (see
// lib/r2.ts), then rewrites every stored URL in the database to point at
// the new R2 public domain instead of the old Supabase Storage URL.
//
// Only new uploads go through R2 so far (app/admin/actions.ts,
// app/account/actions.ts already switched) - this backfills everything
// uploaded before that switch. Does NOT delete anything from Supabase
// Storage; that's a separate, deliberate step to run only after confirming
// the site looks correct on R2 for a while.
//
// Usage:
//   node scripts/migrate-to-r2.mjs --dry-run        (report only, no writes)
//   node scripts/migrate-to-r2.mjs --limit=5         (copy only the first 5 files)
//   node scripts/migrate-to-r2.mjs                   (copy everything + update DB)

import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
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

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
});

const BUCKET = "card-images";
const FOLDERS = ["", "avatars", "payment-qr", "wanted"];
const OLD_PREFIX = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;
const NEW_PREFIX = `${env.R2_PUBLIC_URL}/`;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : Infinity;

async function listAllFiles(folder) {
  const files = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET).list(folder, { limit: 1000, offset });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const entry of data) {
      if (entry.id === null) continue; // subfolder marker, not a file
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      files.push(path);
    }
    if (data.length < 1000) break;
    offset += 1000;
  }
  return files;
}

async function copyFile(path) {
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !blob) throw error ?? new Error("empty download");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const contentType = blob.type || "application/octet-stream";

  await r2.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: path,
      Body: bytes,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

function rewriteUrl(url) {
  if (typeof url !== "string" || !url.startsWith(OLD_PREFIX)) return url;
  return NEW_PREFIX + url.slice(OLD_PREFIX.length);
}

async function updateDatabase() {
  let cardsUpdated = 0;
  let sellersUpdated = 0;
  let wantedUpdated = 0;

  const { data: cards, error: cardsError } = await supabase.from("cards").select("id, images");
  if (cardsError) throw cardsError;
  for (const card of cards ?? []) {
    const rewritten = (card.images ?? []).map(rewriteUrl);
    const changed = rewritten.some((url, i) => url !== card.images[i]);
    if (!changed) continue;
    cardsUpdated++;
    if (!dryRun) {
      const { error } = await supabase.from("cards").update({ images: rewritten }).eq("id", card.id);
      if (error) throw error;
    }
  }

  const { data: sellers, error: sellersError } = await supabase.from("seller_profiles").select("admin_id, avatar_url, payment_qr_url");
  if (sellersError) throw sellersError;
  for (const seller of sellers ?? []) {
    const avatar_url = rewriteUrl(seller.avatar_url);
    const payment_qr_url = rewriteUrl(seller.payment_qr_url);
    if (avatar_url === seller.avatar_url && payment_qr_url === seller.payment_qr_url) continue;
    sellersUpdated++;
    if (!dryRun) {
      const { error } = await supabase.from("seller_profiles").update({ avatar_url, payment_qr_url }).eq("admin_id", seller.admin_id);
      if (error) throw error;
    }
  }

  const { data: wanted, error: wantedError } = await supabase.from("wanted_cards").select("id, photo_url");
  if (wantedError) {
    if (wantedError.code === "PGRST205") {
      console.log("NOTE: 'wanted_cards' table doesn't exist in this database - skipping (unrelated pre-existing issue, see supabase/migration_wanted_cards.sql).");
    } else {
      throw wantedError;
    }
  }
  for (const row of wanted ?? []) {
    const photo_url = rewriteUrl(row.photo_url);
    if (photo_url === row.photo_url) continue;
    wantedUpdated++;
    if (!dryRun) {
      const { error } = await supabase.from("wanted_cards").update({ photo_url }).eq("id", row.id);
      if (error) throw error;
    }
  }

  return { cardsUpdated, sellersUpdated, wantedUpdated };
}

async function main() {
  console.log(`Mode: ${dryRun ? "DRY RUN (no writes)" : "LIVE"}${limit !== Infinity ? `, limit ${limit}` : ""}\n`);
  console.log(`Rewriting: ${OLD_PREFIX}...  ->  ${NEW_PREFIX}...\n`);

  let allFiles = [];
  for (const folder of FOLDERS) {
    allFiles = allFiles.concat(await listAllFiles(folder));
  }
  console.log(`${allFiles.length} files found in Supabase Storage.\n`);

  let copied = 0;
  let failed = 0;
  for (const path of allFiles) {
    if (copied >= limit) break;
    try {
      if (!dryRun) await copyFile(path);
      console.log(`${dryRun ? "WOULD COPY" : "COPIED"}  ${path}`);
      copied++;
    } catch (err) {
      console.error(`FAIL  ${path}:`, err.message ?? err);
      failed++;
    }
  }

  console.log("\n--- Copy summary ---");
  console.log(`Copied: ${copied}`);
  console.log(`Failed: ${failed}`);

  if (limit !== Infinity) {
    console.log("\n(--limit set - skipping database update so partial copies don't get referenced yet.)");
    return;
  }

  console.log("\nUpdating database URLs...");
  const { cardsUpdated, sellersUpdated, wantedUpdated } = await updateDatabase();
  console.log("\n--- Database summary ---");
  console.log(`cards rows updated: ${cardsUpdated}`);
  console.log(`seller_profiles rows updated: ${sellersUpdated}`);
  console.log(`wanted_cards rows updated: ${wantedUpdated}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
