import "server-only";
import { createAuthServerClient } from "@/lib/supabase/authServer";

export type AdminRole = "ADMIN" | "SUPER_ADMIN";

export interface CurrentAdmin {
  id: string;
  email: string;
  role: AdminRole;
}

/** Null for a buyer account (no admin role in app_metadata), not just an invalid value - see listAdmins()/listBuyers() in app/admin/actions.ts, which use this to tell the two apart. */
export function roleFromMetadata(appMetadata: Record<string, unknown> | undefined): AdminRole | null {
  const role = appMetadata?.role;
  return role === "SUPER_ADMIN" || role === "ADMIN" ? role : null;
}

/** Resolves the signed-in admin from the Supabase Auth session cookie, or null if not signed in / not an admin. */
export async function getCurrentAdmin(): Promise<CurrentAdmin | null> {
  const supabase = await createAuthServerClient("admin");
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) return null;

  const role = roleFromMetadata(user.app_metadata);
  if (!role) return null;

  return {
    id: user.id,
    email: user.email,
    role,
  };
}

/** Throws if there's no signed-in admin. Convenience for Server Actions. */
export async function requireAdmin(): Promise<CurrentAdmin> {
  const admin = await getCurrentAdmin();
  if (!admin) throw new Error("Not signed in.");
  return admin;
}

/** Throws unless the given admin owns the resource or is a super admin. */
export function assertOwnsOrSuper(admin: CurrentAdmin, resourceAdminId: string | null) {
  if (admin.role === "SUPER_ADMIN") return;
  if (resourceAdminId !== admin.id) {
    throw new Error("You don't have permission to manage this listing.");
  }
}
