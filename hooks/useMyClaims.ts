"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
import { CardClaim, CardClaimRow, cardClaimFromRow } from "@/types/marketplace";

/** Live PENDING/SOLD claims the signed-in buyer holds on a card - a buyer can hold more than one (e.g. bought units in two separate orders). */
export function useMyClaims(cardId: string): CardClaim[] {
  const { buyer } = useBuyerIdentity();
  const [claims, setClaims] = useState<CardClaim[]>([]);
  const supabase = useMemo(() => {
    try {
      return createClient();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!supabase || !buyer) return;
    let cancelled = false;

    const refetch = () => {
      supabase
        .from("card_claims")
        .select("*")
        .eq("card_id", cardId)
        .eq("buyer_id", buyer.id)
        .in("status", ["PENDING", "SOLD"])
        .then(({ data }) => {
          if (cancelled) return;
          setClaims(((data as CardClaimRow[] | null) ?? []).map(cardClaimFromRow));
        });
    };

    refetch();

    const channel = supabase
      .channel(`claims-${cardId}-${buyer.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "card_claims", filter: `card_id=eq.${cardId}` },
        refetch,
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [supabase, cardId, buyer]);

  return claims;
}
