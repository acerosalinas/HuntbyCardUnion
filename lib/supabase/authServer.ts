import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { ADMIN_AUTH_COOKIE_NAME, BUYER_AUTH_COOKIE_NAME, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

/**
 * Cookie-aware Supabase client for buyer or admin authentication (Supabase
 * Auth). Used in Server Components and Server Actions - reads/writes the
 * session cookies via Next's cookies() API. `role` picks which cookie
 * namespace to use so a buyer session and an admin session can coexist in
 * the same browser - see BUYER_AUTH_COOKIE_NAME/ADMIN_AUTH_COOKIE_NAME.
 */
export async function createAuthServerClient(role: "buyer" | "admin") {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  const cookieStore = await cookies();
  const cookieName = role === "admin" ? ADMIN_AUTH_COOKIE_NAME : BUYER_AUTH_COOKIE_NAME;

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: { name: cookieName },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component render (not an action/route) - the
          // middleware refresh path below handles keeping the session alive.
        }
      },
    },
  });
}
