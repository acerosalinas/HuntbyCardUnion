/**
 * Permissions on top of the two roles (ADMIN, SUPER_ADMIN). A Super Admin always has every permission; a regular admin only has the ones a
 * Super Admin ticked for them (Manage Admins). They are kept in the account's app_metadata.permissions, next to its role, so the first gate
 * (proxy.ts) can check one without a database call. No "server-only" here: proxy.ts and client components share these helpers.
 *
 * To add a permission: add it to PERMISSIONS and PERMISSION_LABELS below, then check hasPermission(user, "your_permission") where it applies.
 */
export const PERMISSIONS = ["live_tracker"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, { label: string; hint: string }> = {
  live_tracker: { label: "Live Tracker", hint: "Their own tracker: customers, lives, sales, payments, proofs and distribution." },
};

/** The permissions stored on an account's app_metadata, with anything unknown or malformed dropped. */
export function permissionsFromMetadata(appMetadata: Record<string, unknown> | undefined | null): Permission[] {
  const raw = appMetadata?.permissions;
  if (!Array.isArray(raw)) return [];
  return PERMISSIONS.filter((p) => raw.includes(p));
}

/** True for a Super Admin (always) or an admin who was given the permission. A buyer or signed-out visitor never has one. */
export function hasPermission(user: { role: string | null | undefined; permissions?: readonly string[] | null } | null | undefined, permission: Permission): boolean {
  if (!user) return false;
  if (user.role === "SUPER_ADMIN") return true;
  return user.role === "ADMIN" && Boolean(user.permissions?.includes(permission));
}
