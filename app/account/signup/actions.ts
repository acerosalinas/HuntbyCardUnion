"use server";

import { redirect } from "next/navigation";
import { createAuthServerClient } from "@/lib/supabase/authServer";
import { createAdminClient } from "@/lib/supabase/admin";
import { HANDLE_REGEX, normalizeHandle } from "@/lib/handleFormat";
import { resolveOrigin } from "@/lib/origin";
import { allowRequest, clientIp, TOO_MANY } from "@/lib/rateLimit";
import { isEmailRemoved } from "@/lib/removedUsers";
import { REMOVED_MESSAGE } from "@/lib/accessGate";

export async function signup(_prevState: { error: string | null; removed?: boolean }, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const handle = normalizeHandle(String(formData.get("handle") ?? ""));
  const from = String(formData.get("from") ?? "/");

  if (!email || !password || !fullName || !handle) {
    return { error: "Fill in every field to continue." };
  }
  if (!HANDLE_REGEX.test(handle)) {
    return { error: "Handle must be 3-20 letters, numbers, or underscores." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  if (!(await allowRequest("signup-ip", await clientIp(), 5, 3600))) {
    return { error: TOO_MANY };
  }

  // Someone an admin removed does not get a fresh account; they are told to message us.
  if (await isEmailRemoved(email)) {
    return { error: REMOVED_MESSAGE, removed: true };
  }

  // Pre-check via the service-role client, since `profiles` RLS is
  // owner-only and would hide every row from this unauthenticated request.
  // Escape LIKE wildcards (_ and %) so an underscore in the handle can't
  // match unrelated rows via `ilike`.
  const escapedHandle = handle.replace(/[%_]/g, (m) => `\\${m}`);
  const adminClient = createAdminClient();
  const { data: existing } = await adminClient
    .from("profiles")
    .select("id")
    .ilike("handle", escapedHandle)
    .maybeSingle();
  if (existing) {
    return { error: "That handle is already taken." };
  }

  const origin = await resolveOrigin();
  const supabase = await createAuthServerClient("buyer");
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { handle, full_name: fullName },
      // Without this, Supabase falls back to whatever "Site URL" is
      // configured in the dashboard - left over from local dev, that meant
      // every confirmation email pointed at localhost regardless of where
      // the app is actually deployed. This must also be added to the
      // project's Redirect URLs allow-list in the Supabase dashboard or it
      // gets silently ignored in favor of that same fallback.
      emailRedirectTo: `${origin}/auth/callback?from=${encodeURIComponent(from)}`,
    },
  });

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("already registered")) {
      return { error: "An account with that email already exists." };
    }
    if (message.includes("rate limit")) {
      return { error: "Too many signups attempted just now - please try again in a few minutes." };
    }
    return { error: "Something went wrong creating your account - please try again." };
  }

  redirect(`/account/check-email?from=${encodeURIComponent(from)}`);
}
