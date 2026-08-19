"use client";

import { useState, useTransition } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatRelativeTime, formatCurrency } from "@/lib/utils";
import { CardItem } from "@/types/marketplace";
import { confirmPaid, promoteNextInQueue, cancelRelist } from "@/app/admin/actions";
import { useNegotiatingCardIds } from "@/hooks/useNegotiatingCardIds";

export function PendingPaymentsTable({
  cards,
  queueCounts,
}: {
  cards: CardItem[];
  queueCounts: Record<string, number>;
}) {
  const negotiatingCardIds = useNegotiatingCardIds();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (id: string, action: () => Promise<void>) => {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      try {
        await action();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
      } finally {
        setBusyId(null);
      }
    });
  };

  if (cards.length === 0) {
    return <p className="py-10 text-center text-sm text-foreground-muted">No pending payments.</p>;
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-sold">{error}</p>}
      <div className="overflow-x-auto rounded-2xl border border-card-border">
        <table className="w-full min-w-180 text-left text-sm">
          <thead className="bg-card text-xs uppercase tracking-wide text-foreground-muted">
            <tr>
              <th className="px-4 py-3">Card</th>
              <th className="px-4 py-3">Buyer</th>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Claimed</th>
              <th className="px-4 py-3">Queue</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => {
              const queueCount = queueCounts[card.id] ?? 0;
              const busy = pending && busyId === card.id;
              return (
                <tr key={card.id} className="border-t border-card-border">
                  <td className="px-4 py-3 font-medium">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {card.title}
                      {negotiatingCardIds.has(card.id) && <Badge tone="gold">Negotiating</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">{card.currentClaimant}</td>
                  <td className="px-4 py-3">
                    {card.orderId ? (
                      <Badge tone="neutral" title={card.orderId}>
                        Order #{card.orderId.slice(0, 8)}
                      </Badge>
                    ) : (
                      <span className="text-foreground-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{formatCurrency(card.price)}</td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {card.claimedAt ? formatRelativeTime(card.claimedAt) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {queueCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-pending">
                        <Users size={14} />
                        {queueCount} waiting
                      </span>
                    ) : (
                      <span className="text-foreground-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={() => run(card.id, () => confirmPaid(card.id))}
                      >
                        Confirm Paid
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy || queueCount === 0}
                        onClick={() =>
                          run(card.id, async () => {
                            await promoteNextInQueue(card.id);
                          })
                        }
                      >
                        Next in Queue
                      </Button>
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() => run(card.id, () => cancelRelist(card.id))}
                      >
                        Cancel / Re-list
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
