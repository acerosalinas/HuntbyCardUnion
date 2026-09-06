"use client";

import { useMemo, useState, useTransition } from "react";
import { Award, CalendarDays, Download, ImageOff, LayoutGrid, List, Search, Store, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { cn, extractErrorMessage, formatCurrency } from "@/lib/utils";
import { downloadXlsx } from "@/lib/excelExport";
import { setShipped } from "@/app/admin/actions";

type View = "list" | "tiles";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** One SOLD card_claims row joined to its card - one row per buyer-purchase, not per card. */
export interface SoldClaimView {
  id: string;
  cardId: string;
  cardTitle: string;
  cardImage: string | null;
  buyerHandle: string;
  orderId: string | null;
  quantity: number;
  unitPrice: number;
  confirmedAt: number | null;
  shipped: boolean;
  /** Buyer-requested via requestShipping() (app/account/actions.ts) on a stashed claim - "please ship this now" instead of holding it. */
  shipRequestedAt: number | null;
  /** Only populated for a super admin (see app/admin/(dashboard)/logs/page.tsx) - a regular admin's log is already scoped to just themselves. */
  sellerAdminId: string | null;
  sellerName: string | null;
}

interface DateGroup {
  label: string;
  claims: SoldClaimView[];
  totalAmount: number;
}

const ALL_SELLERS = "ALL";
const MY_SALES = "MINE";

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Today" / "Yesterday" for the last two calendar days, an exact date otherwise - a running log reads better broken into day-sized chunks than as one undifferentiated wall of rows, but a bare "Sep 4" for something that happened an hour ago is needlessly vague. */
function dateGroupLabel(ms: number): string {
  const date = new Date(ms);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function useSalesStats(claims: SoldClaimView[]) {
  return useMemo(() => {
    const now = new Date();
    let totalRevenue = 0;
    let monthRevenue = 0;
    const unitsByTitle = new Map<string, number>();

    for (const claim of claims) {
      const revenue = claim.unitPrice * claim.quantity;
      totalRevenue += revenue;
      if (
        claim.confirmedAt &&
        new Date(claim.confirmedAt).getMonth() === now.getMonth() &&
        new Date(claim.confirmedAt).getFullYear() === now.getFullYear()
      ) {
        monthRevenue += revenue;
      }
      unitsByTitle.set(claim.cardTitle, (unitsByTitle.get(claim.cardTitle) ?? 0) + claim.quantity);
    }

    let bestSeller: { title: string; units: number } | null = null;
    for (const [title, units] of unitsByTitle) {
      if (!bestSeller || units > bestSeller.units) bestSeller = { title, units };
    }

    return { totalRevenue, monthRevenue, bestSeller };
  }, [claims]);
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-card-border bg-card p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-navy-950 text-gold">
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">{label}</p>
        <p className="truncate text-lg font-bold text-foreground">{value}</p>
        {detail && <p className="truncate text-xs text-foreground-muted">{detail}</p>}
      </div>
    </div>
  );
}

export function SalesLogTable({
  claims,
  isSuperAdmin,
  currentAdminId,
}: {
  claims: SoldClaimView[];
  isSuperAdmin: boolean;
  currentAdminId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sellerFilter, setSellerFilter] = useState<string>(ALL_SELLERS);
  const [view, setView] = useState<View>("list");
  const [search, setSearch] = useState("");

  const sellers = useMemo(() => {
    const byId = new Map<string, string>();
    for (const c of claims) {
      if (c.sellerAdminId && !byId.has(c.sellerAdminId)) {
        byId.set(c.sellerAdminId, c.sellerName ?? "Unnamed seller");
      }
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [claims]);

  // Seller filter only - the weekly export intentionally ignores the search
  // box below, since "Export This Week" promises a time range, not whatever
  // happens to be on screen.
  const filteredClaims = useMemo(() => {
    if (!isSuperAdmin || sellerFilter === ALL_SELLERS) return claims;
    const targetId = sellerFilter === MY_SALES ? currentAdminId : sellerFilter;
    return claims.filter((c) => c.sellerAdminId === targetId);
  }, [claims, isSuperAdmin, sellerFilter, currentAdminId]);

  const stats = useSalesStats(filteredClaims);

  const searchedClaims = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredClaims;
    return filteredClaims.filter(
      (c) => c.buyerHandle.toLowerCase().includes(q) || c.cardTitle.toLowerCase().includes(q),
    );
  }, [filteredClaims, search]);

  // A single pass, not a sort - filteredClaims already arrives newest-first
  // (see app/admin/(dashboard)/logs/page.tsx's query), so everything from
  // one calendar day is already contiguous; grouping just has to notice
  // when the label changes instead of re-deriving order from scratch.
  const dateGroups = useMemo<DateGroup[]>(() => {
    const groups: DateGroup[] = [];
    for (const claim of searchedClaims) {
      const label = claim.confirmedAt ? dateGroupLabel(claim.confirmedAt) : "Unknown date";
      const current = groups[groups.length - 1];
      if (current && current.label === label) {
        current.claims.push(claim);
        current.totalAmount += claim.unitPrice * claim.quantity;
      } else {
        groups.push({ label, claims: [claim], totalAmount: claim.unitPrice * claim.quantity });
      }
    }
    return groups;
  }, [searchedClaims]);

  const handleToggleShipped = (claim: SoldClaimView) => {
    setError(null);
    setBusyId(claim.id);
    startTransition(async () => {
      try {
        await setShipped(claim.id, !claim.shipped);
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Failed to update");
      } finally {
        setBusyId(null);
      }
    });
  };

  const handleExportWeek = () => {
    const cutoff = Date.now() - ONE_WEEK_MS;
    const weekClaims = filteredClaims.filter((c) => c.confirmedAt && c.confirmedAt >= cutoff);
    const headers = [
      "Date",
      "Card",
      ...(isSuperAdmin ? ["Seller"] : []),
      "Buyer",
      "Order",
      "Quantity",
      "Unit Price",
      "Total",
      "Shipped",
    ];
    const rows = weekClaims.map((c) => [
      c.confirmedAt ? formatDateTime(c.confirmedAt) : "",
      c.cardTitle,
      ...(isSuperAdmin ? [c.sellerName ?? ""] : []),
      c.buyerHandle,
      c.orderId ? `#${c.orderId.slice(0, 8)}` : "",
      c.quantity,
      c.unitPrice,
      c.unitPrice * c.quantity,
      c.shipped ? "Yes" : "No",
    ]);
    const today = new Date().toISOString().slice(0, 10);
    downloadXlsx(`card-union-sales-week-${today}.xlsx`, "Sales", headers, rows);
  };

  if (claims.length === 0) {
    return <p className="py-10 text-center text-sm text-foreground-muted">No sales yet.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {isSuperAdmin && (
            <div className="flex items-center gap-2">
              <Store size={14} className="text-foreground-muted" />
              <Select value={sellerFilter} onChange={(e) => setSellerFilter(e.target.value)} className="max-w-64">
                <option value={ALL_SELLERS}>All Sellers</option>
                <option value={MY_SALES}>My Sales Only</option>
                {sellers
                  .filter(([id]) => id !== currentAdminId)
                  .map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
              </Select>
            </div>
          )}
          <div className="relative w-full max-w-64">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search buyer or card..."
              className="pl-8"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportWeek} className="gap-1.5 px-3 py-1.5 text-sm">
            <Download size={14} />
            Export This Week
          </Button>
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
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={Wallet} label="Total Revenue" value={formatCurrency(stats.totalRevenue)} />
        <StatCard icon={CalendarDays} label="This Month" value={formatCurrency(stats.monthRevenue)} />
        <StatCard
          icon={Award}
          label="Best Seller"
          value={stats.bestSeller?.title ?? "—"}
          detail={stats.bestSeller ? `${stats.bestSeller.units} sold` : undefined}
        />
      </div>
      {error && <p className="text-sm text-sold">{error}</p>}
      {dateGroups.length === 0 ? (
        <p className="py-10 text-center text-sm text-foreground-muted">No sales match this filter.</p>
      ) : (
        <div className="space-y-5">
          {dateGroups.map((group) => (
            <div key={group.label} className="overflow-hidden rounded-2xl border border-card-border">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-card px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground">{group.label}</span>
                  <span className="text-xs text-foreground-muted">
                    {group.claims.length} sale{group.claims.length === 1 ? "" : "s"}
                  </span>
                </div>
                <span className="text-sm font-bold text-foreground">{formatCurrency(group.totalAmount)}</span>
              </div>

              {view === "tiles" ? (
                <div className="grid grid-cols-2 gap-4 border-t border-card-border p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {group.claims.map((claim) => (
                    <div key={claim.id} className="flex flex-col overflow-hidden rounded-2xl border border-card-border bg-card">
                      <div className="relative aspect-[3/4] w-full bg-navy-950/5">
                        {claim.cardImage ? (
                          // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URLs
                          <img src={claim.cardImage} alt={claim.cardTitle} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-foreground-muted">
                            <ImageOff size={24} />
                          </div>
                        )}
                        {!claim.shipped && claim.shipRequestedAt && (
                          <div className="absolute right-2 top-2">
                            <Badge tone="gold">Ship requested</Badge>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-1 p-3 text-xs">
                        <p className="line-clamp-1 text-sm font-semibold text-foreground">{claim.cardTitle}</p>
                        <p className="text-foreground-muted">{claim.confirmedAt ? formatTime(claim.confirmedAt) : "—"}</p>
                        {isSuperAdmin && (
                          <p className="text-foreground-muted">
                            {claim.sellerAdminId === currentAdminId ? <Badge tone="gold">You</Badge> : (claim.sellerName ?? "—")}
                          </p>
                        )}
                        <p className="text-foreground-muted">{claim.buyerHandle}</p>
                        {claim.orderId && (
                          <Badge tone="neutral" className="w-fit" title={claim.orderId}>
                            Order #{claim.orderId.slice(0, 8)}
                          </Badge>
                        )}
                        <div className="mt-1 flex items-center justify-between">
                          <span className="font-bold text-foreground">{formatCurrency(claim.unitPrice * claim.quantity)}</span>
                          <span className="text-foreground-muted">Qty {claim.quantity}</span>
                        </div>
                      </div>
                      <label className="flex items-center gap-2 border-t border-card-border p-3 text-xs">
                        <input
                          type="checkbox"
                          checked={claim.shipped}
                          disabled={pending && busyId === claim.id}
                          onChange={() => handleToggleShipped(claim)}
                          className="h-4 w-4 rounded border-card-border accent-gold"
                        />
                        <span className="text-foreground-muted">{claim.shipped ? "Shipped" : "Not shipped"}</span>
                      </label>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto border-t border-card-border">
                  <table className="w-full min-w-180 text-left text-sm">
                    <thead className="bg-card text-xs uppercase tracking-wide text-foreground-muted">
                      <tr>
                        <th className="px-4 py-3">Time</th>
                        <th className="px-4 py-3">Card</th>
                        {isSuperAdmin && <th className="px-4 py-3">Seller</th>}
                        <th className="px-4 py-3">Order</th>
                        <th className="px-4 py-3">Sold To</th>
                        <th className="px-4 py-3">Qty</th>
                        <th className="px-4 py-3">Price</th>
                        <th className="px-4 py-3">Shipped / Delivered</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.claims.map((claim) => (
                        <tr key={claim.id} className="border-t border-card-border">
                          <td className="px-4 py-3 text-foreground-muted">
                            {claim.confirmedAt ? formatTime(claim.confirmedAt) : "—"}
                          </td>
                          <td className="px-4 py-3 font-medium">{claim.cardTitle}</td>
                          {isSuperAdmin && (
                            <td className="px-4 py-3 text-foreground-muted">
                              {claim.sellerAdminId === currentAdminId ? (
                                <Badge tone="gold">You</Badge>
                              ) : (
                                (claim.sellerName ?? "—")
                              )}
                            </td>
                          )}
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
                            {!claim.shipped && claim.shipRequestedAt && (
                              <Badge tone="gold" className="mt-1">
                                Buyer requested shipping
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
