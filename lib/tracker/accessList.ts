/**
 * The Live Tracker is a private tool for one account, not every admin. Access
 * needs BOTH the SUPER_ADMIN role AND an email on this list. Override with
 * TRACKER_ALLOWED_EMAILS (comma-separated) in the environment; the default is
 * the account it was built for. No "server-only" here because proxy.ts
 * (the first gate) shares this check.
 */
const DEFAULT_ALLOWED = "acrosalinas@gmail.com";

export function trackerAllowedEmails(): string[] {
  return (process.env.TRACKER_ALLOWED_EMAILS || DEFAULT_ALLOWED)
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function canUseTracker(user: { email: string | null | undefined; role: string | null | undefined } | null): boolean {
  if (!user || user.role !== "SUPER_ADMIN" || !user.email) return false;
  return trackerAllowedEmails().includes(user.email.toLowerCase());
}
