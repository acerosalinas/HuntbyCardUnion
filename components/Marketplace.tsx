"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useRealtimeCards } from "@/hooks/useRealtimeCards";
import { useNegotiatingCardIds } from "@/hooks/useNegotiatingCardIds";
import { useMarketplaceFilter } from "@/components/MarketplaceFilterProvider";
import { CardGrid } from "@/components/CardGrid";
import { LiveDropBanner } from "@/components/LiveDropBanner";
import { CardItem } from "@/types/marketplace";

function isGraded(conditionGrade: string): boolean {
  return !/^raw/i.test(conditionGrade.trim());
}

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
  const { query, category } = useMarketplaceFilter();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((card) => {
      if (franchiseSlug && card.franchise !== franchiseSlug) return false;
      if (category === "RAW" && isGraded(card.conditionGrade)) return false;
      if (category === "GRADED" && !isGraded(card.conditionGrade)) return false;
      if (category === "FLASH_SALE" && !card.isFlashSale) return false;

      if (!q) return true;
      return (
        card.title.toLowerCase().includes(q) ||
        card.setName.toLowerCase().includes(q) ||
        card.sellerHandle.toLowerCase().includes(q) ||
        card.conditionGrade.toLowerCase().includes(q)
      );
    });
  }, [cards, query, category, franchiseSlug]);

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
