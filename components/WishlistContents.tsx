"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CardGrid } from "@/components/CardGrid";
import { LogoSpinner } from "@/components/LogoSpinner";
import { WantedCardForm } from "@/components/WantedCardForm";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sortSoldLast } from "@/lib/cardFilter";
import { extractErrorMessage } from "@/lib/utils";
import { CardItem, CardRow, cardFromRow } from "@/types/marketplace";

interface WishlistJoinRow {
  card_id: string;
  cards: CardRow | null;
}

export function WishlistContents() {
  const { buyer } = useBuyerIdentity();
  const [cards, setCards] = useState<CardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!buyer || !isSupabaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no buyer signed in, nothing to load
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    (async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from("wishlists")
          .select("card_id, cards(*)")
          .eq("buyer_id", buyer.id)
          .order("created_at", { ascending: false });
        if (!active) return;
        if (fetchError) throw fetchError;
        setCards(
          ((data as unknown as WishlistJoinRow[] | null) ?? [])
            .filter((row): row is WishlistJoinRow & { cards: CardRow } => row.cards !== null)
            .map((row) => cardFromRow(row.cards)),
        );
      } catch (err) {
        if (!active) return;
        setError(extractErrorMessage(err) ?? "Failed to load your wishlist");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [buyer]);

  if (!buyer) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-24 text-center">
        <Heart size={28} className="text-foreground-muted" />
        <p className="text-sm text-foreground-muted">Sign in to save cards to your wishlist.</p>
        <Link href="/account/login?from=%2Faccount%2Fwishlist">
          <Button variant="gold">Sign In</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <h1 className="mb-4 text-lg font-bold text-foreground">My Wishlist</h1>
      {loading ? (
        <div className="flex flex-col items-center gap-2 py-16">
          <LogoSpinner size={28} />
          <p className="text-sm text-foreground-muted">Loading...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-card-border py-24 text-center">
          <p className="text-sm text-sold">{error}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Try Again
          </Button>
        </div>
      ) : cards.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-card-border py-24 text-center">
          <Heart size={28} className="text-foreground-muted" />
          <p className="text-sm text-foreground-muted">
            Nothing saved yet - tap the heart on any card to keep track of it here.
          </p>
        </div>
      ) : (
        <CardGrid cards={sortSoldLast(cards)} />
      )}
      <WantedCardForm />
    </div>
  );
}
