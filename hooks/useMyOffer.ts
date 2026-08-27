"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
import { CardOffer, OfferRow, offerFromRow } from "@/types/marketplace";

/** The signed-in buyer's one open (PENDING/COUNTERED/ACCEPTED) offer on a card, or null - see submit_offer's duplicate-offer guard, which keeps this to at most one. */
export function useMyOffer(cardId: string): CardOffer | null {
  const { buyer } = useBuyerIdentity();
  const [offer, setOffer] = useState<CardOffer | null>(null);
  const supabase = useMemo(() => {
    try {
      return createClient();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!supabase || !buyer) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing a stale offer that belonged to a different (or no) signed-in identity
      setOffer(null);
      return;
    }
    let cancelled = false;

    const refetch = () => {
      supabase
        .from("offers")
        .select("*")
        .eq("card_id", cardId)
        .eq("buyer_id", buyer.id)
        .in("status", ["PENDING", "COUNTERED", "ACCEPTED"])
        .order("created_at", { ascending: false })
        .limit(1)
        .then(({ data }) => {
          if (cancelled) return;
          const rows = (data as OfferRow[] | null) ?? [];
          setOffer(rows.length > 0 ? offerFromRow(rows[0]) : null);
        });
    };

    refetch();

    const channel = supabase
      .channel(`my-offer-${cardId}-${buyer.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "offers", filter: `card_id=eq.${cardId}` },
        refetch,
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [supabase, cardId, buyer]);

  return offer;
}
