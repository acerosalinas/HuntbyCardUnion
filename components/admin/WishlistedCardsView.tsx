"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { CheckCircle2, Heart, ImageOff, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { updateWishlistStatus } from "@/app/admin/actions";
import { ImageLightbox } from "@/components/admin/ImageLightbox";
import { ViewToggle } from "@/components/admin/ViewToggle";
import { useViewMode } from "@/hooks/useViewMode";
import { extractErrorMessage, formatCurrency } from "@/lib/utils";

export interface WishlistedItem {
  id: string;
  cardId: string;
  cardTitle: string;
  /** Every photo of the listing, first one is the cover. */
  images: string[];
  price: number;
  cardStatus: string;
  buyerHandle: string;
  createdAt: string;
  status: "OPEN" | "FULFILLED" | "CLOSED";
}

/** Cards buyers have hearted. Answer one as Fulfilled (the buyer is told it's available and to message us) or Not fulfilled. */
export function WishlistedCardsView({ items }: { items: WishlistedItem[] }) {
  const [showResolved, setShowResolved] = useState(false);
  const [mode, setMode] = useViewMode();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = items.find((i) => i.id === viewingId) ?? null;

  const visible = items.filter((i) => (showResolved ? true : i.status === "OPEN"));

  const answer = (id: string, status: "FULFILLED" | "CLOSED") => {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      try {
        await updateWishlistStatus(id, status);
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Failed to update");
      } finally {
        setBusyId(null);
      }
    });
  };

  return (
    <section className="mt-8 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-base font-semibold">
            <Heart size={16} className="text-gold" /> Wishlisted cards
          </h2>
          <p className="text-sm text-foreground-muted">Cards buyers have saved to their wishlist. Mark one fulfilled and they&apos;re told it&apos;s available and to message you to claim it.</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <ViewToggle mode={mode} onChange={setMode} />
          <label className="flex items-center gap-2 text-xs text-foreground-muted">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} className="h-3.5 w-3.5 rounded border-card-border accent-gold" />
            Show resolved
          </label>
        </div>
      </div>

      {error && <p className="text-sm text-sold">{error}</p>}

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-card-border py-10 text-center text-sm text-foreground-muted">No wishlisted cards waiting.</p>
      ) : mode === "list" ? (
        <ul className="divide-y divide-card-border overflow-hidden rounded-2xl border border-card-border bg-card">
          {visible.map((w) => {
            const busy = pending && busyId === w.id;
            return (
              <li key={w.id} className="flex flex-wrap items-center gap-3 p-3">
                <button
                  type="button"
                  onClick={() => setViewingId(w.id)}
                  aria-label={`View ${w.cardTitle} larger`}
                  title="Click to view larger"
                  className="h-24 w-20 shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-card-border bg-navy-950/5 transition-opacity hover:opacity-90"
                >
                  {w.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- card photo from the image bucket
                    <img src={w.images[0]} alt={w.cardTitle} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-foreground-muted">
                      <ImageOff size={18} />
                    </div>
                  )}
                </button>
                <div className="min-w-0 flex-1 basis-56">
                  <button type="button" onClick={() => setViewingId(w.id)} className="break-words text-left text-sm font-semibold hover:text-gold">
                    {w.cardTitle}
                  </button>
                  <p className="text-xs text-foreground-muted">
                    @{w.buyerHandle} · {w.createdAt.slice(0, 10)} · {formatCurrency(w.price)} · <span className="capitalize">{w.cardStatus.toLowerCase()}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {w.status === "OPEN" ? (
                    <>
                      <Button variant="outline" disabled={busy} onClick={() => answer(w.id, "FULFILLED")} className="px-3 py-1.5 text-xs">
                        <CheckCircle2 size={12} />
                        Fulfilled
                      </Button>
                      <Button variant="outline" disabled={busy} onClick={() => answer(w.id, "CLOSED")} className="px-3 py-1.5 text-xs">
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
                  aria-label={`View ${w.cardTitle} larger`}
                  title="Click to view larger"
                  className="h-28 w-24 shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-card-border bg-navy-950/5 transition-opacity hover:opacity-90"
                >
                  {w.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- card photo from the image bucket
                    <img src={w.images[0]} alt={w.cardTitle} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-foreground-muted">
                      <ImageOff size={20} />
                    </div>
                  )}
                </button>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <button type="button" onClick={() => setViewingId(w.id)} className="break-words text-left text-sm font-semibold hover:text-gold">
                    {w.cardTitle}
                  </button>
                  <p className="text-xs text-foreground-muted">
                    @{w.buyerHandle} · {w.createdAt.slice(0, 10)} · {formatCurrency(w.price)} · <span className="capitalize">{w.cardStatus.toLowerCase()}</span>
                  </p>
                  {w.status === "OPEN" ? (
                    <div className="mt-auto flex gap-1.5">
                      <Button variant="outline" disabled={busy} onClick={() => answer(w.id, "FULFILLED")} className="flex-1 px-2 py-1 text-xs">
                        <CheckCircle2 size={12} />
                        Fulfilled
                      </Button>
                      <Button variant="outline" disabled={busy} onClick={() => answer(w.id, "CLOSED")} className="flex-1 px-2 py-1 text-xs">
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
          title={viewing.cardTitle}
          subtitle={
            <>
              Wishlisted by <span className="font-medium text-foreground">@{viewing.buyerHandle}</span> · {viewing.createdAt.slice(0, 10)} · {formatCurrency(viewing.price)} ·{" "}
              <span className="capitalize">{viewing.cardStatus.toLowerCase()}</span> ·{" "}
              <Link href={`/card/${viewing.cardId}`} className="underline hover:text-gold">
                open listing
              </Link>
            </>
          }
          images={viewing.images}
          onClose={() => setViewingId(null)}
        >
          {viewing.status === "OPEN" ? (
            <>
              <Button variant="outline" disabled={pending && busyId === viewing.id} onClick={() => answer(viewing.id, "FULFILLED")}>
                <CheckCircle2 size={14} />
                Fulfilled
              </Button>
              <Button variant="outline" disabled={pending && busyId === viewing.id} onClick={() => answer(viewing.id, "CLOSED")}>
                <XCircle size={14} />
                Not fulfilled
              </Button>
            </>
          ) : (
            <Badge tone={viewing.status === "FULFILLED" ? "available" : "neutral"}>{viewing.status === "FULFILLED" ? "Fulfilled" : "Closed"}</Badge>
          )}
        </ImageLightbox>
      )}
    </section>
  );
}
