"use server";

import { redirect } from "next/navigation";
import { createAuthServerClient } from "@/lib/supabase/authServer";
import { ensureBuyerProfileForAdmin } from "@/lib/ensureBuyerProfile";

/**
 * Single sign-in entry point for both buyers and admins - the whole app now
 * uses this one page/form (see AGENTS.md history: /admin/login used to be
 * separate, which admins found a hassle to find/remember). Buyers and
 * admins share one Supabase Auth credential pool, distinguished only by
 * app_metadata.role, but each keeps its own session cookie (lib/supabase/
 * config.ts) so a signed-in buyer and a signed-in admin can coexist in the
 * same browser. The role can't be known before authenticating, so this
 * tries the buyer cookie first (the common case).
 *
 * For an admin account, BOTH sessions are deliberately kept: an admin/
 * seller is meant to be able to click "View Marketplace" and browse, dibs,
 * and buy under their own login, same as any buyer - not appear signed out.
 * ensureBuyerProfileForAdmin backfills the profiles row that action needs
 * (admin accounts don't get one at creation).
 */
export async function login(_prevState: { error: string | null }, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const from = String(formData.get("from") ?? "/");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const buyerClient = await createAuthServerClient("buyer");
  const { data, error } = await buyerClient.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return { error: "Incorrect email or password." };
  }

  const metaRole = data.user.app_metadata?.role;
  const isAdmin = metaRole === "SUPER_ADMIN" || metaRole === "ADMIN";

  if (!isAdmin) {
    redirect(from.startsWith("/admin") ? "/" : from || "/");
  }

  // Admin account - the buyer session created above is kept (not signed
  // out) so this account can also act as a buyer; make sure it has a
  // profiles row to back that up, then also sign into the admin cookie.
  await ensureBuyerProfileForAdmin(data.user.id, email);
  const adminClient = await createAuthServerClient("admin");
  const { error: adminError } = await adminClient.auth.signInWithPassword({ email, password });
  if (adminError) {
    return { error: "Sign-in failed. Please try again." };
  }

  redirect(from.startsWith("/admin") ? from : "/admin");
}
