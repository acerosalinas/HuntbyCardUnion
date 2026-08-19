"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

interface NavPendingContextValue {
  /** True from the moment a tracked nav link is clicked until the route actually changes. */
  pending: boolean;
  /** Call from a nav link's onClick to hide auth-conditional nav items immediately, instead of
   * waiting for the (possibly redirect-chained) navigation to resolve - avoids a stale item
   * (e.g. "Marketplace"/"Log In") staying visible while the browser is mid-transition into a
   * page where it shouldn't show. */
  markPending: () => void;
}

const NavPendingContext = createContext<NavPendingContextValue | null>(null);

export function NavPendingProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const prevPathname = useRef(pathname);

  useEffect(() => {
    if (prevPathname.current !== pathname) {
      prevPathname.current = pathname;
      setPending(false);
    }
  }, [pathname]);

  return (
    <NavPendingContext.Provider value={{ pending, markPending: () => setPending(true) }}>
      {children}
    </NavPendingContext.Provider>
  );
}

export function useNavPending(): NavPendingContextValue {
  const ctx = useContext(NavPendingContext);
  if (!ctx) throw new Error("useNavPending must be used within NavPendingProvider");
  return ctx;
}
