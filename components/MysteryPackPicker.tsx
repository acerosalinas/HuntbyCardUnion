"use client";

import { cn } from "@/lib/utils";
import { packNumbers } from "@/lib/mysteryPack";

/** The numbered packs of a Fun Mystery Pack listing. A taken number is crossed out and can't be picked. */
export function MysteryPackPicker({
  count,
  taken,
  value,
  onChange,
}: {
  count: number;
  taken: number[];
  value: number | null;
  onChange: (pack: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span id="mystery-pack-label" className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
        Choose your pack
      </span>
      <div className="grid grid-cols-5 gap-2" role="group" aria-labelledby="mystery-pack-label">
        {packNumbers(count).map((n) => {
          const isTaken = taken.includes(n);
          const selected = value === n;
          return (
            <button
              key={n}
              type="button"
              disabled={isTaken}
              aria-pressed={selected}
              aria-label={isTaken ? `Pack ${n}, already taken` : `Pack ${n}`}
              onClick={() => onChange(n)}
              className={cn(
                "flex h-11 items-center justify-center rounded-lg border text-base font-semibold tabular-nums transition-colors",
                selected
                  ? "border-gold bg-gold text-navy-950 ring-1 ring-gold"
                  : isTaken
                    ? "cursor-not-allowed border-card-border text-foreground-muted/50 line-through"
                    : "border-card-border text-foreground hover:border-gold/60 hover:bg-gold/10",
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-foreground-muted">
        {value ? `You picked pack ${value}.` : "Pick one number - what's inside stays a surprise."} {taken.length > 0 && `${taken.length} of ${count} already taken.`}
      </p>
    </div>
  );
}
