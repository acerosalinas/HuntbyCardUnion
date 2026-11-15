"use client";

import { useState, useTransition } from "react";
import { Store } from "lucide-react";
import { setAdminView } from "@/app/admin/viewActions";
import { cn } from "@/lib/utils";

/** Super Admin only: the dashboard shows your own store by default; switch to see every store's payments, offers, sales and hearts. */
export function AdminViewSwitch({ allStores }: { allStores: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const choose = (view: "mine" | "all") => {
    if ((view === "all") === allStores) return;
    startTransition(async () => {
      setError(null);
      const result = await setAdminView(view);
      if (result.error) setError(result.error);
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <span className="inline-flex items-center gap-1.5 text-sm text-foreground-muted">
        <Store size={14} aria-hidden="true" />
        Dashboard shows
      </span>
      <div className="inline-flex rounded-lg border border-card-border p-0.5" role="group" aria-label="Which stores the dashboard shows">
        {([["mine", "My store"], ["all", "All stores"]] as const).map(([view, label]) => {
          const active = (view === "all") === allStores;
          return (
            <button
              key={view}
              type="button"
              onClick={() => choose(view)}
              disabled={pending}
              aria-pressed={active}
              className={cn("rounded-md px-3 py-1 text-xs font-medium transition-colors", active ? "bg-gold text-navy-950" : "text-foreground-muted hover:text-foreground")}
            >
              {label}
            </button>
          );
        })}
      </div>
      {error && <span className="text-xs text-sold">{error}</span>}
    </div>
  );
}
