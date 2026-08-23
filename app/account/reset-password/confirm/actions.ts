"use server";

import { redirect } from "next/navigation";
import { createAuthServerClient } from "@/lib/supabase/authServer";

export async function confirmPasswordReset(_prevState: { error: string | null }, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirmPassword) {
    return { error: "Passwords don't match." };
  }

  const supabase = await createAuthServerClient("buyer");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: "Couldn't update your password - your reset link may have expired. Request a new one." };
  }

  // Sign out of the recovery session (local scope only) rather than leaving
  // them "logged in" here - simpler than deciding whether this account
  // turns out to be a buyer or an admin (see app/account/login/actions.ts),
  // and matches how every other auth flow in this app ends: sign in fresh.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/account/login?reset=success");
}
