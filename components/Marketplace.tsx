"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useRealtimeCards } from "@/hooks/useRealtimeCards";
import { useNegotiatingCardIds } from "@/hooks/useNegotiatingCardIds";
import { useMarketplaceFilter } from "@/components/MarketplaceFilterProvider";
import { CardGrid } from "@/components/CardGrid";
import { LiveDropBanner } from "@/components/LiveDropBanner";
import { matchesCardFilter, sortSoldLast } from "@/lib/cardFilter";
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

  const filtered = useMemo(() => {
    const matches = cards.filter((card) => {
      if (franchiseSlug && card.franchise !== franchiseSlug) return false;
      return matchesCardFilter(card, { query, category, rarity, pokemonType });
    });
    return sortSoldLast(matches);
  }, [cards, query, category, rarity, pokemonType, franchiseSlug]);

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
      <CardGrid cards={filtered} negotiatingCardIds={negotiatingCardIds} />
    </div>
  );
}
