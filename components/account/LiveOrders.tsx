import { Truck, Package } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { PortalCustomer } from "@/lib/tracker/portal";
import { cn, formatCurrency } from "@/lib/utils";

/** The customer's own live orders: balance, a progress line, how to pay, and one table per live. Read-only. */
export function LiveOrders({ customer }: { customer: PortalCustomer }) {
  const { view } = customer;
  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-card-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">{customer.customerName}</h2>
          {view.amountDue > 0 ? (
            <span className="text-sm text-foreground-muted">
              You owe <span className="text-xl font-bold text-pending">{formatCurrency(view.amountDue)}</span>
            </span>
          ) : (
            <Badge tone="available">All paid</Badge>
          )}
        </div>
        <div className="mb-1 flex items-baseline justify-between text-xs text-foreground-muted">
          <span>Paid so far</span>
          <span>
            <span className="font-semibold text-foreground">{formatCurrency(view.cardsPaid)}</span> of {formatCurrency(view.cardsTotal)} · {view.progressPct}%
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={view.progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Paid so far"
          className="h-3 overflow-hidden rounded-full bg-foreground/10"
        >
          <div className={cn("h-full rounded-full transition-all", view.progressPct >= 100 ? "bg-available" : "bg-gold")} style={{ width: `${view.progressPct}%` }} />
        </div>
        {view.shippingUnpaid > 0 && (
          <p className="mt-2 text-xs text-foreground-muted">
            Includes <span className="font-semibold text-foreground">{formatCurrency(view.shippingUnpaid)}</span> shipping fee for parcels already sent.
          </p>
        )}
        <p className="mt-2 text-xs text-foreground-muted">The line moves once the seller confirms your payment.</p>
      </div>

      {view.amountDue > 0 && (customer.qr.length > 0 || customer.paymentInstructions.trim()) && (
        <div className="rounded-2xl border border-card-border bg-card p-4">
          <h3 className="mb-2 font-semibold">How to pay</h3>
          {customer.paymentInstructions.trim() && <p className="mb-3 whitespace-pre-line text-sm text-foreground-muted">{customer.paymentInstructions.trim()}</p>}
          {customer.qr.length > 0 && (
            <div className="flex flex-wrap gap-4">
              {customer.qr.map((q) => (
                <figure key={q.label} className="text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element -- seller-uploaded QR from the public image bucket */}
                  <img src={q.url} alt={`${q.label} QR code`} className="h-40 w-40 rounded-lg bg-white object-contain" />
                  <figcaption className="mt-1 text-xs text-foreground-muted">{q.label}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>
      )}

      {view.lives.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-card-border py-10 text-center text-sm text-foreground-muted">No live orders yet.</p>
      ) : (
        view.lives.map((live) => (
          <div key={live.id} className="overflow-hidden rounded-2xl border border-card-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-foreground/5 px-4 py-2.5 text-sm">
              <span>
                <span className="font-semibold">{live.liveDate}</span> · {live.title}
              </span>
              <span className="text-xs text-foreground-muted">
                {live.left > 0 ? <span className="font-semibold text-pending">{formatCurrency(live.left)} left</span> : <span className="font-semibold text-available">paid</span>} · {formatCurrency(live.total)}
              </span>
            </div>
            <ul className="divide-y divide-card-border">
              {live.cards.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="font-medium">{formatCurrency(c.amount)}</span>
                  {c.left <= 0 ? <Badge tone="available">Paid</Badge> : c.paid > 0 ? <Badge tone="pending">{formatCurrency(c.left)} left</Badge> : <Badge tone="neutral">Unpaid</Badge>}
                  {c.state === "SHIPPED" && (
                    <Badge tone="available">
                      <Truck size={12} className="mr-1" /> Shipped {c.shippedOn}
                    </Badge>
                  )}
                  {c.state === "HANDED_OVER" && (
                    <Badge tone="available">
                      <Package size={12} className="mr-1" /> Handed over
                    </Badge>
                  )}
                  {c.wantsShipping && <Badge tone="gold">To be shipped</Badge>}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
