"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, ExternalLink, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { confirmClaim, rejectClaim, setProofDistributed } from "@/app/tracker/paymentActions";
import { MarketProofCard, MarketProofItem } from "@/components/tracker/MarketProofCard";
import { DayEntry, dayLabel, groupByDay } from "@/lib/tracker/proofDays";
import { ownerColor } from "@/lib/tracker/ownerColors";
import type { OwnerLabel } from "@/lib/tracker/split";
import { cn, extractErrorMessage, formatCurrency } from "@/lib/utils";

export interface ProofItem {
  id: string;
  status: "PENDING" | "CONFIRMED" | "REJECTED";
  customerId: string;
  customerName: string;
  buyerHandle: string;
  method: "GCASH" | "MARIBANK";
  cardsAmount: number;
  sfAmount: number;
  note: string | null;
  rejectReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  /** yyyy-mm-dd the customer paid: the payment date picked when it was confirmed, else the day it was sent or reviewed. */
  day: string;
  /** When the confirmed payment was split between the card owners, or null while it is still waiting. */
  distributedAt: string | null;
  /** Short-lived signed link to the private screenshot. */
  proofUrl: string | null;
  cards: { name: string; amount: number; liveTitle: string; owner: string }[];
}

/** Groups a proof's cards by who owns them, keeping first-seen order. */
function groupByOwner(cards: ProofItem["cards"]) {
  const groups = new Map<string, { owner: string; cards: ProofItem["cards"]; total: number }>();
  for (const c of cards) {
    const g = groups.get(c.owner) ?? { owner: c.owner, cards: [], total: 0 };
    g.cards.push(c);
    g.total += c.amount;
    groups.set(c.owner, g);
  }
  return [...groups.values()];
}

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Live Tracker proofs and marketplace payment screenshots in one inbox, newest first. */
export function ProofsView({ items, marketItems = [], ownerLabels = [] }: { items: ProofItem[]; marketItems?: MarketProofItem[]; ownerLabels?: OwnerLabel[] }) {
  type Tab = "PENDING" | "TO_DISTRIBUTE" | "DISTRIBUTED" | "REJECTED";
  const [tab, setTab] = useState<Tab>("PENDING");
  const pending = items.filter((i) => i.status === "PENDING");
  const toDistribute = items.filter((i) => i.status === "CONFIRMED" && !i.distributedAt);
  const distributed = items.filter((i) => i.status === "CONFIRMED" && i.distributedAt);
  const rejected = items.filter((i) => i.status === "REJECTED");
  const shown = { PENDING: pending, TO_DISTRIBUTE: toDistribute, DISTRIBUTED: distributed, REJECTED: rejected }[tab];
  // Marketplace screenshots only exist while they wait for review: confirming or rejecting one takes it off the list.
  const shownMarket = tab === "PENDING" ? marketItems : [];
  const toReview = pending.length + marketItems.length;
  // One divider per day the customers paid, with that day's total by card owner and by person; newest first inside each day.
  const entries: (DayEntry<{ at: string; node: React.ReactNode }>)[] = [
    ...shown.map((item) => ({
      date: item.day,
      total: item.cardsAmount + item.sfAmount,
      person: item.customerName,
      owners: groupByOwner(item.cards).map((g) => ({ name: g.owner, amount: g.total })),
      item: { at: item.createdAt, node: <ProofCard key={item.id} item={item} /> },
    })),
    ...shownMarket.map((item) => ({
      date: item.day,
      total: item.total,
      person: item.customerName ?? item.buyerHandle,
      owners: [],
      item: { at: item.uploadedAt, node: <MarketProofCard key={item.key} item={item} /> },
    })),
  ].sort((a, b) => b.item.at.localeCompare(a.item.at));
  const days = groupByDay(entries);

  // Per day and per owner: what was received on confirmed proofs and how much of it has already been handed out. Counted over every
  // confirmed proof, whichever tab is open, so a day reads the same on To distribute and on Distributed.
  const ownerStats = new Map<string, Map<string, { received: number; distributed: number }>>();
  for (const item of items) {
    if (item.status !== "CONFIRMED") continue;
    const day = ownerStats.get(item.day) ?? new Map<string, { received: number; distributed: number }>();
    for (const g of groupByOwner(item.cards)) {
      const stat = day.get(g.owner) ?? { received: 0, distributed: 0 };
      stat.received += g.total;
      if (item.distributedAt) stat.distributed += g.total;
      day.set(g.owner, stat);
    }
    ownerStats.set(item.day, day);
  }
  const showOwnerBars = tab === "TO_DISTRIBUTE" || tab === "DISTRIBUTED";
  const ownerOrder = (name: string) => {
    const i = ownerLabels.findIndex((o) => o.name === name);
    return i === -1 ? 999 : i;
  };

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Payment proofs</h1>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["PENDING", "To review", toReview],
            ["TO_DISTRIBUTE", "To distribute", toDistribute.length],
            ["DISTRIBUTED", "Distributed", distributed.length],
            ["REJECTED", "Rejected", rejected.length],
          ] as const
        ).map(([id, text, count]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
              tab === id ? "border-gold bg-gold/10" : "border-card-border text-foreground-muted hover:text-foreground",
            )}
          >
            {text} <span className="text-xs text-foreground-muted">{count}</span>
          </button>
        ))}
      </div>

      {days.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-card-border py-12 text-center text-sm text-foreground-muted">
          {
            {
              PENDING: "No payment proofs waiting for review.",
              TO_DISTRIBUTE: "Every confirmed payment has been distributed.",
              DISTRIBUTED: "Nothing distributed yet.",
              REJECTED: "No rejected proofs.",
            }[tab]
          }
        </p>
      ) : (
        days.map((day) => (
          <div key={day.date} className="space-y-3">
            <div className="rounded-xl border border-card-border bg-background-elevated px-3 py-2.5 text-sm">
              <h2 className="font-semibold">{dayLabel(day.date)}</h2>
              {showOwnerBars && (
                <ul className="mt-2 grid gap-x-6 gap-y-3 sm:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
                  {[...(ownerStats.get(day.date) ?? new Map<string, { received: number; distributed: number }>()).entries()]
                    .sort(([a], [b]) => ownerOrder(a) - ownerOrder(b) || a.localeCompare(b))
                    .map(([owner, stat]) => {
                      const toGive = Math.round((stat.received - stat.distributed) * 100) / 100;
                      const pct = stat.received > 0 ? Math.min(100, Math.round((stat.distributed / stat.received) * 100)) : 0;
                      const code = ownerLabels.find((o) => o.name === owner)?.code ?? null;
                      const color = ownerColor(code, ownerLabels);
                      return (
                        <li key={owner}>
                          <div className="mb-1 flex items-baseline justify-between gap-2">
                            <span className="font-semibold">{owner}</span>
                            {toGive > 0 ? (
                              <span className="text-xs text-foreground-muted">
                                to distribute <span className="text-sm font-bold text-pending">{formatCurrency(toGive)}</span>
                              </span>
                            ) : (
                              <span className="text-xs font-medium text-available">All distributed</span>
                            )}
                          </div>
                          <div
                            role="progressbar"
                            aria-label={`${owner} distributed`}
                            aria-valuenow={pct}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            className="h-2.5 overflow-hidden rounded-full bg-foreground/10"
                          >
                            <div className={cn("h-full rounded-full transition-all", color?.bar ?? "bg-gold")} style={{ width: `${pct}%` }} />
                          </div>
                          <p className="mt-0.5 text-xs text-foreground-muted">
                            {formatCurrency(stat.distributed)} of {formatCurrency(stat.received)} given out
                          </p>
                        </li>
                      );
                    })}
                </ul>
              )}
            </div>
            {day.items.map((entry) => entry.node)}
          </div>
        ))
      )}
    </div>
  );
}

