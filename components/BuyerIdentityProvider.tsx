"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface Buyer {
  id: string;
  email: string;
  handle: string;
  fullName: string;
}

interface BuyerIdentityContextValue {
  buyer: Buyer | null;
  loading: boolean;
}

const BuyerIdentityContext = createContext<BuyerIdentityContextValue | null>(null);

export function BuyerIdentityProvider({
  children,
  initialBuyer,
}: {
  children: React.ReactNode;
  initialBuyer: Buyer | null;
}) {
  // The initial value comes from the server (see app/layout.tsx ->
  // getCurrentBuyer()), which reads the session cookie the same reliable
  // way proxy.ts already does for every page on the site - this avoids an
  // initial loading flicker in the common case where server and client
  // agree. But they CAN disagree in practice (observed live: server render
  // saw no session while the browser's own client already had a valid one
  // for the same user - likely a cookie-visibility timing gap, not
  // reproducible on demand), so this is a starting point, not the last
  // word - the effect below always reconciles against the browser client's
  // own session shortly after, including on its first ("INITIAL_SESSION")
  // firing. An earlier version of this trusted the server exclusively and
  // discarded INITIAL_SESSION, which is exactly what let that mismatch go
  // uncorrected and made "Make Offer"/"Place Order" wrongly bounce a
  // genuinely signed-in buyer to login.
  const [buyer, setBuyer] = useState<Buyer | null>(initialBuyer);
  const [loading] = useState(false);

  // The root layout persists across client-side navigation (Next.js doesn't
  // remount shared layouts on every route change), so this provider is a
  // single long-lived instance for the whole session - useState's initial
  // value only ever applies once, at first mount. Without this sync, a
  // fresh server-resolved initialBuyer arriving after login (a real
  // Server Action redirect, which DOES re-run the layout) would be silently
  // ignored, leaving `buyer` stuck at whatever it was on first mount (often
  // null, if that first mount was the login page itself before signing in).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional prop->state sync (React's documented pattern for adjusting state when a prop changes), not a data fetch
    setBuyer(initialBuyer);
  }, [initialBuyer]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const supabase = createClient();
    let active = true;

    async function loadBuyer(userId: string | undefined, email: string | undefined) {
      if (!userId || !email) {
        if (active) setBuyer(null);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("handle, full_name")
        .eq("id", userId)
        .maybeSingle();
      if (!active) return;
      setBuyer(profile ? { id: userId, email, handle: profile.handle, fullName: profile.full_name } : null);
    }

    // Every event - including the first ("INITIAL_SESSION") - reconciles
    // against the browser client's own session. This is what actually
    // authenticates RPC calls (submit_offer, place_order), so it's the
    // right source of truth to defer to whenever it disagrees with the
    // server-rendered initialBuyer above.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      loadBuyer(session?.user?.id, session?.user?.email);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return <BuyerIdentityContext.Provider value={{ buyer, loading }}>{children}</BuyerIdentityContext.Provider>;
}

export function useBuyerIdentity(): BuyerIdentityContextValue {
  const ctx = useContext(BuyerIdentityContext);
  if (!ctx) throw new Error("useBuyerIdentity must be used within BuyerIdentityProvider");
  return ctx;
}
