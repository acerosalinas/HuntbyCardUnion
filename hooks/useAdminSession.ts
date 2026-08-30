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

export interface AdminSession {
  isAdmin: boolean;
  email: string | null;
  role: "ADMIN" | "SUPER_ADMIN" | null;
}

const EMPTY_SESSION: AdminSession = { isAdmin: false, email: null, role: null };

/** Whether this browser also holds a live admin/seller session - false for the vast majority of buyers, who never have an admin cookie at all (cheap local check, no network round trip), plus the admin's own email/role for display (e.g. the mobile drawer's profile card on /admin/* pages, where a live session is guaranteed by requireAdmin() at the page level). Re-checked on every navigation - see BuyerIdentityProvider for why a one-time check alone would go stale after a server-side sign-in. */
export function useAdminSession(): AdminSession {
  const [session, setSession] = useState<AdminSession>(EMPTY_SESSION);
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
    if (role === "ADMIN" || role === "SUPER_ADMIN") {
      setSession({ isAdmin: true, email: user?.email ?? null, role });
    } else {
      setSession(EMPTY_SESSION);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setSession inside check() only runs after the async getUser() round-trip resolves, not synchronously during render
    check();
  }, [pathname, check]);

  return session;
}
