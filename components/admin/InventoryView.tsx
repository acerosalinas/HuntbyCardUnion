"use client";

import { useMemo, useState } from "react";
import { LayoutGrid, List, PackageX, Search } from "lucide-react";
import { InventoryList } from "@/components/admin/InventoryList";
import { InventoryGrid } from "@/components/admin/InventoryGrid";
import { Input } from "@/components/ui/Input";
import { sortSoldLast } from "@/lib/cardFilter";
import { cn } from "@/lib/utils";
import { CardItem } from "@/types/marketplace";

type View = "list" | "tiles";

/** List/Tiles toggle + search for an admin's (or super admin's) own stock - same underlying cards, two layouts. */
export function InventoryView({ cards }: { cards: CardItem[] }) {
  const [view, setView] = useState<View>("tiles");
  const [query, setQuery] = useState("");
  const [soldOnly, setSoldOnly] = useState(false);
  const soldCount = useMemo(() => cards.filter((c) => c.status === "SOLD").length, [cards]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let result = cards;
    if (soldOnly) result = result.filter((c) => c.status === "SOLD");
    if (q) result = result.filter((c) => c.title.toLowerCase().includes(q) || c.setName.toLowerCase().includes(q));
    // Sold-out stock sinks to the end even with the filter off, instead of
    // being interspersed among what's still actually sellable.
    return sortSoldLast(result);
  }, [cards, query, soldOnly]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title or set..."
            className="pl-8"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSoldOnly((v) => !v)}
            disabled={soldCount === 0}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              soldOnly
                ? "border-gold bg-gold text-navy-950"
                : "border-card-border text-foreground-muted hover:border-gold/50 hover:text-foreground",
            )}
          >
            <PackageX size={14} />
            Sold Out ({soldCount})
          </button>
          {([
            { key: "list" as const, label: "List", icon: List },
            { key: "tiles" as const, label: "Tiles", icon: LayoutGrid },
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

      {query && (
        <p className="mb-2 text-xs text-foreground-muted">
          {filtered.length} of {cards.length} card{cards.length === 1 ? "" : "s"} match &quot;{query}&quot;
        </p>
      )}

      {view === "list" ? <InventoryList cards={filtered} /> : <InventoryGrid cards={filtered} />}
    </div>
  );
}
