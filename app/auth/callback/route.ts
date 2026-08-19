import { NextRequest, NextResponse } from "next/server";
import { createAuthServerClient } from "@/lib/supabase/authServer";

/**
 * Landing point after a Google OAuth sign-in redirects back from Supabase.
 * Exchanges the PKCE code for a session, then routes the buyer onward:
 * straight to `from` if they already have a profile (returning buyer), or to
 * /account/complete-profile if this is their first sign-in - Google doesn't
 * know about our custom @handle, so there's nothing for the handle_new_user
 * trigger to read from raw_user_meta_data and no profiles row gets created
 * automatically the way it does for email/password signups.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const from = searchParams.get("from") ?? "/";

  if (!code) {
    return NextResponse.redirect(new URL("/account/login", origin));
  }

  const supabase = await createAuthServerClient("buyer");
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(new URL("/account/login", origin));
  }

  const { data: profile } = await supabase.from("profiles").select("id").eq("id", data.user.id).maybeSingle();

  if (!profile) {
    const completeUrl = new URL("/account/complete-profile", origin);
    completeUrl.searchParams.set("from", from);
    return NextResponse.redirect(completeUrl);
  }

  return NextResponse.redirect(new URL(from.startsWith("/admin") ? "/" : from, origin));
}
