// One-off maintenance script - re-compresses every image already sitting in
// the "card-images" Supabase Storage bucket through the same shrink pipeline
// lib/imageNormalize.ts applies to new uploads, since the app's Cached
// Egress quota (5GB/month) was blown out to 17GB+ this cycle and neither the
// new-upload fix nor the 1-year cache-control fix touches bytes already in
// storage. Overwrites each file IN PLACE at its existing path (upsert),
// so every stored URL (cards.images, seller_profiles.avatar_url/
// payment_qr_url, wanted_cards.photo_url) keeps working unchanged - nothing
// in the database needs to be touched.
//
// Usage:
//   node scripts/recompress-images.mjs --dry-run        (report only, no writes)
//   node scripts/recompress-images.mjs --limit=5         (process only the first 5 that need it)
//   node scripts/recompress-images.mjs                   (process everything)
//
// Not run automatically, not imported by the app - sharp is a devDependency
// used only here.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import sharp from "sharp";

const envText = readFileSync("./.env.local", "utf8");
const env = {};
for (const line of envText.split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const BUCKET = "card-images";
const FOLDERS = ["", "avatars", "payment-qr", "wanted"];
const MAX_DIMENSION = 1400; // matches lib/imageNormalize.ts
const TARGET_BYTES = 1.5 * 1024 * 1024; // matches lib/imageNormalize.ts's OUTPUT_TARGET_BYTES
const SKIP_UNDER_BYTES = 600 * 1024; // matches lib/imageNormalize.ts's PASSTHROUGH_MAX_BYTES - already small enough, don't bother
const JPEG_QUALITY_START = 82;
const JPEG_QUALITY_MIN = 40;

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
      // Storage .list() returns subfolders as entries with id === null - skip those, they're not files.
      if (entry.id === null) continue;
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      files.push({ path, size: entry.metadata?.size ?? 0 });
    }
    if (data.length < 1000) break;
    offset += 1000;
  }
  return files;
}

async function recompress(buffer) {
  const meta = await sharp(buffer).metadata();
  const isPng = meta.format === "png";

  if (isPng) {
    // Keeps PNG (not forced to JPEG) - a payment QR code losing lossless
    // edges to JPEG compression artifacts risks it becoming unscannable,
    // and most PNGs here (QR codes, avatars) are small to begin with.
    const out = await sharp(buffer)
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
    return { buffer: out, contentType: "image/png" };
  }

  let quality = JPEG_QUALITY_START;
  let out = await sharp(buffer)
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
  while (out.length > TARGET_BYTES && quality > JPEG_QUALITY_MIN) {
    quality -= 10;
    out = await sharp(buffer)
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
  }
  return { buffer: out, contentType: "image/jpeg" };
}

async function main() {
  console.log(`Mode: ${dryRun ? "DRY RUN (no writes)" : "LIVE"}${limit !== Infinity ? `, limit ${limit}` : ""}\n`);

  let allFiles = [];
  for (const folder of FOLDERS) {
    const files = await listAllFiles(folder);
    allFiles = allFiles.concat(files);
  }

  const candidates = allFiles.filter((f) => f.size > SKIP_UNDER_BYTES);
  console.log(`${allFiles.length} total files, ${candidates.length} over ${(SKIP_UNDER_BYTES / 1024).toFixed(0)}KB worth checking.\n`);

  let processed = 0;
  let totalBefore = 0;
  let totalAfter = 0;
  let skippedNoImprovement = 0;
  let failed = 0;

  for (const file of candidates) {
    if (processed >= limit) break;

    try {
      const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(file.path);
      if (downloadError || !blob) throw downloadError ?? new Error("empty download");
      const buffer = Buffer.from(await blob.arrayBuffer());

      const { buffer: outBuffer, contentType } = await recompress(buffer);

      if (outBuffer.length >= buffer.length) {
        console.log(`SKIP  ${file.path} - recompression didn't shrink it (${buffer.length} -> ${outBuffer.length})`);
        skippedNoImprovement++;
        continue;
      }

      const pct = (100 * (1 - outBuffer.length / buffer.length)).toFixed(0);
      console.log(
        `${dryRun ? "WOULD SHRINK" : "SHRUNK"}  ${file.path}  ${(buffer.length / 1024).toFixed(0)}KB -> ${(outBuffer.length / 1024).toFixed(0)}KB  (-${pct}%)`,
      );

      totalBefore += buffer.length;
      totalAfter += outBuffer.length;
      processed++;

      if (!dryRun) {
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(file.path, outBuffer, {
          contentType,
          cacheControl: "31536000",
          upsert: true,
        });
        if (uploadError) throw uploadError;
      }
    } catch (err) {
      console.error(`FAIL  ${file.path}:`, err.message ?? err);
      failed++;
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Processed: ${processed}`);
  console.log(`Skipped (already efficient): ${skippedNoImprovement}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total before: ${(totalBefore / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Total after:  ${(totalAfter / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Saved:        ${((totalBefore - totalAfter) / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
