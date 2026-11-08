"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { cn, formatCurrency } from "@/lib/utils";
import { CustomerTotals } from "@/lib/tracker/money";
import { ISLAND_GROUP_LABELS, IslandGroup } from "@/lib/tracker/regions";

export interface CustomerRow {
  id: string;
  name: string;
  islandGroup: IslandGroup | null;
  totals: CustomerTotals;
  /** Pay-now marketplace orders this customer (when linked to an account) has not paid yet. */
  marketUnpaid: number;
  lastPaymentOn: string | null;
  /** How much of their cards is paid so far (money matched to cards, not shipping fees). */
  cardsPaid: number;
}

type Filter = "OUTSTANDING" | "TO_SHIP" | "ALL";

/** What a customer owes across both ledgers: the live balance (a credit is not netted) plus their unpaid pay-now marketplace orders. */
const owed = (r: CustomerRow) => Math.max(0, r.totals.balance) + r.marketUnpaid;

export function CustomersView({ rows }: { rows: CustomerRow[] }) {
  const [filter, setFilter] = useState<Filter>("OUTSTANDING");
  const [query, setQuery] = useState("");

  const summary = useMemo(
    () => ({
      sold: rows.reduce((s, r) => s + r.totals.cardsTotal, 0),
      collected: rows.reduce((s, r) => s + r.totals.cardsPaid, 0),
      outstanding: rows.reduce((s, r) => s + owed(r), 0),
      owing: rows.filter((r) => owed(r) > 0).length,
      toShip: rows.reduce((s, r) => s + r.totals.awaitingShipCount, 0),
    }),
    [rows],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => (q ? r.name.toLowerCase().includes(q) : true))
      .filter((r) => {
        if (filter === "OUTSTANDING") return owed(r) > 0;
        if (filter === "TO_SHIP") return r.totals.awaitingShipCount > 0;
        return true;
      })
      .sort((a, b) => (filter === "ALL" ? a.name.localeCompare(b.name) : owed(b) - owed(a)));
  }, [rows, filter, query]);

  const cards = [
    { label: "Total Sold", value: formatCurrency(summary.sold) },
    { label: "Collected", value: formatCurrency(summary.collected) },
    { label: "Outstanding", value: formatCurrency(summary.outstanding), hint: `${summary.owing} customer${summary.owing === 1 ? "" : "s"}` },
    { label: "Cards To Ship", value: String(summary.toShip) },
  ];

  const filters: { id: Filter; label: string }[] = [
    { id: "OUTSTANDING", label: "Outstanding" },
    { id: "TO_SHIP", label: "To ship" },
    { id: "ALL", label: "All customers" },
  ];

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Customers and balances</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-card-border bg-card p-4">
            <span className="text-xs font-medium uppercase tracking-wide text-foreground-muted">{c.label}</span>
            <div className="mt-1 text-2xl font-bold">{c.value}</div>
            {c.hint && <span className="text-xs text-foreground-muted">{c.hint}</span>}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                filter === f.id ? "border-gold bg-gold/10" : "border-card-border text-foreground-muted hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted" />
          <Input className="pl-8" placeholder="Search customer" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-card-border py-12 text-center text-sm text-foreground-muted">
          {rows.length === 0
            ? "No customers yet - they're added automatically when you enter a sale."
            : filter === "OUTSTANDING"
              ? "Nobody owes you anything right now."
              : "No customers match."}
        </p>
      ) : (
        <>
        <ul className="divide-y divide-card-border overflow-hidden rounded-2xl border border-card-border bg-card md:hidden">
          {visible.map((r) => {
            const pct = r.totals.cardsTotal > 0 ? Math.min(100, Math.round((r.cardsPaid / r.totals.cardsTotal) * 100)) : 0;
            return (
              <li key={r.id}>
                <Link href={`/tracker/customers/${r.id}`} className="block px-4 py-3 active:bg-foreground/5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-medium">
                      {r.name}
                      {r.islandGroup && <span className="ml-2 text-xs font-normal text-foreground-muted">{ISLAND_GROUP_LABELS[r.islandGroup]}</span>}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-lg font-bold tabular-nums",
                        r.totals.balance > 0 ? "text-pending" : r.totals.balance < 0 ? "text-available" : "text-foreground-muted",
                      )}
                    >
                      {r.totals.balance < 0 ? `${formatCurrency(-r.totals.balance)} credit` : formatCurrency(r.totals.balance)}
                    </span>
                  </div>
                  {r.totals.shippingBalance > 0 && <p className="mt-1 text-xs text-foreground-muted">+ {formatCurrency(r.totals.shippingBalance)} shipping fee, kept out of the balance</p>}
                  {r.marketUnpaid > 0 && <p className="mt-1 text-xs text-pending">+ {formatCurrency(r.marketUnpaid)} on the marketplace · {formatCurrency(owed(r))} in all</p>}
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-foreground-muted">
                    <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-foreground/10">
                      <div className={cn("h-full rounded-full", pct >= 100 ? "bg-available" : "bg-gold")} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="tabular-nums">
                      {formatCurrency(r.totals.cardsPaid)} paid of {formatCurrency(r.totals.cardsTotal)}
                    </span>
                  </div>
                  {(r.totals.awaitingShipCount > 0 || r.totals.toDistributeCount > 0 || r.totals.shippedCount > 0 || r.totals.prepaidShippingCredit > 0) && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.totals.awaitingShipCount > 0 && <Badge tone="pending">{r.totals.awaitingShipCount} to ship</Badge>}
                      {r.totals.toDistributeCount > 0 && <Badge tone="pending">{r.totals.toDistributeCount} to hand over</Badge>}
                      {r.totals.shippedCount > 0 && <Badge tone="available">{r.totals.shippedCount} shipped</Badge>}
                      {r.totals.prepaidShippingCredit > 0 && <Badge tone="gold">{formatCurrency(r.totals.prepaidShippingCredit)} prepaid</Badge>}
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="hidden overflow-x-auto rounded-2xl border border-card-border bg-card md:block">
          <table className="w-full min-w-160 text-sm">
            <thead>
              <tr className="border-b border-card-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th scope="col" className="px-4 py-3">Customer</th>
                <th scope="col" className="px-4 py-3 text-right">Total</th>
                <th scope="col" className="px-4 py-3 text-right">Paid</th>
                <th scope="col" className="px-4 py-3 text-right">Balance</th>
                <th scope="col" className="px-4 py-3">Paid progress</th>
                <th scope="col" className="px-4 py-3">Last payment</th>
                <th scope="col" className="px-4 py-3">Shipping</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {visible.map((r) => (
                <tr key={r.id} className="hover:bg-foreground/5">
                  <td className="px-4 py-3">
                    <Link href={`/tracker/customers/${r.id}`} className="font-medium hover:text-gold">
                      {r.name}
                    </Link>
                    {r.islandGroup && <span className="ml-2 text-xs text-foreground-muted">{ISLAND_GROUP_LABELS[r.islandGroup]}</span>}
                  </td>
                  <td className="px-4 py-3 text-right">{formatCurrency(r.totals.cardsTotal)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(r.totals.cardsPaid)}</td>
                  <td
                    className={cn(
                      "px-4 py-3 text-right font-semibold",
                      r.totals.balance > 0 ? "text-pending" : r.totals.balance < 0 ? "text-available" : "text-foreground-muted",
                    )}
                  >
                    {r.totals.balance < 0 ? `${formatCurrency(-r.totals.balance)} credit` : formatCurrency(r.totals.balance)}
                    {r.marketUnpaid > 0 && <span className="block text-xs font-normal text-pending">+ {formatCurrency(r.marketUnpaid)} marketplace</span>}
                    {r.totals.shippingBalance > 0 && <span className="block text-xs font-normal text-foreground-muted">+ {formatCurrency(r.totals.shippingBalance)} shipping fee</span>}
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const pct = r.totals.cardsTotal > 0 ? Math.min(100, Math.round((r.cardsPaid / r.totals.cardsTotal) * 100)) : 0;
                      return (
                        <div className="w-28" title={`${formatCurrency(r.cardsPaid)} of ${formatCurrency(r.totals.cardsTotal)} paid`}>
                          <div className="h-2 overflow-hidden rounded-full bg-foreground/10">
                            <div className={cn("h-full rounded-full", pct >= 100 ? "bg-available" : "bg-gold")} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-foreground-muted">{pct}% paid</span>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">{r.lastPaymentOn ?? "Never"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {r.totals.awaitingShipCount > 0 && <Badge tone="pending">{r.totals.awaitingShipCount} to ship</Badge>}
                      {r.totals.toDistributeCount > 0 && <Badge tone="pending">{r.totals.toDistributeCount} to hand over</Badge>}
                      {r.totals.shippedCount > 0 && <Badge tone="available">{r.totals.shippedCount} shipped</Badge>}
                      {r.totals.prepaidShippingCredit > 0 && <Badge tone="gold">{formatCurrency(r.totals.prepaidShippingCredit)} prepaid</Badge>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
