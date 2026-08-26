"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, ImageOff, Search, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { extractErrorMessage } from "@/lib/utils";
import { updateWantedCardStatus } from "@/app/admin/actions";
import { WantedCard, WantedCardStatus } from "@/types/marketplace";

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function WantedCardsView({ wanted: initialWanted }: { wanted: WantedCard[] }) {
  const [wanted, setWanted] = useState(initialWanted);
  const [showResolved, setShowResolved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(
    () => wanted.filter((w) => (showResolved ? true : w.status === "OPEN")),
    [wanted, showResolved],
  );

  const handleUpdate = (id: string, status: WantedCardStatus) => {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      try {
        await updateWantedCardStatus(id, status);
        setWanted((prev) => prev.map((w) => (w.id === id ? { ...w, status } : w)));
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Failed to update");
      } finally {
        setBusyId(null);
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-foreground-muted">
          Cards buyers are hunting for but couldn&apos;t find listed - list one if you&apos;ve got it.
        </p>
        <label className="flex shrink-0 items-center gap-2 text-xs text-foreground-muted">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-card-border accent-gold"
          />
          Show resolved
        </label>
      </div>

      {error && <p className="text-sm text-sold">{error}</p>}

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-card-border py-16 text-center">
          <Search size={26} className="text-foreground-muted" />
          <p className="text-sm text-foreground-muted">No open requests right now.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((w) => {
            const busy = pending && busyId === w.id;
            return (
              <div key={w.id} className="flex gap-3 rounded-2xl border border-card-border bg-card p-3">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-card-border bg-navy-950/5">
                  {w.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- buyer-uploaded reference photo, not a local asset
                    <img src={w.photoUrl} alt={w.cardName} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-foreground-muted">
                      <ImageOff size={20} />
                    </div>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <p className="line-clamp-2 text-sm font-semibold text-foreground">{w.cardName}</p>
                  <p className="text-xs text-foreground-muted">
                    {w.buyerHandle} · {formatDate(w.createdAt)}
                  </p>
                  {w.status === "OPEN" ? (
                    <div className="mt-auto flex gap-1.5">
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => handleUpdate(w.id, "FULFILLED")}
                        className="flex-1 px-2 py-1 text-xs"
                      >
                        <CheckCircle2 size={12} />
                        Fulfilled
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => handleUpdate(w.id, "CLOSED")}
                        className="flex-1 px-2 py-1 text-xs"
                      >
                        <XCircle size={12} />
                        Dismiss
                      </Button>
                    </div>
                  ) : (
                    <Badge tone={w.status === "FULFILLED" ? "available" : "neutral"} className="w-fit">
                      {w.status === "FULFILLED" ? "Fulfilled" : "Closed"}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
