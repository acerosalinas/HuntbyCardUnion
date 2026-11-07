import Link from "next/link";
import { LayoutGrid, PhilippinePeso, Clock, HandCoins } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

interface Metrics {
  activeListings: number;
  totalSalesValue: number;
  pendingPayments: number;
  openOffers: number;
}

export function MetricCards({ metrics }: { metrics: Metrics }) {
  // Each card jumps to the screen that explains its number. The two that are
  // waiting on the admin (payments to confirm, offers to answer) get a gold
  // marker while the count is above zero so they read as "needs you".
  const items = [
    { label: "Active Listings", value: metrics.activeListings.toString(), icon: LayoutGrid, href: "/admin/inventory", needsAction: false },
    { label: "Total Sales Value", value: formatCurrency(metrics.totalSalesValue), icon: PhilippinePeso, href: "/admin/logs", needsAction: false },
    { label: "Pending Payments", value: metrics.pendingPayments.toString(), icon: Clock, href: "/admin", needsAction: metrics.pendingPayments > 0 },
    { label: "Open Offers", value: metrics.openOffers.toString(), icon: HandCoins, href: "/admin/offers", needsAction: metrics.openOffers > 0 },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
      {items.map(({ label, value, icon: Icon, href, needsAction }) => (
        <Link
          key={label}
          href={href}
          className={cn(
            "group rounded-2xl border bg-card p-3 transition-colors hover:border-gold/50 sm:p-4",
            needsAction ? "border-gold/40" : "border-card-border",
          )}
        >
          <div className="mb-1 flex items-center justify-between gap-2 sm:mb-2">
            <span className="text-xs font-medium text-foreground-muted">{label}</span>
            <span className="relative flex shrink-0 items-center">
              <Icon size={16} className="text-gold" aria-hidden="true" />
              {needsAction && (
                <span
                  className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-gold ring-2 ring-card"
                  title="Needs your attention"
                />
              )}
            </span>
          </div>
          <span className="text-xl font-bold tabular-nums text-foreground sm:text-2xl">{value}</span>
        </Link>
      ))}
    </div>
  );
}
