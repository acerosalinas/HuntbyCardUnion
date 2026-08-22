"use client";

import { useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { InventoryList } from "@/components/admin/InventoryList";
import { InventoryGrid } from "@/components/admin/InventoryGrid";
import { cn } from "@/lib/utils";
import { CardItem } from "@/types/marketplace";

type View = "list" | "tiles";

/** List/Tiles toggle for an admin's (or super admin's) own stock - same underlying cards, two layouts. */
export function InventoryView({ cards }: { cards: CardItem[] }) {
  const [view, setView] = useState<View>("list");

  return (
    <div>
      <div className="mb-3 flex justify-end gap-2">
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

      {view === "list" ? <InventoryList cards={cards} /> : <InventoryGrid cards={cards} />}
    </div>
  );
}
