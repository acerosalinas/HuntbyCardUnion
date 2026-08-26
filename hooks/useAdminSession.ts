"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { ADMIN_AUTH_COOKIE_NAME, SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/supabase/config";

let adminBrowserClient: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Separate from lib/supabase/client.ts (buyer-only, reads the buyer cookie)
 * - this reads the admin cookie instead, purely to answer "does this browser
 * also have a live admin session" for Navbar's "Admin Dashboard" link. An
 * admin/seller browsing as a buyer (see app/account/login/actions.ts, which
 * keeps both sessions alive under one login) has no other way back to
 * /admin once they've clicked into buyer-facing pages otherwise.
 */
function getAdminBrowserClient() {
  if (!adminBrowserClient) {
    adminBrowserClient = createBrowserClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      cookieOptions: { name: ADMIN_AUTH_COOKIE_NAME },
    });
  }
  return adminBrowserClient;
}

/** Whether this browser also holds a live admin/seller session - false for the vast majority of buyers, who never have an admin cookie at all (cheap local check, no network round trip). Re-checked on every navigation - see BuyerIdentityProvider for why a one-time check alone would go stale after a server-side sign-in. */
export function useAdminSession(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);
  const pathname = usePathname();
  const requestIdRef = useRef(0);

  const check = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    const requestId = ++requestIdRef.current;
    const supabase = getAdminBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (requestId !== requestIdRef.current) return;

    const role = user?.app_metadata?.role;
    setIsAdmin(role === "ADMIN" || role === "SUPER_ADMIN");
  }, []);

  useEffect(() => {
    check();
  }, [pathname, check]);

  return isAdmin;
}
