import { LayoutGrid, DollarSign, Clock, HandCoins } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface Metrics {
  activeListings: number;
  totalSalesValue: number;
  pendingPayments: number;
  openOffers: number;
}

export function MetricCards({ metrics }: { metrics: Metrics }) {
  const items = [
    { label: "Active Listings", value: metrics.activeListings.toString(), icon: LayoutGrid },
    { label: "Total Sales Value", value: formatCurrency(metrics.totalSalesValue), icon: DollarSign },
    { label: "Pending Payments", value: metrics.pendingPayments.toString(), icon: Clock },
    { label: "Open Offers", value: metrics.openOffers.toString(), icon: HandCoins },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map(({ label, value, icon: Icon }) => (
        <div key={label} className="rounded-2xl border border-card-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
              {label}
            </span>
            <Icon size={16} className="text-gold" />
          </div>
          <span className="text-2xl font-bold text-foreground">{value}</span>
        </div>
      ))}
    </div>
  );
}
