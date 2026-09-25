"use client";

import { useMemo } from "react";
import { useRestorableGrid } from "@/hooks/useRestorableGrid";
import { useMarketplaceFilter } from "@/components/MarketplaceFilterProvider";
import { SortMenu } from "@/components/SortMenu";
import { sortCards } from "@/lib/cardFilter";
import { CardGrid } from "@/components/CardGrid";
import { Button } from "@/components/ui/Button";
import { CardItem } from "@/types/marketplace";

/** A seller's sold-out archive - same batch-reveal + scroll-restore behavior as the main marketplace grid (see useRestorableGrid), just with no filters of its own since this is already a fixed, single-seller list. */
export function SoldOutListingsView({ cards, handle }: { cards: CardItem[]; handle: string }) {
  const { sort } = useMarketplaceFilter();
  const sorted = useMemo(() => sortCards(cards, sort), [cards, sort]);
  const { visible, hasMore, remaining, loadMore } = useRestorableGrid(sorted, `sold-out:${handle}:${sort}`);

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-card-border py-24 text-center">
        <p className="text-foreground-muted">Nothing sold out yet.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <SortMenu />
      </div>
      <CardGrid cards={visible} />
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
