"use client";

import { useRestorableGrid } from "@/hooks/useRestorableGrid";
import { CardGrid } from "@/components/CardGrid";
import { Button } from "@/components/ui/Button";
import { CardItem } from "@/types/marketplace";

/** A seller's sold-out archive - same batch-reveal + scroll-restore behavior as the main marketplace grid (see useRestorableGrid), just with no filters of its own since this is already a fixed, single-seller list. */
export function SoldOutListingsView({ cards, handle }: { cards: CardItem[]; handle: string }) {
  const { visible, hasMore, remaining, loadMore } = useRestorableGrid(cards, `sold-out:${handle}`);

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-card-border py-24 text-center">
        <p className="text-foreground-muted">Nothing sold out yet.</p>
      </div>
    );
  }

  return (
    <div>
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
