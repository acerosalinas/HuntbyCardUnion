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
  lastPaymentOn: string | null;
}

type Filter = "OUTSTANDING" | "TO_SHIP" | "ALL";

export function CustomersView({ rows }: { rows: CustomerRow[] }) {
  const [filter, setFilter] = useState<Filter>("OUTSTANDING");
  const [query, setQuery] = useState("");

  const summary = useMemo(
    () => ({
      sold: rows.reduce((s, r) => s + r.totals.cardsTotal, 0),
      collected: rows.reduce((s, r) => s + r.totals.paid, 0),
      outstanding: rows.reduce((s, r) => s + Math.max(0, r.totals.balance), 0),
      owing: rows.filter((r) => r.totals.balance > 0).length,
      toShip: rows.reduce((s, r) => s + r.totals.awaitingShipCount, 0),
    }),
    [rows],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => (q ? r.name.toLowerCase().includes(q) : true))
      .filter((r) => {
        if (filter === "OUTSTANDING") return r.totals.balance > 0;
        if (filter === "TO_SHIP") return r.totals.awaitingShipCount > 0;
        return true;
      })
      .sort((a, b) => (filter === "ALL" ? a.name.localeCompare(b.name) : b.totals.balance - a.totals.balance));
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
        <div className="overflow-x-auto rounded-2xl border border-card-border bg-card">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-card-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3">Last payment</th>
                <th className="px-4 py-3">Shipping</th>
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
                  <td className="px-4 py-3 text-right">{formatCurrency(r.totals.cardsTotal + r.totals.shippingCharged)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(r.totals.paid)}</td>
                  <td
                    className={cn(
                      "px-4 py-3 text-right font-semibold",
                      r.totals.balance > 0 ? "text-pending" : r.totals.balance < 0 ? "text-available" : "text-foreground-muted",
                    )}
                  >
                    {r.totals.balance < 0 ? `${formatCurrency(-r.totals.balance)} credit` : formatCurrency(r.totals.balance)}
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">{r.lastPaymentOn ?? "Never"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {r.totals.awaitingShipCount > 0 && <Badge tone="pending">{r.totals.awaitingShipCount} to ship</Badge>}
                      {r.totals.shippedCount > 0 && <Badge tone="available">{r.totals.shippedCount} shipped</Badge>}
                      {r.totals.prepaidShippingCredit > 0 && <Badge tone="gold">{formatCurrency(r.totals.prepaidShippingCredit)} prepaid</Badge>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
