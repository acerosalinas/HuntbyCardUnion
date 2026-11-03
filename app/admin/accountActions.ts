"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAuthServerClient } from "@/lib/supabase/authServer";
import { roleFromMetadata, AdminRole } from "@/lib/adminAuth";
import { revalidatePath } from "next/cache";
import { isAllowedIn, normalizeEmail } from "@/lib/accessGate";
import { requireSuperAdmin, revalidateAdmin } from "./actionHelpers";

export async function logout() {
  const supabase = await createAuthServerClient("admin");
  await supabase.auth.signOut();
  // Not "/admin/login" - that's just a thin redirect stub now; go straight
  // to the one shared sign-in page (see app/account/login/actions.ts).
  redirect("/account/login");
}

// ---------------------------------------------------------------------------
// Admin account management (super admin only).
// ---------------------------------------------------------------------------

export interface AdminAccount {
  id: string;
  email: string;
  role: AdminRole;
  /** This admin's public storefront handle (seller_profiles.handle), or null if they haven't set one up. */
  handle: string | null;
  active: boolean;
  createdAt: number;
}

export interface BuyerAccountSummary {
  id: string;
  email: string;
  /** profiles.handle, already "@"-prefixed - null only if signup was interrupted before the profile row was created. */
  handle: string | null;
  /** profiles.full_name - null only if signup was interrupted before the profile row was created. */
  fullName: string | null;
  createdAt: number;
  /** An admin has put this account on hold (see lib/accessGate.ts): it can't browse or buy until released. */
  blocked: boolean;
  /** An admin removed an account with this email before. */
  removedBefore: boolean;
  /** Signed up within the last 7 days - worked out on the server so every viewer sees the same thing. */
  isNew: boolean;
}

/**
 * supabase.auth.admin.listUsers() returns every account this project has
 * ever authenticated - buyers and admins alike, since both sign in through
 * the same Supabase Auth users table (see BUYER_AUTH_COOKIE_NAME vs
 * ADMIN_AUTH_COOKIE_NAME - two separate sessions, one underlying user
 * table). listAdmins()/listBuyers() partition that single list by
 * roleFromMetadata() rather than each paying for their own full scan.
 * perPage defaults to 50 - bumped to Supabase's max so a growing user base
 * doesn't silently drop off the end of either list.
 */
async function listAllAuthUsers() {
  const supabase = createAdminClient();
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  return data.users;
}

