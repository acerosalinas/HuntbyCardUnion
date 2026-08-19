"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CardItem, CardRow, cardFromRow } from "@/types/marketplace";

/**
 * Keeps a single card in sync with Supabase Realtime, seeded from
 * server-fetched initial data. Mirrors useRealtimeCards but scoped to one
 * row for the card detail page.
 */
export function useRealtimeCard(initialCard: CardItem): CardItem {
  const [card, setCard] = useState<CardItem>(initialCard);
  const supabase = useMemo(() => {
    try {
      return createClient();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;

    const channel = supabase
      .channel(`card-${initialCard.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cards", filter: `id=eq.${initialCard.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          setCard(cardFromRow(payload.new as CardRow));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, initialCard.id]);

  return card;
}
