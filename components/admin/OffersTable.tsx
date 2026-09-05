"use client";

import { useState, useTransition } from "react";
import { ImageOff, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn, extractErrorMessage, formatCurrency } from "@/lib/utils";
import { acceptOffer, counterOffer, declineOffer } from "@/app/admin/actions";

type View = "list" | "tiles";

export interface OfferRowView {
  id: string;
  cardId: string;
  cardTitle: string;
  cardImage: string | null;
  listedPrice: number;
  offeredAmount: number;
  /** Set once status is ACCEPTED - the price the buyer will actually be charged. */
  agreedAmount: number | null;
  buyerHandle: string;
  note: string | null;
  status: "PENDING" | "ACCEPTED";
  createdAt: number;
}

/** Rough "time left before expire_stale_offers auto-expires this" readout - only meaningful for PENDING (that job never touches ACCEPTED). See the pg_cron job in supabase/schema.sql. */
function timeLeftLabel(createdAt: number): string {
  const hoursLeft = 24 - (Date.now() - createdAt) / (1000 * 60 * 60);
  if (hoursLeft <= 0) return "Expiring soon";
  if (hoursLeft < 1) return `Expires in ${Math.round(hoursLeft * 60)}m`;
  return `Expires in ${Math.round(hoursLeft)}h`;
}