export async function listAdmins(): Promise<AdminAccount[]> {
  await requireSuperAdmin();
  const users = await listAllAuthUsers();
  const adminUsers = users.filter((u) => roleFromMetadata(u.app_metadata) !== null);

  const supabase = createAdminClient();
  const { data: profileRows } = await supabase
    .from("seller_profiles")
    .select("admin_id, handle")
    .in("admin_id", adminUsers.map((u) => u.id));
  const handleByAdminId = new Map((profileRows ?? []).map((r) => [r.admin_id as string, r.handle as string]));

  return adminUsers
    .map((u) => ({
      id: u.id,
      email: u.email ?? "(no email)",
      role: roleFromMetadata(u.app_metadata) as AdminRole,
      handle: handleByAdminId.has(u.id) ? `@${handleByAdminId.get(u.id)}` : null,
      active: !u.banned_until || new Date(u.banned_until) <= new Date(),
      createdAt: new Date(u.created_at).getTime(),
    }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Read-only roster for the Manage Admins page - buyers have no account-management actions here (banning/password-reset is scoped to admin accounts only). */
export async function listBuyers(): Promise<BuyerAccountSummary[]> {
  await requireSuperAdmin();
  const users = await listAllAuthUsers();
  const buyerUsers = users.filter((u) => roleFromMetadata(u.app_metadata) === null);

  const supabase = createAdminClient();
  const { data: profileRows } = await supabase
    .from("profiles")
    .select("id, handle, full_name")
    .in("id", buyerUsers.map((u) => u.id));
  const profileById = new Map(
    (profileRows ?? []).map((r) => [r.id as string, { handle: r.handle as string, fullName: r.full_name as string }]),
  );

  const { data: removedRows } = await supabase.from("removed_users").select("email");
  const removed = new Set((removedRows ?? []).map((r) => r.email as string));

  return buyerUsers
    .map((u) => ({
      id: u.id,
      email: u.email ?? "(no email)",
      handle: profileById.get(u.id)?.handle ?? null,
      fullName: profileById.get(u.id)?.fullName ?? null,
      createdAt: new Date(u.created_at).getTime(),
      blocked: !isAllowedIn(u.app_metadata),
      removedBefore: u.email ? removed.has(normalizeEmail(u.email)) : false,
      isNew: Date.now() - new Date(u.created_at).getTime() < 7 * 24 * 60 * 60 * 1000,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function createAdminAccount(email: string, password: string, role: AdminRole) {
  await requireSuperAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role },
  });
  if (error) throw new Error(error.message);
  revalidateAdmin();
}

export async function setAdminActive(adminId: string, active: boolean) {
  const current = await requireSuperAdmin();
  if (current.id === adminId && !active) {
    throw new Error("You can't deactivate your own account.");
  }

  const supabase = createAdminClient();
  // The store goes with the account: hidden from the marketplace while deactivated, back on reactivation. Done first,
  // so a missing migration stops here instead of leaving a banned seller with a still-visible store.
  const { error: storeError } = await supabase.from("seller_profiles").update({ active }).eq("admin_id", adminId);
  if (storeError) {
    throw new Error(
      /active|schema cache/i.test(storeError.message)
        ? "Run supabase/migration_hide_deactivated_stores.sql in the Supabase SQL editor first."
        : storeError.message,
    );
  }
  const { error } = await supabase.auth.admin.updateUserById(adminId, {
    // "876000h" (100 years) is Supabase's documented way to ban indefinitely; "none" lifts it.
    ban_duration: active ? "none" : "876000h",
  });
  if (error) {
    // Keep the two in step if the ban call itself failed.
    await supabase.from("seller_profiles").update({ active: !active }).eq("admin_id", adminId);
    throw new Error(error.message);
  }
  revalidateAdmin();
  revalidatePath("/marketplace");
}

export async function resetAdminPassword(adminId: string, newPassword: string) {
  await requireSuperAdmin();
  if (newPassword.length < 6) throw new Error("Password must be at least 6 characters.");

  const supabase = createAdminClient();
  const { error } = await supabase.auth.admin.updateUserById(adminId, { password: newPassword });
  if (error) throw new Error(error.message);
}

/**
 * Puts a buyer's account on hold, or releases it. On hold = `approved: false` in their app_metadata (only the server
 * can write that): they see a "your account is on hold" page and every buyer action refuses, but nothing is deleted, so
 * it is fully reversible. Their session token can keep showing pages for up to an hour, but anything that changes data
 * stops at once. Returns { error } for expected refusals - production hides the text of thrown action errors.
 */
export async function setBuyerBlocked(userId: string, blocked: boolean): Promise<{ error?: string }> {
  await requireSuperAdmin();
  const supabase = createAdminClient();
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data.user) return { error: "That account no longer exists." };
  const user = data.user;
  if (roleFromMetadata(user.app_metadata) !== null) return { error: "That is an admin account." };

  const { error: updateError } = await supabase.auth.admin.updateUserById(userId, { app_metadata: { ...user.app_metadata, approved: !blocked } });
  if (updateError) return { error: updateError.message };
  revalidatePath("/admin/manage");
  return {};
}

/**
 * Permanently deletes a buyer's account. Their past orders, offers and claims stay in your records (those keep their
 * own copy of the handle). The email is remembered first, so if they try to come back they are told to message you.
 * Refuses to delete anyone it cannot remember, and never an admin account.
 */
export async function deleteBuyer(userId: string): Promise<{ error?: string }> {
  const admin = await requireSuperAdmin();
  const supabase = createAdminClient();
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data.user) return { error: "That account no longer exists." };
  const user = data.user;
  if (roleFromMetadata(user.app_metadata) !== null) return { error: "Admin accounts can't be deleted here." };

  if (user.email) {
    const { error: logError } = await supabase
      .from("removed_users")
      .upsert({ email: normalizeEmail(user.email), removed_by: admin.id, removed_at: new Date().toISOString() }, { onConflict: "email" });
    if (logError) {
      return { error: /removed_users|schema cache|does not exist/i.test(logError.message) ? "Run supabase/migration_removed_users.sql in the Supabase SQL editor first." : logError.message };
    }
  }

  const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
  if (deleteError) return { error: deleteError.message };
  revalidatePath("/admin/manage");
  return {};
}
