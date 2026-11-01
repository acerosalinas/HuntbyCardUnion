"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Live set of card ids that currently have at least one PENDING offer - the
 * "Negotiating" signal shown on the marketplace grid, card detail, and
 * admin inventory. Deliberately not a card status: a card can still be
 * dibsed/added to cart while negotiations are ongoing, exactly like today -
 * this is a derived, read-only display flag, not a new state in the claim
 * flow. Re-fetches the authoritative PENDING set on any offers change
 * rather than patching incrementally, since an UPDATE can move a row's
 * status away from PENDING (accepted/declined/superseded) just as easily
 * as an INSERT can add one.
 */
export function useNegotiatingCardIds(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const supabase = useMemo(() => {
    try {
      return createClient();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    // Offers are private (row level security), so this asks a database function that returns card ids only.
    const refresh = () => {
      supabase.rpc("negotiating_card_ids").then(({ data }) => {
        if (!active) return;
        setIds(new Set(((data as string[] | null) ?? []).map((id) => String(id))));
      });
    };

    refresh();

    // Other people's offer changes are not delivered to this browser any more, but placing, accepting or
    // declining an offer always updates the card's hold fields, and card changes are public - so re-check on those.
    const channel = supabase
      .channel("negotiating-offers")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "cards" }, refresh)
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  return ids;
}
