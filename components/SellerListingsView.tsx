"use client";

import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, Radio } from "lucide-react";
import { CardGrid } from "@/components/CardGrid";
import { LiveModeStack } from "@/components/LiveModeStack";
import { useMarketplaceFilter } from "@/components/MarketplaceFilterProvider";
import { matchesCardFilter } from "@/lib/cardFilter";
import { FRANCHISES } from "@/lib/franchises";
import { cn } from "@/lib/utils";
import { CardItem } from "@/types/marketplace";

type View = "grid" | "live";

export function SellerListingsView({
  cards,
  liveModeSeconds,
  sellerTags,
}: {
  cards: CardItem[];
  liveModeSeconds: number;
  /** seller_profiles.tags - the seller's own "what do I sell" declaration (set via the Franchise-slug dropdown in SellerProfileForm), used ahead of each card's own `franchise` column since older listings can predate that field being set. */
  sellerTags: string[];
}) {
  const [view, setView] = useState<View>("grid");
  const { query, category, rarity, pokemonType, setFranchiseScope } = useMarketplaceFilter();

  // A seller's own page has no /[franchise] URL segment to read, so the
  // rarity dropdown's scope has to come from elsewhere. Prefer the seller's
  // own declared franchise tag(s) - reliable even for cards whose
  // individual `franchise` column was never set - and only fall back to
  // inferring from the cards themselves if the seller has no recognized tag.
  useEffect(() => {
    const tagFranchises = sellerTags.filter((t) => FRANCHISES.some((f) => f.slug === t));
    if (tagFranchises.length === 1) {
      setFranchiseScope(tagFranchises[0]);
      return;
    }
    const cardFranchises = new Set(cards.map((c) => c.franchise).filter((f): f is string => Boolean(f)));
    setFranchiseScope(cardFranchises.size === 1 ? [...cardFranchises][0] : null);
  }, [cards, sellerTags, setFranchiseScope]);

  const filtered = useMemo(
    () => cards.filter((card) => matchesCardFilter(card, { query, category, rarity, pokemonType })),
    [cards, query, category, rarity, pokemonType],
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
