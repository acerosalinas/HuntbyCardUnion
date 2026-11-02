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

  // New-style link ({{ .RedirectTo }}?token_hash=...&type=recovery in the Supabase email template). It works in any
  // browser or app, so it is NOT checked here: the token is checked when the new password is submitted, which also
  // stops email scanners and link previews from using it up just by opening the link.
  const tokenHash = searchParams.get("token_hash");
  if (tokenHash && searchParams.get("type") === "recovery") {
    return NextResponse.redirect(new URL(`/account/reset-password/confirm?token_hash=${encodeURIComponent(tokenHash)}`, origin));
  }

  // Older-style link: a one-time code that only works in the browser that asked for the reset.
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
