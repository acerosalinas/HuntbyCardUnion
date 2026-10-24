import { cn, formatCurrency } from "@/lib/utils";
import type { OwnerProgress as Item } from "@/lib/tracker/dashboard";
import { ownerColor } from "@/lib/tracker/ownerColors";
import type { OwnerLabel } from "@/lib/tracker/split";

/**
 * Two lines per owner on one shared scale: a light "Expected" bar (what their
 * cards add up to) and a solid "Received" bar (what's actually been paid), so
 * the gap between them - and the difference between owners - reads at a glance.
 */
export function OwnerProgressBars({ items, labels, compact = false }: { items: Item[]; labels: OwnerLabel[]; compact?: boolean }) {
  if (items.length === 0) {
    return <p className="text-sm text-foreground-muted">No owners are active. Turn them on in Settings.</p>;
  }
  // Same scale for every bar, so a bigger seller's bar is visibly longer.
  const scale = Math.max(1, ...items.flatMap((o) => [o.expected, o.actual]));
  const width = (n: number) => `${Math.min(100, (n / scale) * 100)}%`;

  return (
    <ul className={cn("grid gap-5", compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")}>
      {items.map((o) => {
        const pct = o.expected > 0 ? Math.min(100, Math.round((o.actual / o.expected) * 100)) : 0;
        const toGive = Math.round((o.actual - o.distributed) * 100) / 100;
        const color = ownerColor(o.code, labels);
        return (
          <li key={o.code}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">{o.name}</span>
              <span className="text-xs text-foreground-muted">{pct}% received</span>
            </div>
            {(
              [
                ["Expected", o.expected, color?.barSoft ?? "bg-gold/30"],
                ["Received", o.actual, color?.bar ?? "bg-gold"],
              ] as const
            ).map(([name, value, fill]) => (
              <div key={name} className="mb-1.5 flex items-center gap-2">
                <span className="w-[4.25rem] shrink-0 text-xs text-foreground-muted">{name}</span>
                <div
                  role="progressbar"
                  aria-label={`${o.name} ${name.toLowerCase()}`}
                  aria-valuenow={value}
                  aria-valuemin={0}
                  aria-valuemax={scale}
                  className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/10"
                >
                  <div className={cn("h-full rounded-full transition-all", fill)} style={{ width: width(value) }} />
                </div>
                <span className={cn("w-24 shrink-0 text-right text-xs", name === "Received" ? "font-semibold text-foreground" : "text-foreground-muted")}>
                  {formatCurrency(value)}
                </span>
              </div>
            ))}
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
