// Shared between client components (pre-upload check, fast + not subject to
// Server Action error redaction) and lib/imageValidation.ts (the
// authoritative server-side check, which also verifies magic bytes). No
// "server-only" here specifically so client components can import it.
export const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const ACCEPTED_IMAGE_ACCEPT_ATTR = "image/png,image/jpeg,image/webp,image/gif";
// Shared with lib/imageValidation.ts's server-side check (the authoritative
// one) so both sides agree on the same cap - see that file for why. 20MB
// comfortably covers a modern phone's full-resolution JPEG (an 8MB cap
// rejected plenty of real iPhone photos with a redacted "unexpected error",
// since this used to only live server-side).
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Fast, client-side format + size check before ever calling an upload
 * Server Action - a directly-awaited Server Action's thrown error message
 * is redacted in production (the client only ever sees a generic
 * "unexpected error"), so a bad file needs to be caught here to actually be
 * readable. The most common ways to hit this: iPhones save photos as HEIC
 * by default (not an accepted format), or a full-resolution phone photo
 * exceeding the size cap.
 */
export function checkImageTypeClientSide(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    const isLikelyHeic = /\.(heic|heif)$/i.test(file.name) || file.type === "image/heic" || file.type === "image/heif";
    if (isLikelyHeic) {
      return `${file.name} is a HEIC photo, which isn't supported - in your phone's camera settings, switch to "Most Compatible" (JPEG) format, or use "Select Photo" and choose the JPEG/PNG option when saving/sharing it first.`;
    }
    return `${file.name}: unsupported file type${file.type ? ` (${file.type})` : ""} - use JPG, PNG, WEBP, or GIF.`;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `${file.name}: file is ${(file.size / (1024 * 1024)).toFixed(1)}MB, which exceeds the ${MAX_IMAGE_BYTES / (1024 * 1024)}MB limit - try a smaller photo, or lower your camera's photo quality/resolution setting.`;
  }
  return null;
}
