"use client";

import Link from "next/link";
import { ListChecks } from "lucide-react";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";

export function MyDibsNavLink() {
  const { buyer } = useBuyerIdentity();

  if (!buyer) return null;

  return (
    <Link
      href="/account/dibs"
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground sm:px-3"
    >
      <ListChecks size={18} />
      <span className="hidden sm:inline">My Dibs</span>
    </Link>
  );
}
