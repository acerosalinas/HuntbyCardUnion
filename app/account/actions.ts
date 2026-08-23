"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAuthServerClient } from "@/lib/supabase/authServer";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBuyer } from "@/lib/buyerAuth";
import { HANDLE_REGEX, normalizeHandle } from "@/lib/handleFormat";

export async function logout() {
  const supabase = await createAuthServerClient("buyer");
  await supabase.auth.signOut();
  // Not "/" - the whole site requires a session (see proxy.ts), so that would
  // just bounce straight back through middleware to this same destination
  // one extra hop later.
  redirect("/account/login");
}

export interface UpdateBuyerProfileInput {
  fullName: string;
  handle: string;
  email: string;
  /** Empty string means "leave unchanged" - not every save is a password change. */
  newPassword: string;
}

/**
 * A buyer editing their own profile. Uses the service-role client for the
 * `profiles` row (same as signup's handle-uniqueness check in
 * app/account/signup/actions.ts - profiles RLS is owner-select-only, no
 * update policy, and this is a trusted Server Action, so there's no need to
 * add one) but the buyer's own session client for the Auth-level fields
 * (email, password), since those act on "the current session's user", not
 * an arbitrary id.
 */
export async function updateBuyerProfile(input: UpdateBuyerProfileInput): Promise<{ emailChangePending: boolean }> {
  const buyer = await getCurrentBuyer();
  if (!buyer) throw new Error("Not signed in.");

  const fullName = input.fullName.trim();
  const handle = normalizeHandle(input.handle);
  const email = input.email.trim();

  if (!fullName) throw new Error("Full name is required.");
  if (!HANDLE_REGEX.test(handle)) throw new Error("Handle must be 3-20 letters, numbers, or underscores.");
  if (!email) throw new Error("Email is required.");

  const adminClient = createAdminClient();

  if (handle !== buyer.handle) {
    const escapedHandle = handle.replace(/[%_]/g, (m) => `\\${m}`);
    const { data: existing } = await adminClient
      .from("profiles")
      .select("id")
      .ilike("handle", escapedHandle)
      .neq("id", buyer.id)
      .maybeSingle();
    if (existing) throw new Error("That handle is already taken.");
  }

  const { error: profileError } = await adminClient
    .from("profiles")
    .update({ handle, full_name: fullName })
    .eq("id", buyer.id);
  if (profileError) throw new Error(profileError.message);

  const supabase = await createAuthServerClient("buyer");
  let emailChangePending = false;

  if (email !== buyer.email) {
    const { error } = await supabase.auth.updateUser({ email });
    if (error) throw new Error(error.message);
    // Supabase emails the NEW address for confirmation - the old email
    // stays active until that's clicked, so nothing switches over yet.
    emailChangePending = true;
  }

  if (input.newPassword) {
    if (input.newPassword.length < 8) throw new Error("New password must be at least 8 characters.");
    const { error } = await supabase.auth.updateUser({ password: input.newPassword });
    if (error) throw new Error(error.message);
  }

  revalidatePath("/account");
  return { emailChangePending };
}
