"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";

/**
 * A signed-in buyer's saved-for-later card ids. Loaded once per session and
 * kept in sync locally on toggle (no realtime subscription - a buyer's own
 * wishlist only ever changes from their own actions in this browser tab).
 */
export function useWishlist() {
  const { buyer } = useBuyerIdentity();
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!buyer) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the wishlist when the buyer signs out, not a data fetch
      setIds(new Set());
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const supabase = createClient();
    supabase
      .from("wishlists")
      .select("card_id")
      .eq("buyer_id", buyer.id)
      .then(({ data }) => {
        if (!active) return;
        setIds(new Set((data ?? []).map((row) => row.card_id as string)));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [buyer]);

  const toggle = useCallback(
    async (cardId: string) => {
      if (!buyer) return;
      const supabase = createClient();
      const alreadyWishlisted = ids.has(cardId);

      // Optimistic - a failed insert/delete below rolls this back.
      setIds((prev) => {
        const next = new Set(prev);
        if (alreadyWishlisted) next.delete(cardId);
        else next.add(cardId);
        return next;
      });

      const { error } = alreadyWishlisted
        ? await supabase.from("wishlists").delete().eq("buyer_id", buyer.id).eq("card_id", cardId)
        : await supabase.from("wishlists").insert({ buyer_id: buyer.id, card_id: cardId });

      if (error) {
        setIds((prev) => {
          const next = new Set(prev);
          if (alreadyWishlisted) next.add(cardId);
          else next.delete(cardId);
          return next;
        });
      }
    },
    [buyer, ids],
  );

  return { wishlistedIds: ids, loading, isWishlisted: (cardId: string) => ids.has(cardId), toggle };
}
