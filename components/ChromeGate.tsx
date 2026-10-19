"use client";

import { usePathname } from "next/navigation";

/** Hides its children (site chrome like the footer) on the standalone /tracker workspace. */
export function ChromeGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/tracker" || pathname?.startsWith("/tracker/")) return null;
  return <>{children}</>;
}
