"use server";

import { redirect } from "next/navigation";
import { createAuthServerClient } from "@/lib/supabase/authServer";
import { createAdminClient } from "@/lib/supabase/admin";
import { HANDLE_REGEX, normalizeHandle } from "@/lib/handleFormat";

export async function completeProfile(_prevState: { error: string | null }, formData: FormData) {
  const fullName = String(formData.get("fullName") ?? "").trim();
  const handle = normalizeHandle(String(formData.get("handle") ?? ""));
  const from = String(formData.get("from") ?? "/");

  if (!fullName || !handle) {
    return { error: "Fill in every field to continue." };
  }
  if (!HANDLE_REGEX.test(handle)) {
    return { error: "Handle must be 3-20 letters, numbers, or underscores." };
  }

  const supabase = await createAuthServerClient("buyer");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/account/login?from=${encodeURIComponent(from)}`);
  }

  // Same pattern as the email/password signup pre-check: profiles RLS is
  // owner-only, so the admin client is needed to see other buyers' rows.
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

  const { error } = await adminClient.from("profiles").insert({ id: user.id, handle, full_name: fullName });
  if (error) {
    return { error: "Something went wrong - please try again." };
  }

  redirect(from.startsWith("/admin") ? "/" : from || "/");
}
