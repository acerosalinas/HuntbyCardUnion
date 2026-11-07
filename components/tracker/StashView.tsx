"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { StashCustomer } from "@/lib/tracker/stash";
import { cn, formatCurrency } from "@/lib/utils";

type Filter = "ALL" | "UNPAID" | "SHIP";
type Sort = "VALUE" | "OLDEST" | "UNPAID" | "NAME";

const heldLabel = (days: number) => (days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`);

/** Everything we hold for customers - Live Tracker cards not yet shipped or handed over, and marketplace orders stashed with us - one block per customer. */
export function StashView({ groups }: { groups: StashCustomer[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [sort, setSort] = useState<Sort>("VALUE");

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = groups.filter((g) => {
      if (filter === "UNPAID" && g.unpaid <= 0) return false;
      if (filter === "SHIP" && !g.items.some((i) => i.shipRequested)) return false;
      if (!needle) return true;
      return g.name.toLowerCase().includes(needle) || g.items.some((i) => i.name.toLowerCase().includes(needle));
    });
    const by: Record<Sort, (a: StashCustomer, b: StashCustomer) => number> = {
      VALUE: (a, b) => b.total - a.total,
      OLDEST: (a, b) => b.oldestDays - a.oldestDays,
      UNPAID: (a, b) => b.unpaid - a.unpaid,
      NAME: (a, b) => a.name.localeCompare(b.name),
    };
    return [...list].sort(by[sort]);
  }, [groups, query, filter, sort]);

  const totals = useMemo(
    () => ({
      customers: groups.length,
      cards: groups.reduce((n, g) => n + g.cardCount, 0),
      value: groups.reduce((n, g) => n + g.total, 0),
      unpaid: groups.reduce((n, g) => n + g.unpaid, 0),
    }),
    [groups],
  );

  const stat = (label: string, value: string, accent = false) => (
    <div className="rounded-2xl border border-card-border bg-card p-4">
      <span className="text-xs font-medium uppercase tracking-wide text-foreground-muted">{label}</span>
      <div className={cn("mt-1 text-2xl font-bold tabular-nums", accent && "text-pending")}>{value}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Stash: what we hold for customers</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stat("Customers with a stash", String(totals.customers))}
        {stat("Cards we hold", String(totals.cards))}
        {stat("Total value", formatCurrency(totals.value))}
        {stat("Still unpaid", formatCurrency(totals.unpaid), totals.unpaid > 0)}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["ALL", "Everyone"],
            ["UNPAID", "Has unpaid"],
            ["SHIP", "Wants shipping"],
          ] as const
        ).map(([id, text]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
              filter === id ? "border-gold bg-gold/10" : "border-card-border text-foreground-muted hover:text-foreground",
            )}
          >
            {text}
          </button>
        ))}
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted" aria-hidden="true" />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Customer or card" aria-label="Search the stash" className="pl-9" />
        </div>
        <label className="sr-only" htmlFor="stash-sort">
          Sort
        </label>
        <Select id="stash-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="w-auto">
          <option value="VALUE">Biggest stash</option>
          <option value="OLDEST">Held the longest</option>
          <option value="UNPAID">Most unpaid</option>
          <option value="NAME">Name A to Z</option>
        </Select>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-card-border py-12 text-center text-sm text-foreground-muted">
          {groups.length === 0 ? "Nothing is being held for customers right now." : "Nobody matches."}
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((g) => (
            <li key={g.key}>
              <details open={Boolean(query.trim())} className="group overflow-hidden rounded-2xl border border-card-border bg-card">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 marker:hidden hover:bg-foreground/5">
                  <span className="min-w-0">
                    <span className="font-semibold">{g.name}</span>
                    {!g.customerId && <span className="ml-2 text-xs text-foreground-muted">marketplace buyer</span>}
                    <span className="block text-xs text-foreground-muted">
                      {g.cardCount} card{g.cardCount === 1 ? "" : "s"} · oldest held {heldLabel(g.oldestDays)}
                    </span>
                  </span>
                  <span className="flex items-center gap-3 text-right">
                    <span className="text-lg font-bold tabular-nums">{formatCurrency(g.total)}</span>
                    {g.unpaid > 0 ? <Badge tone="pending">{formatCurrency(g.unpaid)} unpaid</Badge> : <Badge tone="available">Paid</Badge>}
                    <ChevronDown size={16} aria-hidden="true" className="text-foreground-muted transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                <div className="border-t border-card-border">
                  {g.customerId && (
                    <div className="flex justify-end px-4 pt-2">
                      <Link href={`/tracker/customers/${g.customerId}`} className="text-xs text-gold-ink hover:underline">
                        Open customer
                      </Link>
                    </div>
                  )}
                  <ul className="divide-y divide-card-border">
                    {g.items.map((i) => (
                      <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                        {i.image && (
                          // eslint-disable-next-line @next/next/no-img-element -- seller-supplied listing photo
                          <img src={i.image} alt="" loading="lazy" className="h-12 w-9 shrink-0 rounded border border-card-border object-cover" />
                        )}
                        <span className="min-w-32 flex-1">
                          <span className="block truncate font-medium">{i.name}</span>
                          <span className="block truncate text-xs text-foreground-muted">{i.origin}</span>
                        </span>
                        <span className="font-medium tabular-nums">{formatCurrency(i.amount)}</span>
                        {i.unpaid > 0 ? <Badge tone="pending">{formatCurrency(i.unpaid)} left</Badge> : <Badge tone="available">Paid</Badge>}
                        {i.shipRequested && <Badge tone="gold">Wants shipping</Badge>}
                        <span className="w-16 text-right text-xs text-foreground-muted">{heldLabel(i.heldDays)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
