"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { setProofDistributed } from "@/app/tracker/paymentActions";
import { dayLabel, groupByDay } from "@/lib/tracker/proofDays";
import { ownerColor } from "@/lib/tracker/ownerColors";
import type { OwnerLabel } from "@/lib/tracker/split";
import { cn, formatCurrency } from "@/lib/utils";

/** A confirmed customer payment, and the cards it paid for (grouped by owner below). */
export interface DistributionItem {
  id: string;
  customerId: string;
  customerName: string;
  buyerHandle: string;
  method: "GCASH" | "MARIBANK";
  cardsAmount: number;
  sfAmount: number;
  note: string | null;
  createdAt: string;
  /** yyyy-mm-dd the customer paid. */
  day: string;
  /** When this payment's money was split between the owners, or null while it is still waiting. */
  distributedAt: string | null;
  /** Short-lived signed link to the private screenshot. */
  proofUrl: string | null;
  cards: { name: string; amount: number; liveTitle: string; owner: string }[];
}

type Stat = { received: number; distributed: number };

/** Groups a payment's cards by who owns them, keeping first-seen order. */
function groupByOwner(cards: DistributionItem["cards"]) {
  const groups = new Map<string, { owner: string; cards: DistributionItem["cards"]; total: number }>();
  for (const c of cards) {
    const g = groups.get(c.owner) ?? { owner: c.owner, cards: [], total: 0 };
    g.cards.push(c);
    g.total += c.amount;
    groups.set(c.owner, g);
  }
  return [...groups.values()];
}

/** Payment distribution: for each day customers paid, how much of every owner's share is still to hand out, and the payments behind it. */
export function DistributionView({ items, ownerLabels }: { items: DistributionItem[]; ownerLabels: OwnerLabel[] }) {
  const [tab, setTab] = useState<"TO_DISTRIBUTE" | "DISTRIBUTED">("TO_DISTRIBUTE");
  const toDistribute = items.filter((i) => !i.distributedAt);
  const distributed = items.filter((i) => i.distributedAt);
  const shown = tab === "TO_DISTRIBUTE" ? toDistribute : distributed;

  // One divider per day, newest first, then the payments of that day newest first.
  const days = groupByDay(
    [...shown]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((item) => ({
        date: item.day,
        total: item.cardsAmount + item.sfAmount,
        person: item.customerName,
        owners: groupByOwner(item.cards).map((g) => ({ name: g.owner, amount: g.total })),
        item,
      })),
  );

  // Per day and per owner: what was received and how much of it has been handed out, over every payment of the day
  // (whichever tab is open), so a day reads the same on both tabs.
  const ownerStats = new Map<string, Map<string, Stat>>();
  for (const item of items) {
    const day = ownerStats.get(item.day) ?? new Map<string, Stat>();
    for (const g of groupByOwner(item.cards)) {
      const stat = day.get(g.owner) ?? { received: 0, distributed: 0 };
      stat.received += g.total;
      if (item.distributedAt) stat.distributed += g.total;
      day.set(g.owner, stat);
    }
    ownerStats.set(item.day, day);
  }
  const ownerOrder = (name: string) => {
    const i = ownerLabels.findIndex((o) => o.name === name);
    return i === -1 ? 999 : i;
  };

  const bar = (key: string, name: string, stat: Stat, fill: string, strong = false) => {
    const toGive = Math.round((stat.received - stat.distributed) * 100) / 100;
    const pct = stat.received > 0 ? Math.min(100, Math.round((stat.distributed / stat.received) * 100)) : 0;
    return (
      <li key={key}>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="font-semibold">{name}</span>
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
          aria-label={`${name} distributed`}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className={cn("overflow-hidden rounded-full bg-foreground/10", strong ? "h-3.5" : "h-2.5")}
        >
          <div className={cn("h-full rounded-full transition-all", fill)} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-0.5 text-xs text-foreground-muted">
          {formatCurrency(stat.distributed)} of {formatCurrency(stat.received)} given out
        </p>
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Payment distribution</h1>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["TO_DISTRIBUTE", "To distribute", toDistribute.length],
            ["DISTRIBUTED", "Distributed", distributed.length],
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
          {tab === "TO_DISTRIBUTE" ? "Every confirmed payment has been distributed." : "Nothing distributed yet."}
        </p>
      ) : (
        days.map((day) => {
          const stats = [...(ownerStats.get(day.date) ?? new Map<string, Stat>()).entries()].sort(([a], [b]) => ownerOrder(a) - ownerOrder(b) || a.localeCompare(b));
          const total = { received: stats.reduce((n, [, s]) => n + s.received, 0), distributed: stats.reduce((n, [, s]) => n + s.distributed, 0) };
          const allDone = total.received > 0 && total.distributed >= total.received;
          return (
            <div key={day.date} className="space-y-3">
              <div className="rounded-xl border border-card-border bg-background-elevated px-3 py-2.5 text-sm">
                <h2 className="font-semibold">{dayLabel(day.date)}</h2>
                <ul className="mt-2 grid gap-x-6 gap-y-3 sm:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
                  {stats.length > 1 && bar("total", "Total", total, allDone ? "bg-available" : "bg-gold", true)}
                  {stats.map(([owner, stat]) => {
                    const code = ownerLabels.find((o) => o.name === owner)?.code ?? null;
                    return bar(owner, owner, stat, ownerColor(code, ownerLabels)?.bar ?? "bg-gold");
                  })}
                </ul>
              </div>
              {day.items.map((item) => (
                <PaymentCard key={item.id} item={item} />
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}

function PaymentCard({ item }: { item: DistributionItem }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
            <img src={item.proofUrl} alt={`Payment proof from ${item.customerName}`} className="h-40 w-32 rounded-lg border border-card-border bg-white object-cover object-top" />
            <span className="mt-1 flex items-center justify-center gap-1 text-xs text-foreground-muted">
              <ExternalLink size={11} /> Open full size
            </span>
          </a>
        ) : (
          <div className="flex h-40 w-32 shrink-0 items-center justify-center rounded-lg border border-dashed border-card-border text-xs text-foreground-muted">Screenshot unavailable</div>
        )}

        <div className="min-w-0 flex-1 space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/tracker/customers/${item.customerId}`} className="text-base font-semibold hover:text-gold">
              {item.customerName}
            </Link>
            {item.buyerHandle && <span className="text-xs text-foreground-muted">@{item.buyerHandle.replace(/^@/, "")}</span>}
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
          {error && <p className="text-sm text-sold">{error}</p>}

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
        </div>
      </div>
    </section>
  );
}
