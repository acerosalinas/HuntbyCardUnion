import "server-only";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Identifies an image format from its magic bytes, independent of the
 * browser-reported (and therefore spoofable) `file.type`. Returns null if
 * the bytes don't match any known image signature.
 */
export function sniffImageType(bytes: Uint8Array): string | null {
  const startsWith = (sig: number[]) => sig.every((byte, i) => bytes[i] === byte);

  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (
    startsWith([0x52, 0x49, 0x46, 0x46]) && // "RIFF"
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50 // "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Throws with a friendly message unless `file` passes size, declared-type, and magic-byte checks. Returns the sniffed content type. */
export async function validateImageFile(file: File): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error(`${file.name}: unsupported file type`);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`${file.name}: file exceeds 8MB`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImageType(bytes);
  if (!sniffed || !ALLOWED_IMAGE_TYPES.has(sniffed)) {
    throw new Error(`${file.name}: file content doesn't match a supported image format`);
  }

  return { bytes, contentType: sniffed };
}
