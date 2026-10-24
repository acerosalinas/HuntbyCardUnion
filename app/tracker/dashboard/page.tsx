import Link from "next/link";
import { requireTrackerAdminOrRedirect } from "@/lib/tracker/auth";
import { loadTrackerData } from "@/lib/tracker/data";
import { computeDashboard, DateRange, ownerProgress } from "@/lib/tracker/dashboard";
import { ISLAND_GROUP_LABELS } from "@/lib/tracker/regions";
import { Badge } from "@/components/ui/Badge";
import { PayoutCell } from "@/components/tracker/PayoutCell";
import { OwnerProgressBars } from "@/components/tracker/OwnerProgress";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn, formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today as YYYY-MM-DD in Philippine time - the server runs in UTC, where "today" would flip at 8am. */
function manilaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function TrackerDashboardPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const admin = await requireTrackerAdminOrRedirect();
  const params = await searchParams;
  const range: DateRange = {
    from: params.from && ISO_DATE.test(params.from) ? params.from : undefined,
    to: params.to && ISO_DATE.test(params.to) ? params.to : undefined,
  };

  const data = await loadTrackerData(admin.id);
  const liveDateById = new Map(data.lives.map((l) => [l.id, l.liveDate]));
  const d = computeDashboard(
    {
      customers: data.customers,
      lives: data.lives,
      // "order" = live date then entry time, so a customer's payments settle their oldest cards first.
      sales: data.sales.map((x) => ({
        id: x.id,
        customerId: x.customerId,
        liveId: x.liveId,
        amount: x.amount,
        ownerTag: x.ownerTag,
        order: `${liveDateById.get(x.liveId) ?? ""}|${x.createdAt}`,
      })),
      payments: data.payments.map((p) => ({ customerId: p.customerId, amount: p.amount, method: p.method, purpose: p.purpose, paidOn: p.paidOn, liveId: p.liveId, allocations: p.allocations })),
      ownerLabels: data.settings.ownerLabels,
      payouts: data.payouts.map((p) => ({ liveId: p.liveId, recipientTag: p.recipientTag, amount: p.amount })),
      shipments: data.shipments,
      totalsByCustomer: data.totalsByCustomer,
    },
    range,
  );

  const today = manilaToday();
  const presets = [
    { label: "All time", href: "/tracker/dashboard", active: !range.from && !range.to },
    {
      label: "This month",
      href: `/tracker/dashboard?from=${today.slice(0, 8)}01`,
      active: range.from === `${today.slice(0, 8)}01` && !range.to,
    },
    {
      label: "Last 30 days",
      href: `/tracker/dashboard?from=${shiftDays(today, -29)}`,
      active: range.from === shiftDays(today, -29) && !range.to,
    },
  ];

  const maxLive = Math.max(1, ...d.perLive.map((l) => l.total));
  const methodTotal = d.byMethod.GCASH + d.byMethod.MARIBANK;
  const rangeLabel = !range.from && !range.to ? "all time" : `${range.from ?? "start"} to ${range.to ?? "today"}`;

  const kpis = [
    { label: "Total Sold", value: formatCurrency(d.soldInRange), hint: `${d.cardsInRange} cards · ${d.livesInRange} lives` },
    { label: "Collected", value: formatCurrency(d.collectedInRange), hint: "payments received" },
    { label: "Shipping Charged", value: formatCurrency(d.shippingChargedInRange), hint: `${d.parcelsInRange} parcel${d.parcelsInRange === 1 ? "" : "s"} shipped` },
    { label: "Outstanding Now", value: formatCurrency(d.outstandingNow), hint: `${d.owingCount} customer${d.owingCount === 1 ? "" : "s"} owe`, accent: d.outstandingNow > 0 },
    { label: "Cards To Ship", value: String(d.awaitingShipCards), hint: "flagged for shipping" },
  ];

  const panel = "rounded-2xl border border-card-border bg-card p-4";
  const heading = "mb-3 text-sm font-semibold";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <Link
              key={p.label}
              href={p.href}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                p.active ? "border-gold bg-gold/10" : "border-card-border text-foreground-muted hover:text-foreground",
              )}
            >
              {p.label}
            </Link>
          ))}
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-foreground-muted">From</label>
            <Input type="date" name="from" defaultValue={range.from ?? ""} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-foreground-muted">To</label>
            <Input type="date" name="to" defaultValue={range.to ?? ""} />
          </div>
          <Button type="submit" variant="outline">
            Apply
          </Button>
        </form>
      </div>

      <p className="text-xs text-foreground-muted">
        Sold, collected and shipping figures cover <span className="font-medium text-foreground">{rangeLabel}</span>. Outstanding and cards to ship always show where things stand today.
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className={panel}>
            <span className="text-xs font-medium uppercase tracking-wide text-foreground-muted">{k.label}</span>
            <div className={cn("mt-1 text-2xl font-bold", k.accent && "text-pending")}>{k.value}</div>
            <span className="text-xs text-foreground-muted">{k.hint}</span>
          </div>
        ))}
      </div>

      <section className={panel}>
        <h2 className={heading}>Progress by owner</h2>
        <OwnerProgressBars items={ownerProgress(d.splitPerLive, data.settings.ownerLabels)} labels={data.settings.ownerLabels} />
        <p className="mt-3 text-xs text-foreground-muted">
          Collected so far out of what each owner&apos;s cards add up to, across {rangeLabel}. Choose who appears under Settings → Card owners.
        </p>
      </section>

      {/* Per-live owner split: expected vs actual, like the live-end reconciliation sheet. */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Per-live split by owner</h2>
          <p className="text-xs text-foreground-muted">
            <span className="font-medium text-foreground">Expected</span> = what each owner&apos;s cards add up to.{" "}
            <span className="font-medium text-foreground">Actual</span> = what customers have paid so far on those cards (each customer&apos;s payments settle their oldest cards first).
          </p>
        </div>
        {d.splitPerLive.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-card-border py-8 text-center text-sm text-foreground-muted">No lives in this range.</p>
        ) : (
          d.splitPerLive.map((live, index) => (
            <details key={live.id} open={index === 0} className="rounded-2xl border border-card-border bg-card">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm font-semibold">
                <span>
                  {live.title} <span className="text-xs font-normal text-foreground-muted">{live.liveDate}</span>
                </span>
                <span className="text-xs font-normal text-foreground-muted">
                  Total {formatCurrency(live.expectedTotal)} · collected {formatCurrency(live.actualTotal)} · given out {formatCurrency(live.distributedTotal)}
                  {live.expectedTotal - live.actualTotal > 0 && <span className="text-pending"> · {formatCurrency(live.expectedTotal - live.actualTotal)} to collect</span>}
                </span>
              </summary>
              <div className="border-t border-card-border p-4 pb-0">
                <OwnerProgressBars items={ownerProgress([live], data.settings.ownerLabels)} labels={data.settings.ownerLabels} compact />
              </div>
              <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3">
                {(
                  [
                    ["Expected total", "expected", live.expectedTotal],
                    ["Actual", "actual", live.actualTotal],
                  ] as const
                ).map(([title, key, total]) => (
                  <table key={key} className="w-full text-sm">
                    <caption className="mb-1.5 text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">{title}</caption>
                    <tbody className="divide-y divide-card-border">
                      {live.rows.map((r) => (
                        <tr key={r.code ?? "none"}>
                          <td className="py-1.5 pr-3 font-medium">
                            {r.name}
                            {r.code && r.code !== r.name && <span className="ml-1.5 text-xs font-normal text-foreground-muted">({r.code})</span>}
                          </td>
                          <td className="py-1.5 text-right">{formatCurrency(r[key])}</td>
                        </tr>
                      ))}
                      <tr className="font-bold">
                        <td className="pt-2 pr-3">Overall</td>
                        <td className="pt-2 text-right">{formatCurrency(total)}</td>
                      </tr>
                    </tbody>
                  </table>
                ))}
                <table className="w-full text-sm">
                  <caption className="mb-1.5 text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">Payment distributed</caption>
                  <tbody className="divide-y divide-card-border">
                    {live.rows.map((r) => (
                      <tr key={r.code ?? "none"}>
                        <td className="py-1.5 pr-3 font-medium">{r.name}</td>
                        <td className="py-1.5 text-right">
                          <PayoutCell
                            liveId={live.id}
                            liveTitle={live.title}
                            recipientTag={r.code}
                            recipientName={r.name}
                            actual={r.actual}
                            distributed={r.distributed}
                            payouts={data.payouts.filter((p) => p.liveId === live.id && p.recipientTag === r.code)}
                          />
                        </td>
                      </tr>
                    ))}
                    <tr className="font-bold">
                      <td className="pt-2 pr-3">Overall</td>
                      <td className="pt-2 text-right">{formatCurrency(live.distributedTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          ))
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className={cn(panel, "lg:col-span-2")}>
          <h2 className={heading}>Sales per live</h2>
          {d.perLive.length === 0 ? (
            <p className="py-8 text-center text-sm text-foreground-muted">No lives in this range.</p>
          ) : (
            <ul className="space-y-2.5">
              {d.perLive.map((l) => (
                <li key={l.id}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <Link href={`/tracker?live=${l.id}`} className="min-w-0 truncate hover:text-gold">
                      {l.title} <span className="text-xs text-foreground-muted">{l.liveDate}</span>
                    </Link>
                    <span className="shrink-0 font-medium">
                      {formatCurrency(l.total)} <span className="text-xs font-normal text-foreground-muted">· {l.cards} cards · {l.customers} buyers</span>
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-foreground/10">
                    <div className="h-full rounded-full bg-gold" style={{ width: `${Math.max(2, (l.total / maxLive) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={panel}>
          <h2 className={heading}>Collected by method</h2>
          {methodTotal === 0 ? (
            <p className="py-8 text-center text-sm text-foreground-muted">No payments in this range.</p>
          ) : (
            <div className="space-y-3">
              {(
                [
                  ["GCash", d.byMethod.GCASH],
                  ["Maribank", d.byMethod.MARIBANK],
                ] as const
              ).map(([name, amount]) => (
                <div key={name}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{name}</span>
                    <span className="font-medium">
                      {formatCurrency(amount)} <span className="text-xs font-normal text-foreground-muted">{Math.round((amount / methodTotal) * 100)}%</span>
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-foreground/10">
                    <div className="h-full rounded-full bg-available" style={{ width: `${(amount / methodTotal) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className={panel}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Who owes you</h2>
            <Link href="/tracker/customers" className="text-xs text-gold hover:underline">
              See all
            </Link>
          </div>
          {d.topOwing.length === 0 ? (
            <p className="py-6 text-center text-sm text-foreground-muted">Nobody owes you anything.</p>
          ) : (
            <ul className="divide-y divide-card-border text-sm">
              {d.topOwing.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/tracker/customers/${o.id}`} className="truncate hover:text-gold">
                    {o.name}
                  </Link>
                  <span className="shrink-0 font-semibold text-pending">{formatCurrency(o.balance)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={panel}>
          <h2 className={heading}>Waiting to ship</h2>
          {d.shipQueue.length === 0 ? (
            <p className="py-6 text-center text-sm text-foreground-muted">No cards waiting to ship.</p>
          ) : (
            <ul className="divide-y divide-card-border text-sm">
              {d.shipQueue.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/tracker/customers/${c.id}`} className="truncate hover:text-gold">
                    {c.name}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2">
                    {c.islandGroup && <span className="text-xs text-foreground-muted">{ISLAND_GROUP_LABELS[c.islandGroup]}</span>}
                    <Badge tone="pending">{c.cards} card{c.cards === 1 ? "" : "s"}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={panel}>
          <h2 className={heading}>Recent payments</h2>
          {d.recentPayments.length === 0 ? (
            <p className="py-6 text-center text-sm text-foreground-muted">No payments in this range.</p>
          ) : (
            <ul className="divide-y divide-card-border text-sm">
              {d.recentPayments.map((p, i) => (
                <li key={`${p.customerId}-${p.paidOn}-${i}`} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <Link href={`/tracker/customers/${p.customerId}`} className="block truncate hover:text-gold">
                      {p.name}
                    </Link>
                    <span className="text-xs text-foreground-muted">
                      {p.paidOn} · {p.method === "GCASH" ? "GCash" : "Maribank"}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold text-available">{formatCurrency(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
