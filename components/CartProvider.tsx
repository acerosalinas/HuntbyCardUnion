"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getStoredCartIds, setStoredCartIds } from "@/lib/cart";

interface CartContextValue {
  cardIds: string[];
  isInCart: (cardId: string) => boolean;
  addToCart: (cardId: string) => void;
  removeFromCart: (cardId: string) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cardIds, setCardIds] = useState<string[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating the persisted cart from localStorage on mount
    setCardIds(getStoredCartIds());
  }, []);

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
