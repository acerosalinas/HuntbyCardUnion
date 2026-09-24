"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useRealtimeCards } from "@/hooks/useRealtimeCards";
import { useNegotiatingCardIds } from "@/hooks/useNegotiatingCardIds";
import { useRestorableGrid } from "@/hooks/useRestorableGrid";
import { useMarketplaceFilter } from "@/components/MarketplaceFilterProvider";
import { CardGrid } from "@/components/CardGrid";
import { Button } from "@/components/ui/Button";
import { LiveDropBanner } from "@/components/LiveDropBanner";
import { matchesCardFilter } from "@/lib/cardFilter";
import { CardItem } from "@/types/marketplace";

export function Marketplace({
  initialCards,
  nextDropAt,
  franchiseSlug,
  franchiseLabel,
}: {
  initialCards: CardItem[];
  nextDropAt: number | null;
  franchiseSlug?: string;
  franchiseLabel?: string;
}) {
  const cards = useRealtimeCards(initialCards);
  const negotiatingCardIds = useNegotiatingCardIds();
  const { query, category, rarity, pokemonType, setFranchiseScope } = useMarketplaceFilter();

  // Tells RarityFilter (rendered in the global Navbar) which franchise's
  // rarity tiers apply here - undefined on /marketplace (mixes every
  // franchise), a real slug on /[franchise].
  useEffect(() => {
    setFranchiseScope(franchiseSlug ?? null);
  }, [franchiseSlug, setFranchiseScope]);

  // Sold-out listings no longer show here at all - a seller's own storefront
  // has a dedicated "Sold Out" archive page for that (see SellerListingsView
  // and app/sellers/[handle]/sold-out) instead of every dead listing
  // cluttering (and adding photo weight to) the buyer-facing marketplace.
  const filtered = useMemo(() => {
    return cards.filter((card) => {
      if (card.status === "SOLD") return false;
      if (franchiseSlug && card.franchise !== franchiseSlug) return false;
      return matchesCardFilter(card, { query, category, rarity, pokemonType });
    });
  }, [cards, query, category, rarity, pokemonType, franchiseSlug]);

  // Renders a bounded batch at a time (growing via "Load more") and
  // restores scroll position + how much was loaded when returning here via
  // Back - see useRestorableGrid. The key identifies "this exact view" so a
  // changed filter resets both, but a mere data refresh doesn't.
  const { visible, hasMore, remaining, loadMore } = useRestorableGrid(
    filtered,
    `${query}|${category}|${rarity}|${pokemonType}|${franchiseSlug ?? ""}`,
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft size={16} />
          Home
        </Link>
        <h1 className="text-lg font-bold text-foreground">{franchiseLabel ?? "All Cards"}</h1>
      </div>
      <LiveDropBanner nextDropAt={nextDropAt} />
      <CardGrid cards={visible} negotiatingCardIds={negotiatingCardIds} />
      {hasMore && (
        <div className="mt-6 flex justify-center">
          <Button variant="outline" onClick={loadMore}>
            Load more ({remaining} left)
          </Button>
        </div>
      )}
    </div>
  );
}
