"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CardItem, CardRow, cardFromRow } from "@/types/marketplace";

/**
 * Keeps a card list in sync with Supabase Realtime (postgres_changes on the
 * `cards` table), seeded from server-fetched initial data.
 */
export function useRealtimeCards(initialCards: CardItem[]) {
  const [cards, setCards] = useState<CardItem[]>(initialCards);
  const supabase = useMemo(() => {
    try {
      return createClient();
    } catch {
      return null;
    }
  }, []);
  const initialCardsRef = useRef(initialCards);

  useEffect(() => {
    setCards(initialCardsRef.current);
  }, []);

  useEffect(() => {
    if (!supabase) return;

    const channel = supabase
      .channel("cards-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cards" },
        (payload) => {
          setCards((prev) => {
            if (payload.eventType === "DELETE") {
              const oldId = (payload.old as { id: string }).id;
              return prev.filter((c) => c.id !== oldId);
            }
            const row = payload.new as CardRow;
            const updated = cardFromRow(row);
            const exists = prev.some((c) => c.id === updated.id);
            if (exists) {
              return prev.map((c) => (c.id === updated.id ? updated : c));
            }
            return [updated, ...prev];
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  return cards;
}
