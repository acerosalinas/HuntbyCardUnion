import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { ADMIN_AUTH_COOKIE_NAME, BUYER_AUTH_COOKIE_NAME, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";

// Routes reachable without a session - everything needed to create one.
// /admin/login is intentionally not here: it's just a thin redirect to
// /account/login now (the one shared sign-in page for both roles), so it
// falls through to the normal isAdminRoute handling below like any other
// /admin/* path - unauthenticated visits get bounced to /account/login by
// that path before the stub page ever renders.
const PUBLIC_PATHS = [
  "/account/login",
  "/account/signup",
  "/account/check-email",
  "/account/complete-profile",
  "/account/forgot-password",
  "/account/reset-password",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAdminRoute = pathname.startsWith("/admin");
  const isAuthCallback = pathname.startsWith("/auth/callback");
  const isPublicBuyerPath = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (isAuthCallback || isPublicBuyerPath) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return isAdminRoute ? NextResponse.redirect(new URL("/account/login", request.url)) : response;
  }

  // Buyer and admin sessions live in separate cookies (see
  // lib/supabase/config.ts) so one browser can hold both at once - each
  // route branch below must only ever read the cookie for the identity it
  // actually cares about.
  const cookieName = isAdminRoute ? ADMIN_AUTH_COOKIE_NAME : BUYER_AUTH_COOKIE_NAME;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: { name: cookieName },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Admin routes keep the strict getUser() check - it asks Supabase Auth
  // directly, so a removed/demoted admin is locked out immediately. Buyer
  // routes only need "is there a valid session?", which getClaims() answers
  // by verifying the token's signature locally against the project's cached
  // signing key - no network round-trip to Supabase Auth on every page load.
  // The tradeoff: a buyer removed mid-session keeps browsing until their
  // token expires (about an hour), but every action that touches their data
  // (getCurrentBuyer, RPCs, RLS) still verifies them against Supabase itself.
  // Everything that isn't /admin (marketplace browsing, card detail, cart,
  // my-dibs, account, disputes) requires a signed-in session - buyer or
  // admin. The whole site is invite-only: nothing is visible until you've
  // logged in.
  if (!isAdminRoute) {
    const { data } = await supabase.auth.getClaims();
    if (!data?.claims) {
      const loginUrl = new URL("/account/login", request.url);
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL("/account/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const metaRole = user.app_metadata?.role;
  const role = metaRole === "SUPER_ADMIN" || metaRole === "ADMIN" ? metaRole : null;
  if (!role) {
    const loginUrl = new URL("/account/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }
  if (
    (pathname.startsWith("/admin/manage") || pathname.startsWith("/admin/live-sales")) &&
    role !== "SUPER_ADMIN"
  ) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  return response;
}

export const config = {
  // "api/" excluded - API routes (e.g. app/api/webhooks/notifications) are
  // called server-to-server with no browser session cookie at all, and have
  // their own auth (a shared secret header) rather than a buyer/admin login.
  // Redirecting those to /account/login instead of ever reaching the route
  // is exactly what broke the notifications webhook.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
