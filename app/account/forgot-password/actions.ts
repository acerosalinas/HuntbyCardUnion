"use server";

import { headers } from "next/headers";
import { createServerReadClient } from "@/lib/supabase/server";

async function resolveOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "";
  const protocol = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

/**
 * Shared by both buyers and admins - they're both plain Supabase Auth users
 * in the same credential pool (see app/account/login/actions.ts), so
 * password recovery doesn't need to know the role at all, unlike login.
 * Always reports success regardless of whether the email is actually
 * registered, so this can't be used to enumerate accounts.
 */
export async function requestPasswordReset(_prevState: { sent: boolean; error: string | null }, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    return { sent: false, error: "Enter your email address." };
  }

  const supabase = createServerReadClient();
  const origin = await resolveOrigin();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/account/reset-password`,
  });

  return { sent: true, error: null };
}
