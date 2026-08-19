"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { QueueEntry, QueueEntryRow, queueEntryFromRow } from "@/types/marketplace";

/** Live WAITING queue entries for a card, ordered oldest-first (queue order). */
export function useCardQueue(cardId: string): QueueEntry[] {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const supabase = useMemo(() => {
    try {
      return createClient();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    const refetch = () => {
      supabase
        .from("dibs_queue")
        .select("*")
        .eq("card_id", cardId)
        .eq("status", "WAITING")
        .order("created_at", { ascending: true })
        .then(({ data }) => {
          if (cancelled) return;
          setEntries(((data as QueueEntryRow[] | null) ?? []).map(queueEntryFromRow));
        });
    };

    refetch();

    const channel = supabase
      .channel(`queue-${cardId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dibs_queue", filter: `card_id=eq.${cardId}` },
        refetch,
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [supabase, cardId]);

  return entries;
}
