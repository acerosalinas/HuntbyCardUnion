"use client";

import { createContext, ReactNode, useContext } from "react";
import { useRealtimeCards } from "@/hooks/useRealtimeCards";
import { CardItem } from "@/types/marketplace";

const HomeCardsContext = createContext<CardItem[] | null>(null);

/**
 * The home page's cards, kept live in one place (one Realtime subscription) and shared by the search box and the shelf - so a card that was
 * just listed, sold or removed shows up in the suggestions at the same moment it does on the shelf, not on the next page rebuild.
 */
export function HomeCardsProvider({ initialCards, children }: { initialCards: CardItem[]; children: ReactNode }) {
  const cards = useRealtimeCards(initialCards);
  return <HomeCardsContext.Provider value={cards}>{children}</HomeCardsContext.Provider>;
}

export function useHomeCards(): CardItem[] {
  const cards = useContext(HomeCardsContext);
  if (!cards) throw new Error("useHomeCards must be used inside HomeCardsProvider");
  return cards;
}