function ProofCard({ item }: { item: ProofItem }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [paidOn, setPaidOn] = useState(todayLocal);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const run = (fn: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Something went wrong.");
      }
    });
  };

  const setDistributed = (distributed: boolean) => {
    setError(null);
    startTransition(async () => {
      const result = await setProofDistributed(item.id, distributed);
      if (result.error) setError(result.error);
    });
  };

  return (
    <section className="rounded-2xl border border-card-border bg-card p-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        {item.proofUrl ? (
          <a href={item.proofUrl} target="_blank" rel="noreferrer" className="shrink-0" title="Open the full screenshot">
            {/* eslint-disable-next-line @next/next/no-img-element -- private signed URL, not optimisable by next/image */}
            <img src={item.proofUrl} alt={`Payment proof from ${item.customerName}`} className="h-48 w-40 rounded-lg border border-card-border bg-white object-cover object-top" />
            <span className="mt-1 flex items-center justify-center gap-1 text-xs text-foreground-muted">
              <ExternalLink size={11} /> Open full size
            </span>
          </a>
        ) : (
          <div className="flex h-48 w-40 shrink-0 items-center justify-center rounded-lg border border-dashed border-card-border text-xs text-foreground-muted">Screenshot unavailable</div>
        )}

        <div className="min-w-0 flex-1 space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/tracker/customers/${item.customerId}`} className="text-base font-semibold hover:text-gold">
              {item.customerName}
            </Link>
            {item.buyerHandle && <span className="text-xs text-foreground-muted">@{item.buyerHandle.replace(/^@/, "")}</span>}
            {item.status === "CONFIRMED" && <Badge tone="available">Confirmed</Badge>}
            {item.status === "REJECTED" && <Badge tone="sold">Rejected</Badge>}
            <span className="ml-auto text-xs text-foreground-muted">{item.createdAt.slice(0, 16).replace("T", " ")}</span>
          </div>

          <p>
            <span className="text-lg font-bold">{formatCurrency(item.cardsAmount + item.sfAmount)}</span>{" "}
            <span className="text-foreground-muted">via {item.method === "GCASH" ? "GCash" : "Maribank"}</span>
            {item.sfAmount > 0 && (
              <span className="text-foreground-muted">
                {" "}
                · cards {formatCurrency(item.cardsAmount)} + shipping fee {formatCurrency(item.sfAmount)}
              </span>
            )}
          </p>

          {item.cards.length > 0 ? (
            <div className="space-y-2">
              {groupByOwner(item.cards).map((g) => (
                <div key={g.owner} className="overflow-hidden rounded-lg border border-card-border">
                  <div className="flex items-center justify-between gap-2 bg-gold/15 px-2.5 py-1 text-xs font-semibold">
                    <span>
                      {g.owner} <span className="font-normal text-foreground-muted">· {g.cards.length} {g.cards.length === 1 ? "card" : "cards"}</span>
                    </span>
                    <span>{formatCurrency(g.total)}</span>
                  </div>
                  <ul className="space-y-0.5 px-2.5 py-1.5 text-xs text-foreground-muted">
                    {g.cards.map((c, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="truncate">
                          {c.name} {c.liveTitle && <span className="opacity-70">· {c.liveTitle}</span>}
                        </span>
                        <span className="shrink-0">{formatCurrency(c.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-foreground-muted">No cards ticked (shipping fee only).</p>
          )}
          {item.note && <p className="rounded-lg bg-foreground/5 px-3 py-2 text-xs">&ldquo;{item.note}&rdquo;</p>}
          {item.status === "REJECTED" && item.rejectReason && <p className="text-xs text-sold">Reason given: {item.rejectReason}</p>}

          {item.status === "CONFIRMED" && (
            <div className="flex flex-wrap items-center gap-2 border-t border-card-border pt-3">
              {item.distributedAt ? (
                <>
                  <Badge tone="available">Distributed {item.distributedAt.slice(0, 10)}</Badge>
                  <Button variant="outline" type="button" disabled={pending} onClick={() => setDistributed(false)}>
                    Undo
                  </Button>
                </>
              ) : (
                <>
                  <Badge tone="pending">Not distributed yet</Badge>
                  <Button variant="gold" type="button" disabled={pending} onClick={() => setDistributed(true)}>
                    <Check size={14} /> Mark as distributed
                  </Button>
                </>
              )}
            </div>
          )}

          {error && <p className="text-sm text-sold">{error}</p>}

          {item.status === "PENDING" && (
            <div className="space-y-2 border-t border-card-border pt-3">
              {!rejecting ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="mb-1 block text-xs text-foreground-muted">Payment date</label>
                    <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
                  </div>
                  <Button variant="gold" type="button" disabled={pending} onClick={() => run(() => confirmClaim(item.id, paidOn))}>
                    <Check size={14} /> Confirm payment
                  </Button>
                  <Button variant="outline" type="button" disabled={pending} onClick={() => setRejecting(true)}>
                    <X size={14} /> Reject
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="block text-xs text-foreground-muted">Why? (the customer will see this)</label>
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Amount doesn't match the screenshot" maxLength={300} autoFocus />
                  <div className="flex gap-2">
                    <Button variant="danger" type="button" disabled={pending} onClick={() => run(() => rejectClaim(item.id, reason))}>
                      Reject proof
                    </Button>
                    <Button variant="outline" type="button" onClick={() => setRejecting(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
