"use server";

import { redirect } from "next/navigation";
import { createAuthServerClient } from "@/lib/supabase/authServer";
import { createAdminClient } from "@/lib/supabase/admin";
import { HANDLE_REGEX, normalizeHandle } from "@/lib/handleFormat";

export async function signup(_prevState: { error: string | null }, formData: FormData) {
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

  const supabase = await createAuthServerClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { handle, full_name: fullName } },
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
