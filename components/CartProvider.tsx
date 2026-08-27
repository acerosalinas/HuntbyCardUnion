"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getStoredCartItems, getStoredCartOwner, setStoredCartItems, setStoredCartOwner, StoredCartItem } from "@/lib/cart";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
import { FulfillmentMethod, PaymentMethod } from "@/types/marketplace";

interface CartContextValue {
  items: StoredCartItem[];
  isInCart: (cardId: string) => boolean;
  getQuantity: (cardId: string) => number;
  addToCart: (
    cardId: string,
    quantity: number,
    fulfillmentMethod: FulfillmentMethod,
    paymentMethod: PaymentMethod,
    offer?: { offerId: string; agreedAmount: number },
  ) => void;
  setQuantity: (cardId: string, quantity: number) => void;
  removeFromCart: (cardId: string) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { buyer } = useBuyerIdentity();
  const [items, setItems] = useState<StoredCartItem[]>([]);

  useEffect(() => {
    // The cart is buyer-scoped but localStorage isn't - without this check a
    // cart survives logout (signOut only clears the auth cookie) and would
    // leak into whichever buyer signs in next on the same browser. Whenever
    // the signed-in identity doesn't match whoever the stored cart last
    // belonged to, drop it instead of carrying it over.
    const ownerId = buyer?.id ?? null;
    if (getStoredCartOwner() !== ownerId) {
      setStoredCartOwner(ownerId);
      setStoredCartItems([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing a cart that belonged to a different (or no) signed-in identity
      setItems([]);
      return;
    }
    setItems(getStoredCartItems());
  }, [buyer?.id]);

  const addToCart = (
    cardId: string,
    quantity: number,
    fulfillmentMethod: FulfillmentMethod,
    paymentMethod: PaymentMethod,
    offer?: { offerId: string; agreedAmount: number },
  ) => {
    setItems((prev) => {
      if (prev.some((item) => item.cardId === cardId)) return prev;
      const next = [
        ...prev,
        {
          cardId,
          // Offers are always single-unit, regardless of what's passed in.
          quantity: offer ? 1 : Math.max(1, Math.round(quantity) || 1),
          fulfillmentMethod,
          paymentMethod,
          offerId: offer?.offerId ?? null,
          agreedAmount: offer?.agreedAmount ?? null,
        },
      ];
      setStoredCartItems(next);
      return next;
    });
  };

  const setQuantity = (cardId: string, quantity: number) => {
    setItems((prev) => {
      const next = prev.map((item) =>
        // Locked at 1 for an offer-priced item - offers are single-unit, no stepper for it in the UI.
        item.cardId === cardId && !item.offerId
          ? { ...item, quantity: Math.max(1, Math.round(quantity) || 1) }
          : item,
      );
      setStoredCartItems(next);
      return next;
    });
  };

  const removeFromCart = (cardId: string) => {
    setItems((prev) => {
      const next = prev.filter((item) => item.cardId !== cardId);
      setStoredCartItems(next);
      return next;
    });
  };

  const clearCart = () => {
    setItems([]);
    setStoredCartItems([]);
  };

  const isInCart = (cardId: string) => items.some((item) => item.cardId === cardId);
  const getQuantity = (cardId: string) => items.find((item) => item.cardId === cardId)?.quantity ?? 1;

  return (
    <CartContext.Provider
      value={{ items, isInCart, getQuantity, addToCart, setQuantity, removeFromCart, clearCart }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
