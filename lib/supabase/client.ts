import { createBrowserClient } from "@supabase/ssr";
import { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

let browserClient: SupabaseClient | null = null;

/**
 * Browser client using the public anon key. Safe to use in client components.
 * Returns a single shared instance (rather than a fresh client per call) so
 * every hook's Realtime subscription rides the same WebSocket connection -
 * creating many independent clients was spamming "Multiple GoTrueClient
 * instances" warnings and causing spurious per-instance connection drops.
 * Uses @supabase/ssr's createBrowserClient (not plain supabase-js) so a
 * buyer's signed-in session is written to cookies, not just localStorage -
 * server code (proxy.ts, createAuthServerClient) needs to see it too.
 */
export function createClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  if (!browserClient) {
    browserClient = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return browserClient;
}
