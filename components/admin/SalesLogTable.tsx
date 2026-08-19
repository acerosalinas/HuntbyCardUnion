"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatCurrency } from "@/lib/utils";
import { CardItem } from "@/types/marketplace";
import { setShipped } from "@/app/admin/actions";

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SalesLogTable({ cards }: { cards: CardItem[] }) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleToggleShipped = (card: CardItem) => {
    setError(null);
    setBusyId(card.id);
    startTransition(async () => {
      try {
        await setShipped(card.id, !card.shipped);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update");
      } finally {
        setBusyId(null);
      }
    });
  };

  if (cards.length === 0) {
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
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Shipped / Delivered</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => (
              <tr key={card.id} className="border-t border-card-border">
                <td className="px-4 py-3 text-foreground-muted">
                  {card.soldAt ? formatDateTime(card.soldAt) : "—"}
                </td>
                <td className="px-4 py-3 font-medium">{card.title}</td>
                <td className="px-4 py-3">
                  {card.orderId ? (
                    <Badge tone="neutral" title={card.orderId}>
                      Order #{card.orderId.slice(0, 8)}
                    </Badge>
                  ) : (
                    <span className="text-foreground-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-foreground-muted">{card.currentClaimant ?? "—"}</td>
                <td className="px-4 py-3">{formatCurrency(card.price)}</td>
                <td className="px-4 py-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={card.shipped}
                      disabled={pending && busyId === card.id}
                      onChange={() => handleToggleShipped(card)}
                      className="h-4 w-4 rounded border-card-border accent-gold"
                    />
                    <span className="text-foreground-muted">{card.shipped ? "Shipped" : "Not shipped"}</span>
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
