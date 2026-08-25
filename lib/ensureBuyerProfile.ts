import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

function sanitizeHandleBase(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "").slice(0, 16);
  return cleaned.length >= 3 ? cleaned : (cleaned + "user123").slice(0, 16);
}

/**
 * Admin/seller accounts (created via supabase.auth.admin.createUser, see
 * createAdminAccount in app/admin/actions.ts) have no `profiles` row -
 * buyer features (My Dibs, checkout, wishlist, ...) need one. Called from
 * the login action's admin branch so an admin/seller can browse and buy
 * under their own login instead of needing a second buyer account. Reuses
 * their seller_profiles handle/display name as a starting point when they
 * have one; a generic fallback derived from their email otherwise. The
 * result is just a normal profiles row - buyer-editable afterward at
 * /account/edit like any other buyer's.
 */
export async function ensureBuyerProfileForAdmin(userId: string, email: string): Promise<void> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (existing) return;

  const { data: sellerProfile } = await supabase
    .from("seller_profiles")
    .select("handle, display_name")
    .eq("admin_id", userId)
    .maybeSingle();

  const emailLocalPart = email.split("@")[0] ?? "admin";
  const fullName = sellerProfile?.display_name || emailLocalPart;
  const base = sanitizeHandleBase(sellerProfile?.handle || emailLocalPart);

  const { data: existingHandles } = await supabase.from("profiles").select("handle");
  const takenHandles = new Set((existingHandles ?? []).map((r) => (r.handle as string).toLowerCase()));

  let handle = `@${base}`;
  let suffix = 1;
  while (takenHandles.has(handle.toLowerCase())) {
    suffix += 1;
    const suffixStr = String(suffix);
    handle = `@${base.slice(0, 19 - suffixStr.length)}${suffixStr}`;
  }

  const { error } = await supabase.from("profiles").insert({ id: userId, handle, full_name: fullName });
  if (error) throw new Error(error.message);
}