export function OffersTable({ offers }: { offers: OfferRowView[] }) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [counteringId, setCounteringId] = useState<string | null>(null);
  const [counterValue, setCounterValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("tiles");

  const run = (id: string, action: () => Promise<void>) => {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      try {
        await action();
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Action failed");
      } finally {
        setBusyId(null);
        setCounteringId(null);
      }
    });
  };

  if (offers.length === 0) {
    return <p className="py-10 text-center text-sm text-foreground-muted">No open offers.</p>;
  }

  const pendingOffers = offers.filter((o) => o.status === "PENDING");
  const acceptedOffers = offers.filter((o) => o.status === "ACCEPTED");

  return (
    <div className="space-y-6">
      <div className="flex justify-end gap-2">
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

      {error && <p className="text-sm text-sold">{error}</p>}

      {view === "tiles" ? (
        <div className="space-y-6">
          {pendingOffers.length > 0 && (
            <div className="space-y-3">
              {acceptedOffers.length > 0 && (
                <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Needs Your Response</h2>
              )}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {pendingOffers.map((offer) => {
                  const busy = pending && busyId === offer.id;
                  const isCountering = counteringId === offer.id;
                  return (
                    <div key={offer.id} className="flex flex-col overflow-hidden rounded-2xl border border-card-border bg-card">
                      <div className="relative aspect-[3/4] w-full bg-navy-950/5">
                        {offer.cardImage ? (
                          // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URLs
                          <img src={offer.cardImage} alt={offer.cardTitle} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-foreground-muted">
                            <ImageOff size={24} />
                          </div>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-1 p-3 text-xs">
                        <p className="line-clamp-1 text-sm font-semibold text-foreground">{offer.cardTitle}</p>
                        <p className="text-foreground-muted">{offer.buyerHandle}</p>
                        <p className="text-foreground-muted">
                          Listed {formatCurrency(offer.listedPrice)}
                        </p>
                        <p className="font-semibold text-gold">Offered {formatCurrency(offer.offeredAmount)}</p>
                        <p className="text-pending">{timeLeftLabel(offer.createdAt)}</p>
                        {offer.note && <p className="italic text-foreground-muted">&ldquo;{offer.note}&rdquo;</p>}
                      </div>
                      <div className="flex flex-col gap-1.5 p-3 pt-0">
                        <Button variant="primary" disabled={busy} onClick={() => run(offer.id, () => acceptOffer(offer.id))} className="px-2 py-1.5 text-xs">
                          Accept
                        </Button>
                        <div className="flex gap-1.5">
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => setCounteringId(isCountering ? null : offer.id)}
                            className="flex-1 px-2 py-1.5 text-xs"
                          >
                            Counter
                          </Button>
                          <Button variant="danger" disabled={busy} onClick={() => run(offer.id, () => declineOffer(offer.id))} className="flex-1 px-2 py-1.5 text-xs">
                            Decline
                          </Button>
                        </div>
                        {isCountering && (
                          <div className="mt-1 flex flex-col gap-1.5">
                            <Input
                              type="number"
                              placeholder="Counter amount"
                              value={counterValue}
                              onChange={(e) => setCounterValue(e.target.value)}
                              className="text-xs"
                            />
                            <Button
                              variant="gold"
                              disabled={busy || !counterValue}
                              onClick={() => run(offer.id, () => counterOffer(offer.id, Number(counterValue)))}
                              className="px-2 py-1.5 text-xs"
                            >
                              Send Counter
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {acceptedOffers.length > 0 && (
            <div className="space-y-3">
              {pendingOffers.length > 0 && (
                <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                  Accepted — Awaiting Buyer Checkout
                </h2>
              )}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {acceptedOffers.map((offer) => {
                  const busy = pending && busyId === offer.id;
                  return (
                    <div key={offer.id} className="flex flex-col overflow-hidden rounded-2xl border border-card-border bg-card">
                      <div className="relative aspect-[3/4] w-full bg-navy-950/5">
                        {offer.cardImage ? (
                          // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URLs
                          <img src={offer.cardImage} alt={offer.cardTitle} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-foreground-muted">
                            <ImageOff size={24} />
                          </div>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-1 p-3 text-xs">
                        <p className="line-clamp-1 text-sm font-semibold text-foreground">{offer.cardTitle}</p>
                        <p className="text-foreground-muted">{offer.buyerHandle}</p>
                        <p className="text-foreground-muted">Listed {formatCurrency(offer.listedPrice)}</p>
                        <p className="font-semibold text-available">
                          Agreed {formatCurrency(offer.agreedAmount ?? offer.offeredAmount)}
                        </p>
                      </div>
                      <div className="p-3 pt-0">
                        {/* No Accept/Counter here - already agreed. Decline retracts it before the buyer spends it via checkout. */}
                        <Button variant="danger" disabled={busy} onClick={() => run(offer.id, () => declineOffer(offer.id))} className="w-full px-2 py-1.5 text-xs">
                          Decline / Retract
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
      <>
      {pendingOffers.length > 0 && (
        <div className="space-y-3">
          {acceptedOffers.length > 0 && (
            <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Needs Your Response</h2>
          )}
          {pendingOffers.map((offer) => {
            const busy = pending && busyId === offer.id;
            const isCountering = counteringId === offer.id;
            return (
              <div key={offer.id} className="rounded-2xl border border-card-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{offer.cardTitle}</p>
                    <p className="text-sm text-foreground-muted">
                      Listed {formatCurrency(offer.listedPrice)} • Offered{" "}
                      <span className="font-semibold text-gold">{formatCurrency(offer.offeredAmount)}</span> •{" "}
                      {offer.buyerHandle} • <span className="text-pending">{timeLeftLabel(offer.createdAt)}</span>
                    </p>
                    {offer.note && <p className="mt-1 text-sm italic text-foreground-muted">&ldquo;{offer.note}&rdquo;</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" disabled={busy} onClick={() => run(offer.id, () => acceptOffer(offer.id))}>
                      Accept Offer
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => setCounteringId(isCountering ? null : offer.id)}
                    >
                      Counter
                    </Button>
                    <Button variant="danger" disabled={busy} onClick={() => run(offer.id, () => declineOffer(offer.id))}>
                      Decline
                    </Button>
                  </div>
                </div>

                {isCountering && (
                  <div className="mt-3 flex items-center gap-2">
                    <Input
                      type="number"
                      placeholder="Counter amount"
                      value={counterValue}
                      onChange={(e) => setCounterValue(e.target.value)}
                      className="max-w-[160px]"
                    />
                    <Button
                      variant="gold"
                      disabled={busy || !counterValue}
                      onClick={() => run(offer.id, () => counterOffer(offer.id, Number(counterValue)))}
                    >
                      Send Counter
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {acceptedOffers.length > 0 && (
        <div className="space-y-3">
          {pendingOffers.length > 0 && (
            <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              Accepted — Awaiting Buyer Checkout
            </h2>
          )}
          {acceptedOffers.map((offer) => {
            const busy = pending && busyId === offer.id;
            return (
              <div key={offer.id} className="rounded-2xl border border-card-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{offer.cardTitle}</p>
                    <p className="text-sm text-foreground-muted">
                      Listed {formatCurrency(offer.listedPrice)} • Agreed{" "}
                      <span className="font-semibold text-available">
                        {formatCurrency(offer.agreedAmount ?? offer.offeredAmount)}
                      </span>{" "}
                      • {offer.buyerHandle}
                    </p>
                  </div>
                  {/* No Accept/Counter here - already agreed. Decline retracts it before the buyer spends it via checkout; nothing to unwind since no claim exists until then. */}
                  <Button variant="danger" disabled={busy} onClick={() => run(offer.id, () => declineOffer(offer.id))}>
                    Decline / Retract
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </>
      )}
    </div>
  );
}
