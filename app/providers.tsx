"use client";

import { ThemeProvider } from "@/components/ThemeProvider";
import { BuyerIdentityProvider, Buyer } from "@/components/BuyerIdentityProvider";
import { MarketplaceFilterProvider } from "@/components/MarketplaceFilterProvider";
import { CartProvider } from "@/components/CartProvider";
import { NavPendingProvider } from "@/components/NavPendingProvider";

export function Providers({
  children,
  initialBuyer,
}: {
  children: React.ReactNode;
  initialBuyer: Buyer | null;
}) {
  return (
    <ThemeProvider>
      <BuyerIdentityProvider initialBuyer={initialBuyer}>
        <CartProvider>
          <MarketplaceFilterProvider>
            <NavPendingProvider>{children}</NavPendingProvider>
          </MarketplaceFilterProvider>
        </CartProvider>
      </BuyerIdentityProvider>
    </ThemeProvider>
  );
}
