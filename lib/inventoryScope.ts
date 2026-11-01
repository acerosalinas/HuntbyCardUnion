/**
 * Which listings the Inventory Manager shows. Everyone starts on their own shop; only a super admin can look at another shop
 * or at everything, so a super admin's own count isn't mixed up with the other shops' listings.
 */
export type InventoryScope = { kind: "mine" } | { kind: "all" } | { kind: "store"; adminId: string };

/**
 * Turns the `?store=` value into a scope. Anything unexpected (no value, a regular admin asking for another shop, an id that
 * isn't one of the other admins) falls back to the person's own listings, never to somebody else's.
 */
export function resolveInventoryScope(raw: string | undefined, isSuperAdmin: boolean, otherAdminIds: string[]): InventoryScope {
  if (!isSuperAdmin || !raw || raw === "mine") return { kind: "mine" };
  if (raw === "all") return { kind: "all" };
  if (otherAdminIds.includes(raw)) return { kind: "store", adminId: raw };
  return { kind: "mine" };
}

/** The `?store=` value for a scope ("mine" = no parameter at all, so the default URL stays clean). */
export function scopeParam(scope: InventoryScope): string | null {
  if (scope.kind === "mine") return null;
  return scope.kind === "all" ? "all" : scope.adminId;
}
