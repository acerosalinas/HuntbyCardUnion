// Shared between client components (pre-upload check, fast + not subject to
// Server Action error redaction) and lib/imageValidation.ts (the
// authoritative server-side check, which also verifies magic bytes). No
// "server-only" here specifically so client components can import it.
export const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const ACCEPTED_IMAGE_ACCEPT_ATTR = "image/png,image/jpeg,image/webp,image/gif";

/**
 * Fast, client-side format check before ever calling an upload Server
 * Action - a directly-awaited Server Action's thrown error message is
 * redacted in production (the client only ever sees a generic "unexpected
 * error"), so a bad file needs to be caught here to actually be readable.
 * The most common way to hit this: iPhones save photos as HEIC by default,
 * which isn't an accepted format.
 */
export function checkImageTypeClientSide(file: File): string | null {
  if (ACCEPTED_IMAGE_TYPES.has(file.type)) return null;
  const isLikelyHeic = /\.(heic|heif)$/i.test(file.name) || file.type === "image/heic" || file.type === "image/heif";
  if (isLikelyHeic) {
    return `${file.name} is a HEIC photo, which isn't supported - in your phone's camera settings, switch to "Most Compatible" (JPEG) format, or use "Select Photo" and choose the JPEG/PNG option when saving/sharing it first.`;
  }
  return `${file.name}: unsupported file type${file.type ? ` (${file.type})` : ""} - use JPG, PNG, WEBP, or GIF.`;
}
