"use server";

import { redirect } from "next/navigation";
import { createAuthServerClient } from "@/lib/supabase/authServer";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleProblem, normalizeHandle } from "@/lib/handleFormat";
import { resolveOrigin } from "@/lib/origin";
import { allowRequest, clientIp, TOO_MANY } from "@/lib/rateLimit";
import { isEmailRemoved } from "@/lib/removedUsers";
import { REMOVED_MESSAGE } from "@/lib/accessGate";

/** What the sign-up form shows after an attempt: the problem, which field it belongs to, and what was typed (so nothing has to be typed again). */
export interface SignupState {
  error: string | null;
  removed?: boolean;
  field?: "fullName" | "email" | "handle" | "password";
  values?: { fullName: string; email: string; handle: string };
}

export async function signup(_prevState: SignupState, formData: FormData): Promise<SignupState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const handle = normalizeHandle(String(formData.get("handle") ?? ""));
  const from = String(formData.get("from") ?? "/");
  // Handed back with every problem so the form keeps what was typed (the password is never sent back).
  const values = { fullName, email, handle: handle.replace(/^@/, "") };

  if (!fullName) return { error: "Enter your full name.", field: "fullName", values };
  if (!email) return { error: "Enter your email address.", field: "email", values };
  const problem = handleProblem(handle);
  if (problem) return { error: problem, field: "handle", values };
  if (!password) return { error: "Choose a password (at least 8 characters).", field: "password", values };
  if (password.length < 8) {
    return { error: `Your password needs at least 8 characters (it has ${password.length}).`, field: "password", values };
  }

  if (!(await allowRequest("signup-ip", await clientIp(), 5, 3600))) {
    return { error: TOO_MANY, values };
  }

  // Someone an admin removed does not get a fresh account; they are told to message us.
  if (await isEmailRemoved(email)) {
    return { error: REMOVED_MESSAGE, removed: true, values };
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
    return { error: "That handle is already taken - try another one.", field: "handle", values };
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
      return { error: "An account with that email already exists. Try signing in instead.", field: "email", values };
    }
    if (message.includes("rate limit")) {
      return { error: "Too many signups attempted just now - please try again in a few minutes.", values };
    }
    return { error: "Something went wrong creating your account - please try again.", values };
  }

  redirect(`/account/check-email?from=${encodeURIComponent(from)}&email=${encodeURIComponent(email)}`);
}

/**
 * Sends the sign-up confirmation link again. Never says whether an account exists for the address (so it can't be used to look
 * people up), and is rate limited per visitor and per address. Supabase also holds back repeats for about a minute.
 */
export async function resendConfirmation(emailInput: string, from: string): Promise<{ error?: string }> {
  const email = String(emailInput ?? "").trim();
  if (!email || !email.includes("@")) return { error: "Enter the email address you signed up with." };
  if (!(await allowRequest("resend-confirm-ip", await clientIp(), 10, 3600)) || !(await allowRequest("resend-confirm-email", email, 3, 3600))) {
    return { error: TOO_MANY };
  }
  const origin = await resolveOrigin();
  const supabase = await createAuthServerClient("buyer");
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${origin}/auth/callback?from=${encodeURIComponent(from.startsWith("/") ? from : "/")}` },
  });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("rate limit") || message.includes("security purposes") || message.includes("seconds")) {
      return { error: "Please wait a minute before asking for another email." };
    }
    console.error("[resendConfirmation]", error.message);
    return { error: "We couldn't send the email just now. Please try again in a few minutes." };
  }
  return {};
}
