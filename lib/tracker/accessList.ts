/**
 * Who may use the Live Tracker: every Super Admin. Each Super Admin gets their own tracker - every tracker record (customers, lives, sales,
 * payments, proofs, distribution) is stored under, and only ever read for, the admin who owns it, so one Super Admin never sees another's.
 * A regular admin, a buyer or a signed-out visitor never gets in. No "server-only" here because proxy.ts (the first gate) shares this check.
 */
export function canUseTracker(user: { email: string | null | undefined; role: string | null | undefined } | null): boolean {
  return Boolean(user && user.role === "SUPER_ADMIN" && user.email);
}
