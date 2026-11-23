import { hasPermission } from "@/lib/permissions";

/**
 * Who may use the Live Tracker: every Super Admin, plus any regular admin a Super Admin gave the "live_tracker" permission (Manage Admins).
 * Each person gets their own tracker - every tracker record (customers, lives, sales, payments, proofs, distribution) is stored under, and
 * only ever read for, the admin who owns it, so nobody sees anyone else's. A buyer, an admin without the permission or a signed-out visitor
 * never gets in. No "server-only" here because proxy.ts (the first gate) shares this check.
 */
export function canUseTracker(
  user: { email: string | null | undefined; role: string | null | undefined; permissions?: readonly string[] | null } | null,
): boolean {
  return Boolean(user && user.email && hasPermission(user, "live_tracker"));
}
