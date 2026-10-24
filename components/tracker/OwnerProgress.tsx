import { cn, formatCurrency } from "@/lib/utils";
import type { OwnerProgress as Item } from "@/lib/tracker/dashboard";
import { ownerColor } from "@/lib/tracker/ownerColors";
import type { OwnerLabel } from "@/lib/tracker/split";

/** A progress bar per owner: how much of what they're expected to collect has actually come in. */
export function OwnerProgressBars({ items, labels, compact = false }: { items: Item[]; labels: OwnerLabel[]; compact?: boolean }) {
  if (items.length === 0) {
    return <p className="text-sm text-foreground-muted">No owners are active. Turn them on in Settings.</p>;
  }
  return (
    <ul className={cn("grid gap-3", compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")}>
      {items.map((o) => {
        const pct = o.expected > 0 ? Math.min(100, Math.round((o.actual / o.expected) * 100)) : 0;
        const toGive = Math.round((o.actual - o.distributed) * 100) / 100;
        return (
          <li key={o.code}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{o.name}</span>
              <span className="text-xs text-foreground-muted">
                <span className="font-semibold text-foreground">{formatCurrency(o.actual)}</span> of {formatCurrency(o.expected)} · {pct}%
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${o.name} collected ${pct}%`}
              className="h-2.5 overflow-hidden rounded-full bg-foreground/10"
            >
              <div className={cn("h-full rounded-full transition-all", ownerColor(o.code, labels)?.bar ?? "bg-gold")} style={{ width: `${pct}%` }} />
            </div>
            {o.actual > 0 && (
              <p className="mt-1 text-xs text-foreground-muted">
                Given out {formatCurrency(o.distributed)}
                {toGive > 0 && <span className="text-pending"> · {formatCurrency(toGive)} to give</span>}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
