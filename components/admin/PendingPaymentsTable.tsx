"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, ImageOff, LayoutGrid, List, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn, extractErrorMessage, formatRelativeTime, formatCurrency, isStalePending } from "@/lib/utils";
import { confirmPaid, promoteNextInQueue, cancelRelist } from "@/app/admin/actions";
import { useNegotiatingCardIds } from "@/hooks/useNegotiatingCardIds";

/** One PENDING card_claims row joined to its card - a card can now have several of these at once, one per buyer. */
export interface PendingClaimView {
  id: string;
  cardId: string;
  cardTitle: string;
  cardImage: string | null;
  buyerHandle: string;
  orderId: string | null;
  quantity: number;
  unitPrice: number;
  claimedAt: number;
}

type View = "list" | "tiles";

/** Every claim from one checkout (same order_id), or a single standalone claim with no order - a dibs-queue promotion never gets one (see promoteNextInQueue in app/admin/actions.ts), so each of those is its own one-card group. */
interface OrderGroup {
  key: string;
  orderId: string | null;
  buyerHandle: string;
  claims: PendingClaimView[];
  totalAmount: number;
  /** Min, not max/latest - every claim in one order is inserted in the same transaction (place_order), so this is effectively "when the order was placed." */
  earliestClaimedAt: number;
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
  // Defaults to tiles - a card's photo is the fastest way to tell claims on
  // similarly-named cards apart, which a text-only row couldn't do.
  const [view, setView] = useState<View>("tiles");

  // Grouped by order (or, absent one, treated as its own solo group) and
  // sorted most-recent-first - a buyer who orders several cards at once
  // otherwise scatters across the flat list with no visual link between
  // them, which is exactly what made tracking a multi-card order hard.
  const groups = useMemo<OrderGroup[]>(() => {
    const byKey = new Map<string, PendingClaimView[]>();
    for (const claim of claims) {
      const key = claim.orderId ?? `solo-${claim.id}`;
      const bucket = byKey.get(key);
      if (bucket) bucket.push(claim);
      else byKey.set(key, [claim]);
    }
    const result: OrderGroup[] = [...byKey.values()].map((groupClaims) => ({
      key: groupClaims[0].orderId ?? `solo-${groupClaims[0].id}`,
      orderId: groupClaims[0].orderId,
      buyerHandle: groupClaims[0].buyerHandle,
      claims: groupClaims,
      totalAmount: groupClaims.reduce((sum, c) => sum + c.unitPrice * c.quantity, 0),
      earliestClaimedAt: Math.min(...groupClaims.map((c) => c.claimedAt)),
    }));
    result.sort((a, b) => b.earliestClaimedAt - a.earliestClaimedAt);
    return result;
  }, [claims]);

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
      }
    });
  };

  if (claims.length === 0) {
    return <p className="py-10 text-center text-sm text-foreground-muted">No pending payments.</p>;
  }

  return (
    <div className="space-y-3">
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

      <div className="space-y-5">
        {groups.map((group) => (
          <div key={group.key} className="overflow-hidden rounded-2xl border border-card-border">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-card px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-foreground">{group.buyerHandle}</span>
                {group.orderId ? (
                  <Badge tone="neutral" title={group.orderId}>
                    Order #{group.orderId.slice(0, 8)}
                  </Badge>
                ) : (
                  <Badge tone="gold">Queue promotion</Badge>
                )}
                <span className="text-xs text-foreground-muted">
                  {group.claims.length} card{group.claims.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-foreground">{formatCurrency(group.totalAmount)}</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-xs",
                    isStalePending(group.earliestClaimedAt) ? "font-medium text-pending" : "text-foreground-muted",
                  )}
                  title={isStalePending(group.earliestClaimedAt) ? "Claimed over 24 hours ago" : undefined}
                >
                  {isStalePending(group.earliestClaimedAt) && <AlertTriangle size={12} />}
                  {formatRelativeTime(group.earliestClaimedAt)}
                </span>
              </div>
            </div>

            {view === "tiles" ? (
              <div className="grid grid-cols-2 gap-4 border-t border-card-border p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {group.claims.map((claim) => {
                  const queueCount = queueCounts[claim.cardId] ?? 0;
                  const busy = pending && busyId === claim.id;
                  return (
                    <div
                      key={claim.id}
                      className={cn(
                        "flex flex-col overflow-hidden rounded-2xl border bg-card",
                        busy ? "opacity-60" : "border-card-border",
                      )}
                    >
                      <div className="relative aspect-[3/4] w-full bg-navy-950/5">
                        {claim.cardImage ? (
                          // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URLs
                          <img src={claim.cardImage} alt={claim.cardTitle} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-foreground-muted">
                            <ImageOff size={24} />
                          </div>
                        )}
                        {negotiatingCardIds.has(claim.cardId) && (
                          <div className="absolute right-2 top-2">
                            <Badge tone="gold">Negotiating</Badge>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-1 flex-col gap-1 p-3 text-xs">
                        <p className="line-clamp-1 text-sm font-semibold text-foreground">{claim.cardTitle}</p>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="font-bold text-foreground">{formatCurrency(claim.unitPrice * claim.quantity)}</span>
                          <span className="text-foreground-muted">Qty {claim.quantity}</span>
                        </div>
                        {queueCount > 0 && (
                          <span className="inline-flex items-center gap-1 text-pending">
                            <Users size={12} />
                            {queueCount} waiting
                          </span>
                        )}
                      </div>

                      <div className="flex flex-col gap-1.5 p-3 pt-0">
                        <Button variant="primary" disabled={busy} onClick={() => run(claim.id, () => confirmPaid(claim.id))} className="px-2 py-1.5 text-xs">
                          Confirm Paid
                        </Button>
                        <div className="flex gap-1.5">
                          <Button
                            variant="outline"
                            disabled={busy || queueCount === 0}
                            onClick={() => run(claim.id, async () => { await promoteNextInQueue(claim.cardId); })}
                            className="flex-1 px-2 py-1.5 text-xs"
                          >
                            Next in Queue
                          </Button>
                          <Button
                            variant="danger"
                            disabled={busy}
                            onClick={() => run(claim.id, () => cancelRelist(claim.id))}
                            className="flex-1 px-2 py-1.5 text-xs"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="overflow-x-auto border-t border-card-border">
                <table className="w-full min-w-160 text-left text-sm">
                  <thead className="bg-card text-xs uppercase tracking-wide text-foreground-muted">
                    <tr>
                      <th className="px-4 py-3">Card</th>
                      <th className="px-4 py-3">Qty</th>
                      <th className="px-4 py-3">Price</th>
                      <th className="px-4 py-3">Queue</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.claims.map((claim) => {
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
                          <td className="px-4 py-3">{claim.quantity}</td>
                          <td className="px-4 py-3">{formatCurrency(claim.unitPrice * claim.quantity)}</td>
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
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
