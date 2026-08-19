"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogIn, UserCircle } from "lucide-react";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";

export function AccountNavLink() {
  const { buyer, loading } = useBuyerIdentity();
  const pathname = usePathname();

  if (loading) return null;

  if (!buyer) {
    return (
      <Link
        href={`/account/login?from=${encodeURIComponent(pathname ?? "/")}`}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground sm:px-3"
      >
        <LogIn size={18} />
        <span className="hidden sm:inline">Log In</span>
      </Link>
    );
  }

  return (
    <Link
      href="/account"
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground sm:px-3"
    >
      <UserCircle size={18} />
      <span className="hidden sm:inline">{buyer.handle}</span>
    </Link>
  );
}
