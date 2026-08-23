"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn, formatRelativeTime, formatCurrency, isStalePending } from "@/lib/utils";
import { confirmPaid, promoteNextInQueue, cancelRelist } from "@/app/admin/actions";
import { useNegotiatingCardIds } from "@/hooks/useNegotiatingCardIds";

/** One PENDING card_claims row joined to its card - a card can now have several of these at once, one per buyer. */
export interface PendingClaimView {
  id: string;
  cardId: string;
  cardTitle: string;
  buyerHandle: string;
  orderId: string | null;
  quantity: number;
  unitPrice: number;
  claimedAt: number;
}

export function PendingPaymentsTable({
  claims,
  queueCounts,
}: {
  claims: PendingClaimView[];
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

  if (claims.length === 0) {
    return <p className="py-10 text-center text-sm text-foreground-muted">No pending payments.</p>;
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-sold">{error}</p>}
      <div className="overflow-x-auto rounded-2xl border border-card-border">
        <table className="w-full min-w-200 text-left text-sm">
          <thead className="bg-card text-xs uppercase tracking-wide text-foreground-muted">
            <tr>
              <th className="px-4 py-3">Card</th>
              <th className="px-4 py-3">Buyer</th>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Qty</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Claimed</th>
              <th className="px-4 py-3">Queue</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((claim) => {
              const queueCount = queueCounts[claim.cardId] ?? 0;
              const busy = pending && busyId === claim.id;
              return (
                <tr key={claim.id} className="border-t border-card-border">
                  <td className="px-4 py-3 font-medium">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {claim.cardTitle}
                      {negotiatingCardIds.has(claim.cardId) && <Badge tone="gold">Negotiating</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">{claim.buyerHandle}</td>
                  <td className="px-4 py-3">
                    {claim.orderId ? (
                      <Badge tone="neutral" title={claim.orderId}>
                        Order #{claim.orderId.slice(0, 8)}
                      </Badge>
                    ) : (
                      <span className="text-foreground-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{claim.quantity}</td>
                  <td className="px-4 py-3">{formatCurrency(claim.unitPrice * claim.quantity)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        isStalePending(claim.claimedAt) ? "font-medium text-pending" : "text-foreground-muted",
                      )}
                      title={isStalePending(claim.claimedAt) ? "Claimed over 24 hours ago" : undefined}
                    >
                      {isStalePending(claim.claimedAt) && <AlertTriangle size={14} />}
                      {formatRelativeTime(claim.claimedAt)}
                    </span>
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
                        onClick={() => run(claim.id, () => confirmPaid(claim.id))}
                      >
                        Confirm Paid
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy || queueCount === 0}
                        onClick={() =>
                          run(claim.id, async () => {
                            await promoteNextInQueue(claim.cardId);
                          })
                        }
                      >
                        Next in Queue
                      </Button>
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() => run(claim.id, () => cancelRelist(claim.id))}
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
