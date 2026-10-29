"use client";

import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/hooks/useViewMode";

export function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  const options: { id: ViewMode; label: string; icon: typeof List }[] = [
    { id: "tiles", label: "Tiles", icon: LayoutGrid },
    { id: "list", label: "List", icon: List },
  ];
  return (
    <div role="group" aria-label="View" className="inline-flex overflow-hidden rounded-lg border border-card-border">
      {options.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={mode === id}
          onClick={() => onChange(id)}
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors",
            mode === id ? "bg-gold/15 text-foreground" : "text-foreground-muted hover:text-foreground",
          )}
        >
          <Icon size={13} /> {label}
        </button>
      ))}
    </div>
  );
}
