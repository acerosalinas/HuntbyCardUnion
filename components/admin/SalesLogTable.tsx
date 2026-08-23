"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatCurrency } from "@/lib/utils";
import { setShipped } from "@/app/admin/actions";

/** One SOLD card_claims row joined to its card - one row per buyer-purchase, not per card. */
export interface SoldClaimView {
  id: string;
  cardId: string;
  cardTitle: string;
  buyerHandle: string;
  orderId: string | null;
  quantity: number;
  unitPrice: number;
  confirmedAt: number | null;
  shipped: boolean;
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SalesLogTable({ claims }: { claims: SoldClaimView[] }) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleToggleShipped = (claim: SoldClaimView) => {
    setError(null);
    setBusyId(claim.id);
    startTransition(async () => {
      try {
        await setShipped(claim.id, !claim.shipped);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update");
      } finally {
        setBusyId(null);
      }
    });
  };

  if (claims.length === 0) {
    return <p className="py-10 text-center text-sm text-foreground-muted">No sales yet.</p>;
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-sold">{error}</p>}
      <div className="overflow-x-auto rounded-2xl border border-card-border">
        <table className="w-full min-w-180 text-left text-sm">
          <thead className="bg-card text-xs uppercase tracking-wide text-foreground-muted">
            <tr>
              <th className="px-4 py-3">Date &amp; Time</th>
              <th className="px-4 py-3">Card</th>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Sold To</th>
              <th className="px-4 py-3">Qty</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Shipped / Delivered</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((claim) => (
              <tr key={claim.id} className="border-t border-card-border">
                <td className="px-4 py-3 text-foreground-muted">
                  {claim.confirmedAt ? formatDateTime(claim.confirmedAt) : "—"}
                </td>
                <td className="px-4 py-3 font-medium">{claim.cardTitle}</td>
                <td className="px-4 py-3">
                  {claim.orderId ? (
                    <Badge tone="neutral" title={claim.orderId}>
                      Order #{claim.orderId.slice(0, 8)}
                    </Badge>
                  ) : (
                    <span className="text-foreground-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-foreground-muted">{claim.buyerHandle}</td>
                <td className="px-4 py-3">{claim.quantity}</td>
                <td className="px-4 py-3">{formatCurrency(claim.unitPrice * claim.quantity)}</td>
                <td className="px-4 py-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={claim.shipped}
                      disabled={pending && busyId === claim.id}
                      onChange={() => handleToggleShipped(claim)}
                      className="h-4 w-4 rounded border-card-border accent-gold"
                    />
                    <span className="text-foreground-muted">{claim.shipped ? "Shipped" : "Not shipped"}</span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
