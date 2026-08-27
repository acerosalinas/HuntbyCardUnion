"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatCurrency } from "@/lib/utils";
import { acceptOffer, counterOffer, declineOffer } from "@/app/admin/actions";

export interface OfferRowView {
  id: string;
  cardId: string;
  cardTitle: string;
  listedPrice: number;
  offeredAmount: number;
  buyerHandle: string;
  note: string | null;
  createdAt: number;
}

/** Rough "time left before expire_stale_offers auto-expires this" readout - see the pg_cron job in supabase/schema.sql (MIGRATION 14). */
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

  const run = (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    startTransition(async () => {
      try {
        await action();
      } finally {
        setBusyId(null);
        setCounteringId(null);
      }
    });
  };

  if (offers.length === 0) {
    return <p className="py-10 text-center text-sm text-foreground-muted">No open offers.</p>;
  }

  return (
    <div className="space-y-3">
      {offers.map((offer) => {
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
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => run(offer.id, () => acceptOffer(offer.id))}
                >
                  Accept Offer
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setCounteringId(isCountering ? null : offer.id)}>
                  Counter
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => run(offer.id, () => declineOffer(offer.id))}
                >
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
  );
}
