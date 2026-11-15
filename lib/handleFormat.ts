/** The handle limits, in one place. The database enforces the same pattern (the handle checks on profiles and seller_profiles in supabase/schema.sql): change both together. */
export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 20;
export const HANDLE_REGEX = new RegExp(`^@[A-Za-z0-9_]{${HANDLE_MIN_LENGTH},${HANDLE_MAX_LENGTH}}$`);
/** The one-line rule shown next to the handle box. */
export const HANDLE_HINT = `${HANDLE_MIN_LENGTH}-${HANDLE_MAX_LENGTH} letters, numbers or underscores - no spaces. This is the name sellers see.`;

/** "  @@juan " -> "@juan"; empty -> "". Any number of leading @ and stray spaces around it are ignored. */
export function normalizeHandle(raw: string): string {
  const trimmed = raw.trim().replace(/^@+/, "").trim();
  return trimmed ? `@${trimmed}` : "";
}

/** Keep only what a handle can hold while it is typed: letters, numbers and underscores (no spaces, dots, dashes or accents). */
export function cleanHandleInput(raw: string): string {
  return raw.replace(/^@+/, "").replace(/[^A-Za-z0-9_]/g, "").slice(0, HANDLE_MAX_LENGTH);
}

/**
 * Why a handle isn't acceptable, in words a customer can act on - or null when it is fine.
 * The old single message ("must be 3-20 letters, numbers, or underscores" in one line) left people guessing which part they got wrong.
 */
export function handleProblem(raw: string): string | null {
  const body = normalizeHandle(raw).slice(1);
  if (!body) return "Choose a handle - the name sellers will see, like @juan_cards.";
  const bad = [...new Set(body.replace(/[A-Za-z0-9_]/g, "").split(""))];
  if (bad.length > 0) {
    const names = bad.map((c) => (/\s/.test(c) ? "spaces" : `"${c}"`));
    return `Your handle can only use letters, numbers and underscores (_). Remove ${names.join(", ")}.`;
  }
  if (body.length < HANDLE_MIN_LENGTH) return `Your handle needs at least ${HANDLE_MIN_LENGTH} characters (it has ${body.length}).`;
  if (body.length > HANDLE_MAX_LENGTH) return `Your handle can be at most ${HANDLE_MAX_LENGTH} characters (it has ${body.length}).`;
  return null;
}
