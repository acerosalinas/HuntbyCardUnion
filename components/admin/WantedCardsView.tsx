"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, ImageOff, Search, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { extractErrorMessage } from "@/lib/utils";
import { updateWantedCardStatus } from "@/app/admin/actions";
import { ImageLightbox } from "@/components/admin/ImageLightbox";
import { ViewToggle } from "@/components/admin/ViewToggle";
import { useViewMode } from "@/hooks/useViewMode";
import { WantedCard, WantedCardStatus } from "@/types/marketplace";

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function WantedCardsView({ wanted: initialWanted }: { wanted: WantedCard[] }) {
  const [wanted, setWanted] = useState(initialWanted);
  const [showResolved, setShowResolved] = useState(false);
  const [mode, setMode] = useViewMode();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The request open in the large view, for checking its photo and full title.
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = wanted.find((w) => w.id === viewingId) ?? null;

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
        <div className="flex shrink-0 items-center gap-3">
          <ViewToggle mode={mode} onChange={setMode} />
          <label className="flex items-center gap-2 text-xs text-foreground-muted">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-card-border accent-gold"
            />
            Show resolved
          </label>
        </div>
      </div>

      {error && <p className="text-sm text-sold">{error}</p>}

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-card-border py-16 text-center">
          <Search size={26} className="text-foreground-muted" />
          <p className="text-sm text-foreground-muted">No open requests right now.</p>
        </div>
      ) : mode === "list" ? (
        <ul className="divide-y divide-card-border overflow-hidden rounded-2xl border border-card-border bg-card">
          {visible.map((w) => {
            const busy = pending && busyId === w.id;
            return (
              <li key={w.id} className="flex flex-wrap items-center gap-3 p-3">
                <button
                  type="button"
                  onClick={() => setViewingId(w.id)}
                  aria-label={`View ${w.cardName} larger`}
                  title="Click to view larger"
                  className="h-24 w-20 shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-card-border bg-navy-950/5 transition-opacity hover:opacity-90"
                >
                  {w.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- buyer-uploaded reference photo, not a local asset
                    <img src={w.photoUrl} alt={w.cardName} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-foreground-muted">
                      <ImageOff size={18} />
                    </div>
                  )}
                </button>
                <div className="min-w-0 flex-1 basis-56">
                  <button type="button" onClick={() => setViewingId(w.id)} className="break-words text-left text-sm font-semibold hover:text-gold">
                    {w.cardName}
                  </button>
                  <p className="text-xs text-foreground-muted">
                    @{w.buyerHandle.replace(/^@/, "")} · {formatDate(w.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {w.status === "OPEN" ? (
                    <>
                      <Button variant="outline" disabled={busy} onClick={() => handleUpdate(w.id, "FULFILLED")} className="px-3 py-1.5 text-xs">
                        <CheckCircle2 size={12} />
                        Fulfilled
                      </Button>
                      <Button variant="outline" disabled={busy} onClick={() => handleUpdate(w.id, "CLOSED")} className="px-3 py-1.5 text-xs">
                        <XCircle size={12} />
                        Not fulfilled
                      </Button>
                    </>
                  ) : (
                    <Badge tone={w.status === "FULFILLED" ? "available" : "neutral"}>{w.status === "FULFILLED" ? "Fulfilled" : "Closed"}</Badge>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((w) => {
            const busy = pending && busyId === w.id;
            return (
              <div key={w.id} className="flex gap-3 rounded-2xl border border-card-border bg-card p-3">
                <button
                  type="button"
                  onClick={() => setViewingId(w.id)}
                  aria-label={`View ${w.cardName} larger`}
                  title="Click to view larger"
                  className="h-28 w-24 shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-card-border bg-navy-950/5 transition-opacity hover:opacity-90"
                >
                  {w.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- buyer-uploaded reference photo, not a local asset
                    <img src={w.photoUrl} alt={w.cardName} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-foreground-muted">
                      <ImageOff size={20} />
                    </div>
                  )}
                </button>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <button type="button" onClick={() => setViewingId(w.id)} className="break-words text-left text-sm font-semibold text-foreground hover:text-gold">
                    {w.cardName}
                  </button>
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
                        Not fulfilled
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
      {viewing && (
        <ImageLightbox
          title={viewing.cardName}
          subtitle={
            <>
              Requested by <span className="font-medium text-foreground">@{viewing.buyerHandle.replace(/^@/, "")}</span> · {formatDate(viewing.createdAt)}
            </>
          }
          images={viewing.photoUrl ? [viewing.photoUrl] : []}
          onClose={() => setViewingId(null)}
        >
          {viewing.status === "OPEN" ? (
            <>
              <Button variant="outline" disabled={pending && busyId === viewing.id} onClick={() => handleUpdate(viewing.id, "FULFILLED")}>
                <CheckCircle2 size={14} />
                Fulfilled
              </Button>
              <Button variant="outline" disabled={pending && busyId === viewing.id} onClick={() => handleUpdate(viewing.id, "CLOSED")}>
                <XCircle size={14} />
                Not fulfilled
              </Button>
            </>
          ) : (
            <Badge tone={viewing.status === "FULFILLED" ? "available" : "neutral"}>{viewing.status === "FULFILLED" ? "Fulfilled" : "Closed"}</Badge>
          )}
        </ImageLightbox>
      )}
    </div>
  );
}
