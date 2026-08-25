"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface Buyer {
  id: string;
  email: string;
  handle: string;
  fullName: string;
  /** Saved shipping default, editable at /account/edit - checkout pre-fills from these. */
  shipName: string | null;
  shipPhone: string | null;
  shipAddress: string | null;
  shipZip: string | null;
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
  // `initialBuyer` is always null now (see app/layout.tsx) - resolving the
  // buyer server-side there used to block every navigation in the app on a
  // Supabase Auth round-trip, so it was removed in favor of resolving
  // identity entirely client-side, here. The effect below reconciles
  // against the browser client's own session on mount, including its first
  // ("INITIAL_SESSION") firing, which is what actually authenticates RPC
  // calls (submit_offer, place_order) anyway - an earlier version of this
  // trusted a server-resolved value exclusively and discarded
  // INITIAL_SESSION, which let a server/client mismatch go uncorrected and
  // made "Make Offer"/"Place Order" wrongly bounce a genuinely signed-in
  // buyer to login. Expect a brief flash of signed-out chrome on first
  // paint for a returning signed-in buyer - deliberate, and already how
  // this behaved on any mismatch even before this change.
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
        .select("handle, full_name, ship_name, ship_phone, ship_address, ship_zip")
        .eq("id", userId)
        .maybeSingle();
      if (!active) return;
      setBuyer(
        profile
          ? {
              id: userId,
              email,
              handle: profile.handle,
              fullName: profile.full_name,
              shipName: profile.ship_name,
              shipPhone: profile.ship_phone,
              shipAddress: profile.ship_address,
              shipZip: profile.ship_zip,
            }
          : null,
      );
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
