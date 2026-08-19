export const HANDLE_REGEX = /^@[A-Za-z0-9_]{3,20}$/;

export function normalizeHandle(raw: string): string {
  const trimmed = raw.trim().replace(/^@/, "");
  return trimmed ? `@${trimmed}` : "";
}
