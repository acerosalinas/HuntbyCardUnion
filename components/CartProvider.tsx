"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getStoredCartIds, getStoredCartOwner, setStoredCartIds, setStoredCartOwner } from "@/lib/cart";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";

interface CartContextValue {
  cardIds: string[];
  isInCart: (cardId: string) => boolean;
  addToCart: (cardId: string) => void;
  removeFromCart: (cardId: string) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { buyer } = useBuyerIdentity();
  const [cardIds, setCardIds] = useState<string[]>([]);

  useEffect(() => {
    // The cart is buyer-scoped but localStorage isn't - without this check a
    // cart survives logout (signOut only clears the auth cookie) and would
    // leak into whichever buyer signs in next on the same browser. Whenever
    // the signed-in identity doesn't match whoever the stored cart last
    // belonged to, drop it instead of carrying it over.
    const ownerId = buyer?.id ?? null;
    if (getStoredCartOwner() !== ownerId) {
      setStoredCartOwner(ownerId);
      setStoredCartIds([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing a cart that belonged to a different (or no) signed-in identity
      setCardIds([]);
      return;
    }
    setCardIds(getStoredCartIds());
  }, [buyer?.id]);

  const addToCart = (cardId: string) => {
    setCardIds((prev) => {
      if (prev.includes(cardId)) return prev;
      const next = [...prev, cardId];
      setStoredCartIds(next);
      return next;
    });
  };

  const removeFromCart = (cardId: string) => {
    setCardIds((prev) => {
      const next = prev.filter((id) => id !== cardId);
      setStoredCartIds(next);
      return next;
    });
  };

  const clearCart = () => {
    setCardIds([]);
    setStoredCartIds([]);
  };

  const isInCart = (cardId: string) => cardIds.includes(cardId);

  return (
    <CartContext.Provider value={{ cardIds, isInCart, addToCart, removeFromCart, clearCart }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
