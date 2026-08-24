"use client";

import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, Radio } from "lucide-react";
import { CardGrid } from "@/components/CardGrid";
import { LiveModeStack } from "@/components/LiveModeStack";
import { useMarketplaceFilter } from "@/components/MarketplaceFilterProvider";
import { matchesCardFilter } from "@/lib/cardFilter";
import { cn } from "@/lib/utils";
import { CardItem } from "@/types/marketplace";

type View = "grid" | "live";

export function SellerListingsView({ cards, liveModeSeconds }: { cards: CardItem[]; liveModeSeconds: number }) {
  const [view, setView] = useState<View>("grid");
  const { query, category, rarity, setFranchiseScope } = useMarketplaceFilter();

  // A seller's own page has no /[franchise] URL segment to read, so the
  // rarity dropdown's scope is derived from what this seller actually
  // lists instead - a single franchise if every card matches one, or null
  // (combined list) if they carry more than one game.
  useEffect(() => {
    const franchises = new Set(cards.map((c) => c.franchise).filter((f): f is string => Boolean(f)));
    setFranchiseScope(franchises.size === 1 ? [...franchises][0] : null);
  }, [cards, setFranchiseScope]);

  const filtered = useMemo(
    () => cards.filter((card) => matchesCardFilter(card, { query, category, rarity })),
    [cards, query, category, rarity],
  );
  const availableCards = filtered.filter((c) => c.status === "AVAILABLE");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-foreground">Listings</h2>
        <div className="flex gap-2">
          {([
            { key: "grid" as const, label: "Grid", icon: LayoutGrid },
            { key: "live" as const, label: "Live Mode", icon: Radio },
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                view === key
                  ? "border-gold bg-gold text-navy-950"
                  : "border-card-border text-foreground-muted hover:border-gold/50 hover:text-foreground",
              )}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === "grid" ? (
        <CardGrid cards={filtered} />
      ) : (
        <LiveModeStack cards={availableCards} intervalSeconds={liveModeSeconds} />
      )}
    </div>
  );
}
