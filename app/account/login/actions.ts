"use server";

import { redirect } from "next/navigation";
import { createAuthServerClient } from "@/lib/supabase/authServer";

/**
 * Single sign-in entry point for both buyers and admins - the whole app now
 * uses this one page/form (see AGENTS.md history: /admin/login used to be
 * separate, which admins found a hassle to find/remember). Buyers and
 * admins share one Supabase Auth credential pool, distinguished only by
 * app_metadata.role, but each keeps its own session cookie (lib/supabase/
 * config.ts) so a signed-in buyer and a signed-in admin can coexist in the
 * same browser. The role can't be known before authenticating, so this
 * tries the buyer cookie first (the common case) and, only if the account
 * turns out to be an admin, moves the session into the admin cookie instead.
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

  // Admin account - the sign-in above landed in the wrong (buyer) cookie.
  // "local" scope only clears the session we just created here, not the
  // admin's other active sessions elsewhere.
  await buyerClient.auth.signOut({ scope: "local" });
  const adminClient = await createAuthServerClient("admin");
  const { error: adminError } = await adminClient.auth.signInWithPassword({ email, password });
  if (adminError) {
    return { error: "Sign-in failed. Please try again." };
  }

  redirect(from.startsWith("/admin") ? from : "/admin");
}
