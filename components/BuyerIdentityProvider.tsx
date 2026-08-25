"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
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
  // identity client-side, here.
  //
  // Sign-in/out always happen server-side (Server Actions), never through
  // this browser client directly - so onAuthStateChange's SIGNED_IN/
  // SIGNED_OUT events, which only fire for actions taken through this same
  // client instance, never see them. Its one-time INITIAL_SESSION firing
  // (computed once, when this provider first mounts - often on the login
  // page itself, before signing in, since this provider lives in the root
  // layout and never remounts across client-side navigation) goes stale the
  // moment a server-driven sign-in/out happens afterward, with nothing to
  // correct it - which is exactly the bug this re-check exists to close:
  // an admin/seller signing in (see app/account/login/actions.ts, which
  // keeps both a buyer and an admin session alive under one login) would
  // authenticate successfully server-side yet the marketplace UI kept
  // showing them as signed out. Re-checking on every pathname change (in
  // addition to the mount-time subscription below, kept for any future
  // same-client auth action) means the redirect that follows a server-side
  // sign-in/out always lands on a route that re-verifies for itself,
  // instead of trusting a subscription that was never told anything changed.
  const [buyer, setBuyer] = useState<Buyer | null>(initialBuyer);
  const [loading] = useState(false);
  const pathname = usePathname();
  // Guards against an older, slower check resolving after a newer one (e.g.
  // fast back-to-back navigations) and clobbering the fresher result.
  const requestIdRef = useRef(0);

  const loadBuyer = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    const requestId = ++requestIdRef.current;
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (requestId !== requestIdRef.current) return;

    if (!user || !user.email) {
      setBuyer(null);
      return;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("handle, full_name, ship_name, ship_phone, ship_address, ship_zip")
      .eq("id", user.id)
      .maybeSingle();

    if (requestId !== requestIdRef.current) return;

    setBuyer(
      profile
        ? {
            id: user.id,
            email: user.email,
            handle: profile.handle,
            fullName: profile.full_name,
            shipName: profile.ship_name,
            shipPhone: profile.ship_phone,
            shipAddress: profile.ship_address,
            shipZip: profile.ship_zip,
          }
        : null,
    );
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fresh session check on every navigation, not a plain prop sync
    loadBuyer();
  }, [pathname, loadBuyer]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      loadBuyer();
    });
    return () => subscription.unsubscribe();
  }, [loadBuyer]);

  return <BuyerIdentityContext.Provider value={{ buyer, loading }}>{children}</BuyerIdentityContext.Provider>;
}

export function useBuyerIdentity(): BuyerIdentityContextValue {
  const ctx = useContext(BuyerIdentityContext);
  if (!ctx) throw new Error("useBuyerIdentity must be used within BuyerIdentityProvider");
  return ctx;
}
