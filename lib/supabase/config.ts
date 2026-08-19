export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/**
 * Buyer and admin sessions are both plain Supabase Auth users, distinguished
 * only by app_metadata.role - without distinct cookie names they'd share one
 * session cookie, so signing in as one identity in one tab silently knocks
 * the other identity's session out from under it in every other tab (same
 * origin, same cookie jar). Separate base cookie names let one browser hold
 * a buyer session and an admin session at the same time.
 */
export const BUYER_AUTH_COOKIE_NAME = "sb-buyer-auth-token";
export const ADMIN_AUTH_COOKIE_NAME = "sb-admin-auth-token";
