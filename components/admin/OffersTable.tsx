"use client";

import { useMemo, useState, useTransition } from "react";
import { ImageOff, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { HoldCountdown } from "@/components/HoldCountdown";
import { cn, extractErrorMessage, formatCurrency, formatRelativeTime } from "@/lib/utils";
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
  /** When the hold (seller-configurable, see seller_profiles.offer_hold_hours) auto-expires this offer - null once it's been accepted (no expiry once accepted). See migration_offer_hold.sql / migration_offer_hold_per_seller.sql. */
  heldUntil: number | null;
}

/** Every offer from one buyer within a status section (PENDING or ACCEPTED, grouped separately - see groupByBuyer) - a buyer who made several offers tonight and more tomorrow otherwise scatters across the flat list with nothing tying them together. */
interface BuyerGroup {
  buyerHandle: string;
  offers: OfferRowView[];
  totalAmount: number;
  /** Max, not min - "most recent activity from this buyer," so the group sort surfaces whoever just did something over a buyer who's been sitting quiet. */
  latestCreatedAt: number;
}

/** Sorted most-recent-first, same grouping shape as PendingPaymentsTable. `amountFor` picks offeredAmount vs agreedAmount since those mean different things in the PENDING vs ACCEPTED sections. */
function groupByBuyer(offers: OfferRowView[], amountFor: (o: OfferRowView) => number): BuyerGroup[] {
  const byBuyer = new Map<string, OfferRowView[]>();
  for (const offer of offers) {
    const bucket = byBuyer.get(offer.buyerHandle);
    if (bucket) bucket.push(offer);
    else byBuyer.set(offer.buyerHandle, [offer]);
  }
  const groups: BuyerGroup[] = [...byBuyer.entries()].map(([buyerHandle, groupOffers]) => ({
    buyerHandle,
    offers: groupOffers,
    totalAmount: groupOffers.reduce((sum, o) => sum + amountFor(o), 0),
    latestCreatedAt: Math.max(...groupOffers.map((o) => o.createdAt)),
  }));
  groups.sort((a, b) => b.latestCreatedAt - a.latestCreatedAt);
  return groups;
}

/** One buyer's offers within a section - the group header (handle, count, total, "N ago") plus that group's own tile grid or list rows. `renderOffer` is given each offer in the group and returns its existing tile/row markup, so the two view modes below don't need their per-offer JSX duplicated here too. */
function BuyerGroupSection({
  group,
  view,
  renderOffer,
}: {
  group: BuyerGroup;
  view: View;
  renderOffer: (offer: OfferRowView) => React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-card-border">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-foreground">{group.buyerHandle}</span>
          <span className="text-xs text-foreground-muted">
            {group.offers.length} offer{group.offers.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-foreground">{formatCurrency(group.totalAmount)}</span>
          <span className="text-xs text-foreground-muted">{formatRelativeTime(group.latestCreatedAt)}</span>
        </div>
      </div>
      {view === "tiles" ? (
        <div className="grid grid-cols-2 gap-4 border-t border-card-border p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {group.offers.map(renderOffer)}
        </div>
      ) : (
        <div className="space-y-3 border-t border-card-border p-4">{group.offers.map(renderOffer)}</div>
      )}
    </div>
  );
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

  const pendingGroups = useMemo(
    () => groupByBuyer(offers.filter((o) => o.status === "PENDING"), (o) => o.offeredAmount),
    [offers],
  );
  const acceptedGroups = useMemo(
    () => groupByBuyer(offers.filter((o) => o.status === "ACCEPTED"), (o) => o.agreedAmount ?? o.offeredAmount),
    [offers],
  );

  if (offers.length === 0) {
    return <p className="py-10 text-center text-sm text-foreground-muted">No open offers.</p>;
  }

  const renderPendingTile = (offer: OfferRowView) => {
    const busy = pending && busyId === offer.id;
    const isCountering = counteringId === offer.id;
    return (
      <div key={offer.id} className="flex flex-col overflow-hidden rounded-2xl border border-card-border bg-card">
        <div className="relative aspect-3/4 w-full bg-navy-950/5">
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
          <p className="text-foreground-muted">Listed {formatCurrency(offer.listedPrice)}</p>
          <p className="font-semibold text-gold">Offered {formatCurrency(offer.offeredAmount)}</p>
          <HoldCountdown heldUntil={offer.heldUntil} />
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
  };

  const renderPendingRow = (offer: OfferRowView) => {
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
              <HoldCountdown heldUntil={offer.heldUntil} />
            </p>
            {offer.note && <p className="mt-1 text-sm italic text-foreground-muted">&ldquo;{offer.note}&rdquo;</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => run(offer.id, () => acceptOffer(offer.id))}>
              Accept Offer
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setCounteringId(isCountering ? null : offer.id)}>
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
              className="max-w-40"
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
  };

  const renderAcceptedTile = (offer: OfferRowView) => {
    const busy = pending && busyId === offer.id;
    return (
      <div key={offer.id} className="flex flex-col overflow-hidden rounded-2xl border border-card-border bg-card">
        <div className="relative aspect-3/4 w-full bg-navy-950/5">
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
          <p className="text-foreground-muted">Listed {formatCurrency(offer.listedPrice)}</p>
          <p className="font-semibold text-available">Agreed {formatCurrency(offer.agreedAmount ?? offer.offeredAmount)}</p>
        </div>
        <div className="p-3 pt-0">
          {/* No Accept/Counter here - already agreed. Decline retracts it before the buyer spends it via checkout. */}
          <Button variant="danger" disabled={busy} onClick={() => run(offer.id, () => declineOffer(offer.id))} className="w-full px-2 py-1.5 text-xs">
            Decline / Retract
          </Button>
        </div>
      </div>
    );
  };

  const renderAcceptedRow = (offer: OfferRowView) => {
    const busy = pending && busyId === offer.id;
    return (
      <div key={offer.id} className="rounded-2xl border border-card-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{offer.cardTitle}</p>
            <p className="text-sm text-foreground-muted">
              Listed {formatCurrency(offer.listedPrice)} • Agreed{" "}
              <span className="font-semibold text-available">{formatCurrency(offer.agreedAmount ?? offer.offeredAmount)}</span>
            </p>
          </div>
          {/* No Accept/Counter here - already agreed. Decline retracts it before the buyer spends it via checkout; nothing to unwind since no claim exists until then. */}
          <Button variant="danger" disabled={busy} onClick={() => run(offer.id, () => declineOffer(offer.id))}>
            Decline / Retract
          </Button>
        </div>
      </div>
    );
  };

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

      {pendingGroups.length > 0 && (
        <div className="space-y-3">
          {acceptedGroups.length > 0 && (
            <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Needs Your Response</h2>
          )}
          <div className="space-y-5">
            {pendingGroups.map((group) => (
              <BuyerGroupSection
                key={group.buyerHandle}
                group={group}
                view={view}
                renderOffer={view === "tiles" ? renderPendingTile : renderPendingRow}
              />
            ))}
          </div>
        </div>
      )}

      {acceptedGroups.length > 0 && (
        <div className="space-y-3">
          {pendingGroups.length > 0 && (
            <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              Accepted — Awaiting Buyer Checkout
            </h2>
          )}
          <div className="space-y-5">
            {acceptedGroups.map((group) => (
              <BuyerGroupSection
                key={group.buyerHandle}
                group={group}
                view={view}
                renderOffer={view === "tiles" ? renderAcceptedTile : renderAcceptedRow}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
