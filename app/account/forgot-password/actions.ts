"use server";

import { createServerReadClient } from "@/lib/supabase/server";
import { resolveOrigin } from "@/lib/origin";
import { allowRequest, clientIp, TOO_MANY } from "@/lib/rateLimit";

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

  if (!(await allowRequest("reset-ip", await clientIp(), 10, 3600)) || !(await allowRequest("reset-email", email, 3, 3600))) {
    return { sent: false, error: TOO_MANY };
  }

  const supabase = createServerReadClient();
  const origin = await resolveOrigin();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/account/reset-password`,
  });

  return { sent: true, error: null };
}
