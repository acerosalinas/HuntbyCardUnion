"use client";

import { useMemo, useState, useTransition } from "react";
import { Award, CalendarDays, Store, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { extractErrorMessage, formatCurrency } from "@/lib/utils";
import { setShipped } from "@/app/admin/actions";

/** One SOLD card_claims row joined to its card - one row per buyer-purchase, not per card. */
export interface SoldClaimView {
  id: string;
  cardId: string;
  cardTitle: string;
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

  const sellers = useMemo(() => {
    const byId = new Map<string, string>();
    for (const c of claims) {
      if (c.sellerAdminId && !byId.has(c.sellerAdminId)) {
        byId.set(c.sellerAdminId, c.sellerName ?? "Unnamed seller");
      }
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [claims]);

  const filteredClaims = useMemo(() => {
    if (!isSuperAdmin || sellerFilter === ALL_SELLERS) return claims;
    const targetId = sellerFilter === MY_SALES ? currentAdminId : sellerFilter;
    return claims.filter((c) => c.sellerAdminId === targetId);
  }, [claims, isSuperAdmin, sellerFilter, currentAdminId]);

  const stats = useSalesStats(filteredClaims);

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

  if (claims.length === 0) {
    return <p className="py-10 text-center text-sm text-foreground-muted">No sales yet.</p>;
  }

  return (
    <div className="space-y-4">
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
      {filteredClaims.length === 0 ? (
        <p className="py-10 text-center text-sm text-foreground-muted">No sales match this filter.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-card-border">
          <table className="w-full min-w-180 text-left text-sm">
            <thead className="bg-card text-xs uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-4 py-3">Date &amp; Time</th>
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
              {filteredClaims.map((claim) => (
                <tr key={claim.id} className="border-t border-card-border">
                  <td className="px-4 py-3 text-foreground-muted">
                    {claim.confirmedAt ? formatDateTime(claim.confirmedAt) : "—"}
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
  );
}
