"use client";

import { ThemeProvider } from "@/components/ThemeProvider";
import { BuyerIdentityProvider, Buyer } from "@/components/BuyerIdentityProvider";
import { MarketplaceFilterProvider } from "@/components/MarketplaceFilterProvider";
import { CartProvider } from "@/components/CartProvider";
import { NavPendingProvider } from "@/components/NavPendingProvider";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { NumberInputGuard } from "@/components/NumberInputGuard";

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
            <NavPendingProvider>
              <ConfirmProvider>
                <NumberInputGuard />
                {children}
              </ConfirmProvider>
            </NavPendingProvider>
          </MarketplaceFilterProvider>
        </CartProvider>
      </BuyerIdentityProvider>
    </ThemeProvider>
  );
}
