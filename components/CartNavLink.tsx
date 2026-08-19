"use client";

import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { useCart } from "@/components/CartProvider";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";

export function CartNavLink() {
  const { cardIds } = useCart();
  const { buyer } = useBuyerIdentity();

  if (!buyer) return null;

  return (
    <Link
      href="/cart"
      className="relative inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground sm:px-3"
    >
      <ShoppingCart size={18} />
      <span className="hidden sm:inline">Cart</span>
      {cardIds.length > 0 && (
        <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-navy-950">
          {cardIds.length}
        </span>
      )}
    </Link>
  );
}
