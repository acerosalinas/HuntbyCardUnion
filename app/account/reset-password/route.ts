import { NextRequest, NextResponse } from "next/server";
import { createAuthServerClient } from "@/lib/supabase/authServer";

/**
 * Landing point for the password-reset email link (see requestPasswordReset,
 * app/account/forgot-password/actions.ts). Exchanges the PKCE code for a
 * session - same pattern as app/auth/callback/route.ts for Google sign-in -
 * then hands off to the actual "set new password" form. This has to be a
 * route handler, not the form page itself: only Server Actions and route
 * handlers can persist the resulting session cookie, a plain Server
 * Component render can't (see the setAll comment in
 * lib/supabase/authServer.ts).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/account/forgot-password?error=invalid_link", origin));
  }

  const supabase = await createAuthServerClient("buyer");
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL("/account/forgot-password?error=expired_link", origin));
  }

  return NextResponse.redirect(new URL("/account/reset-password/confirm", origin));
}
