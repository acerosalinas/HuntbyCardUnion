import "server-only";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

/**
 * Cloudflare R2 - replaces Supabase Storage for the public "card-images"
 * bucket (card photos, avatars, payment QR codes, wanted-card photos).
 * R2 is S3-API-compatible, hence the AWS SDK. Moved here after Supabase's
 * Cached Egress quota (5GB/month) got blown out to 17-20GB/month by real
 * marketplace traffic - R2 charges zero egress fees, which removes that
 * risk category entirely rather than just raising the ceiling.
 *
 * dispute-evidence (private, signed-URL-only, low-traffic) deliberately
 * stays on Supabase - it was never the cost driver, and moving it would
 * mean rebuilding the signed-URL access-control flow for no real benefit.
 */
function r2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY are not configured.");
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

/** Uploads bytes to the card-images R2 bucket at `path` and returns its public URL. Mirrors the old Supabase upload+getPublicUrl pair used throughout app/admin/actions.ts and app/account/actions.ts. */
export async function uploadToR2(path: string, bytes: Uint8Array, contentType: string): Promise<string> {
  const bucket = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!bucket || !publicUrl) {
    throw new Error("R2_BUCKET_NAME/R2_PUBLIC_URL are not configured.");
  }

  await r2Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: path,
      Body: bytes,
      ContentType: contentType,
      // 1 year - every path here is a fresh random UUID, never overwritten,
      // so the file at this URL never changes (same reasoning as the old
      // Supabase Storage cacheControl option this replaces).
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  return `${publicUrl}/${path}`;
}
