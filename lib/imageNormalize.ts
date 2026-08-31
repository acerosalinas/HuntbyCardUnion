"use client";

const MAX_DIMENSION = 2000; // longest side, px - plenty for a card/product photo, keeps output small
const JPEG_QUALITY_START = 0.85;
const JPEG_QUALITY_MIN = 0.4;
// Headroom under ACCEPTED cap (lib/imageAccept.ts's MAX_IMAGE_BYTES) so the
// iterative quality-reduction loop below reliably lands under that check
// instead of right on the edge of it.
const OUTPUT_TARGET_BYTES = 3 * 1024 * 1024;
// Already-small accepted-format files skip re-encoding entirely - no reason
// to degrade a photo that was never going to be the problem.
const PASSTHROUGH_MAX_BYTES = 1.5 * 1024 * 1024;

function isHeicFile(file: File): boolean {
  return /\.(heic|heif)$/i.test(file.name) || file.type === "image/heic" || file.type === "image/heif";
}

function isAlreadyAcceptedFormat(file: File): boolean {
  return file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp" || file.type === "image/gif";
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Normalizes any browser-selected/captured photo into a JPEG File
 * comfortably under Vercel's 4.5MB serverless function request body limit -
 * a full-resolution phone camera photo is routinely 5-15MB, well past that
 * platform ceiling regardless of format, which is what actually causes the
 * opaque "unexpected error" on upload (the app's own MAX_IMAGE_BYTES cap in
 * lib/imageAccept.ts used to allow up to 20MB, far beyond what the request
 * could ever actually deliver). HEIC/HEIF - which no browser but Safari can
 * decode - gets converted via heic2any first; everything else (already-small
 * accepted formats aside) gets downscaled/recompressed via canvas.
 *
 * Falls back to returning the original file untouched if normalization
 * fails for any reason (e.g. an unsupported/corrupt file, or a very old
 * browser missing createImageBitmap) - checkImageTypeClientSide/
 * validateImageFile downstream are still the source of truth and will
 * reject it with their own readable message rather than this silently
 * uploading something broken.
 */
export async function normalizeImageFile(file: File): Promise<File> {
  if (!isHeicFile(file) && isAlreadyAcceptedFormat(file) && file.size <= PASSTHROUGH_MAX_BYTES) {
    return file;
  }

  try {
    let workingBlob: Blob = file;

    if (isHeicFile(file)) {
      const heic2any = (await import("heic2any")).default;
      const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: JPEG_QUALITY_START });
      workingBlob = Array.isArray(converted) ? converted[0] : converted;
    }

    const bitmap = await createImageBitmap(workingBlob);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // White background first - JPEG has no alpha channel, so a transparent
    // PNG would otherwise composite onto black in most browsers.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    let quality = JPEG_QUALITY_START;
    let outputBlob = await canvasToBlob(canvas, quality);
    while (outputBlob && outputBlob.size > OUTPUT_TARGET_BYTES && quality > JPEG_QUALITY_MIN) {
      quality -= 0.15;
      outputBlob = await canvasToBlob(canvas, quality);
    }
    if (!outputBlob) return file;

    const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([outputBlob], newName, { type: "image/jpeg" });
  } catch (err) {
    console.warn(`Could not normalize "${file.name}" - uploading the original file instead:`, err);
    return file;
  }
}

/** Sequential (not parallel) so a 30-photo bulk upload doesn't decode 30 bitmaps into memory at once. */
export async function normalizeImageFiles(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const file of files) {
    out.push(await normalizeImageFile(file));
  }
  return out;
}
