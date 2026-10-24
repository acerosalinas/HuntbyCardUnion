"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState, useTransition } from "react";
import { ArrowLeft, ClipboardCopy, Package, Trash2, Truck, Undo2, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { ShipDialog } from "@/components/tracker/ShipDialog";
import { PayDialog } from "@/components/tracker/PayDialog";
import { ownerColor } from "@/lib/tracker/ownerColors";
import { Select } from "@/components/ui/Select";
import {
  deleteCustomer,
  deletePayment,
  deleteSale,
  recordPayment,
  setPaymentLive,
  setSalesDistributed,
  saveCustomer,
  setSalesForShipping,
  undoShipment,
} from "@/app/tracker/actions";
import { copyText } from "@/lib/tracker/clipboard";
import { buildStatementText, computeStatement } from "@/lib/tracker/statement";
import { CustomerTotals } from "@/lib/tracker/money";
import {
  ISLAND_GROUP_LABELS,
  islandGroupForRegion,
  REGIONS,
  shippingFeeFor,
  zipMismatchWarning,
} from "@/lib/tracker/regions";
import type {
  TrackerCustomer,
  TrackerLive,
  TrackerPayment,
  TrackerSale,
  TrackerSettings,
  TrackerShipment,
} from "@/lib/tracker/data";
import { cn, extractErrorMessage, formatCurrency } from "@/lib/utils";

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface Props {
  customer: TrackerCustomer;
  totals: CustomerTotals;
  lives: TrackerLive[];
  sales: TrackerSale[];
  payments: TrackerPayment[];
  shipments: TrackerShipment[];
  settings: TrackerSettings;
  /** How much of each card is already paid (payments made for a live settle that live first). */
  paidBySale: Record<string, number>;
}

const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted";
const panel = "rounded-2xl border border-card-border bg-card p-4";

export function CustomerDetail({ customer, totals, lives, sales, payments, shipments, settings, paidBySale }: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = (fn: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Something went wrong.");
      }
    });
  };

  // ---- Address ----
  const [addr, setAddr] = useState({
    name: customer.name,
    region: customer.region ?? "",
    provinceCity: customer.provinceCity ?? "",
    barangay: customer.barangay ?? "",
    zip: customer.zip ?? "",
    street: customer.street ?? "",
  });
  const group = islandGroupForRegion(addr.region);
  const zipWarning = zipMismatchWarning(addr.region, addr.zip);
  const dirty =
    addr.name !== customer.name ||
    addr.region !== (customer.region ?? "") ||
    addr.provinceCity !== (customer.provinceCity ?? "") ||
    addr.barangay !== (customer.barangay ?? "") ||
    addr.zip !== (customer.zip ?? "") ||
    addr.street !== (customer.street ?? "");

  // ---- Payment form ----
  const [pay, setPay] = useState({ liveId: "", amount: "", method: "GCASH" as "GCASH" | "MARIBANK", purpose: "CARDS" as "CARDS" | "SHIPPING", paidOn: todayLocal(), note: "" });
  const submitPayment = (e: FormEvent) => {
    e.preventDefault();
    const amount = Number(pay.amount);
    if (!Number.isFinite(amount) || amount <= 0) return setError("Enter a payment amount above zero.");
    run(async () => {
      await recordPayment({ customerId: customer.id, liveId: pay.liveId || null, amount, method: pay.method, purpose: pay.purpose, paidOn: pay.paidOn, note: pay.note });
      setPay((p) => ({ ...p, amount: "", note: "" }));
    });
  };

  // ---- Cards: pending vs shipped, selection, payment status ----
  const liveById = useMemo(() => new Map(lives.map((l) => [l.id, l])), [lives]);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const paidOf = (id: string) => paidBySale[id] ?? 0;
  const leftOf = (s: TrackerSale) => round2(s.amount - paidOf(s.id));
  // A card is "shipped" once it's in a parcel (shipping) or handed over (not shipping); everything else is still pending.
  const isDone = (s: TrackerSale) => s.shipmentId !== null || s.distributedAt !== null;
  const byOrder = (a: TrackerSale, b: TrackerSale) =>
    (liveById.get(a.liveId)?.liveDate ?? "").localeCompare(liveById.get(b.liveId)?.liveDate ?? "") || a.createdAt.localeCompare(b.createdAt);
  const pendingCards = sales.filter((s) => !isDone(s)).sort(byOrder);
  const shippedCards = sales.filter(isDone).sort(byOrder);
  const pendingTotal = round2(pendingCards.reduce((n, s) => n + s.amount, 0));
  const pendingPaid = round2(pendingCards.reduce((n, s) => n + paidOf(s.id), 0));
  const pendingPct = pendingTotal > 0 ? Math.min(100, Math.round((pendingPaid / pendingTotal) * 100)) : 0;

  // One tick box per live that still has something unpaid on a pending card.
  const liveChoices = lives
    .map((l) => ({
      id: l.id,
      title: l.title,
      date: l.liveDate,
      left: round2(pendingCards.filter((x) => x.liveId === l.id).reduce((n, x) => n + Math.max(0, leftOf(x)), 0)),
    }))
    .filter((l) => l.left > 0);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Lives ticked for the invoice. Nothing ticked = every pending live is copied; ticking some copies / marks paid just those.
  const [tickedLives, setTickedLives] = useState<Set<string>>(new Set());
  // Whether the payment dialog was opened from the ticked lives (rather than from individually ticked cards).
  const [payFromLives, setPayFromLives] = useState(false);
  const [shipOpen, setShipOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const selectedCards = sales.filter((s) => selected.has(s.id)).sort(byOrder);
  const selectedLeft = round2(selectedCards.reduce((n, s) => n + Math.max(0, leftOf(s)), 0));
  const toShip = selectedCards.filter((s) => s.shipmentId === null && s.forShipping);
  const toDistribute = selectedCards.filter((s) => s.distributedAt === null && s.shipmentId === null && !s.forShipping);
  const payableSelected = selectedCards.filter((s) => leftOf(s) > 0);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Every unpaid pending card of the ticked lives - what "Mark as paid" settles.
  const livePayCards = pendingCards.filter((x) => tickedLives.has(x.liveId) && leftOf(x) > 0);
  const livePayLeft = round2(livePayCards.reduce((n, x) => n + leftOf(x), 0));

  const ShippedRow = ({ s, undo = false }: { s: TrackerSale; undo?: boolean }) => {
    const color = ownerColor(s.ownerTag, settings.ownerLabels);
    return (
      <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm", color?.row)}>
        <input
          type="checkbox"
          aria-label={`Select ${s.cardName}`}
          checked={selected.has(s.id)}
          disabled={leftOf(s) <= 0}
          onChange={() => toggle(s.id)}
          className="h-4 w-4 rounded border-card-border accent-gold disabled:opacity-30"
        />
        <span className="min-w-0 flex-1">
          <span className={cn("inline-block max-w-full truncate rounded-md px-2 py-0.5 align-middle font-medium", color?.name)}>{s.cardName}</span>
          <span className="ml-2 text-xs text-foreground-muted">{liveById.get(s.liveId)?.liveDate}</span>
        </span>
        <span className="font-medium">{formatCurrency(s.amount)}</span>
        {payBadge(s)}
        {undo && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setSalesDistributed([s.id], false))}
            className="inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-sold disabled:opacity-40"
          >
            <Undo2 size={12} /> Undo
          </button>
        )}
      </li>
    );
  };

  const payBadge = (s: TrackerSale) => {
    const left = leftOf(s);
    if (left <= 0) return <Badge tone="available">Paid</Badge>;
    if (paidOf(s.id) > 0) return <Badge tone="pending">{formatCurrency(left)} left</Badge>;
    return <Badge tone="neutral">Unpaid</Badge>;
  };

  // The customer's PENDING balance only, grouped by order date (see lib/tracker/statement.ts).
  const statementInput = {
    customerName: customer.name,
    // Shipped / handed-over cards are treated as paid, so only PENDING cards of the ticked lives go on the invoice.
    orders: lives
      .filter((l) => (tickedLives.size === 0 || tickedLives.has(l.id)) && pendingCards.some((x) => x.liveId === l.id))
      .map((l) => ({
        liveTitle: l.title,
        liveDate: l.liveDate,
        cards: pendingCards.filter((x) => x.liveId === l.id).map((x) => ({ cardName: x.cardName, amount: x.amount, paid: paidOf(x.id) })),
      })),
    shippingUnpaid: Math.max(0, totals.shippingCharged - totals.shippingPaid),
    awaitingShipCount: totals.awaitingShipCount,
    shippingFee: shippingFeeFor(customer.islandGroup, settings),
    islandGroup: customer.islandGroup,
    prepaidCredit: totals.prepaidShippingCredit,
    address: customer.address,
    showAddress: settings.showAddressOnInvoice,
    paymentInstructions: settings.paymentInstructions,
    qrLinks: [
      { label: "GCash", url: settings.gcashQrUrl ?? "" },
      { label: "Maribank", url: settings.maribankQrUrl ?? "" },
    ].filter((q) => q.url),
  };
  const pendingStatement = computeStatement(statementInput);

  const copyPending = async () => {
    const ok = await copyText(buildStatementText(statementInput));
    setCopied(ok);
    if (!ok) setError("Couldn't copy - your browser blocked clipboard access.");
    setTimeout(() => setCopied(false), 2000);
  };

  const stats = [
    { label: "Cards", value: formatCurrency(totals.cardsTotal) },
    { label: "Shipping charged", value: formatCurrency(totals.shippingCharged) },
    { label: "Paid", value: formatCurrency(totals.paid) },
    {
      label: totals.balance < 0 ? "Credit" : "Balance",
      value: formatCurrency(Math.abs(totals.balance)),
      tone: totals.balance > 0 ? "text-pending" : totals.balance < 0 ? "text-available" : "",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Link href="/tracker/customers" aria-label="Back to customers" className="rounded-full p-1.5 text-foreground-muted hover:bg-foreground/10">
            <ArrowLeft size={18} />
          </Link>
          <h2 className="text-xl font-bold">{customer.name}</h2>
          {customer.islandGroup && <Badge tone="neutral">{ISLAND_GROUP_LABELS[customer.islandGroup]}</Badge>}
          {totals.prepaidShippingCredit > 0 && <Badge tone="gold">{formatCurrency(totals.prepaidShippingCredit)} shipping prepaid</Badge>}
        </div>
      </div>

      {error && <p className="rounded-lg border border-sold/30 bg-sold-bg px-3 py-2 text-sm text-sold">{error}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className={panel}>
            <span className="text-xs font-medium uppercase tracking-wide text-foreground-muted">{s.label}</span>
            <div className={`mt-1 text-2xl font-bold ${s.tone ?? ""}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Pending cards */}
      <section className={panel}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">
            Pending <span className="text-sm font-normal text-foreground-muted">· {pendingCards.length} card{pendingCards.length === 1 ? "" : "s"} not shipped yet</span>
          </h3>
          {tickedLives.size === 0 && pendingStatement.totalToPay > 0 && (
            <Button variant="outline" type="button" onClick={copyPending}>
              <ClipboardCopy size={14} /> {copied ? "Copied!" : "Copy pending balance"}
            </Button>
          )}
        </div>

        {liveChoices.length > 0 && (
          <div className="mb-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-foreground-muted">Invoices by live (tick to pick):</span>
              {liveChoices.map((l) => {
                const on = tickedLives.has(l.id);
                return (
                  <label
                    key={l.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors",
                      on ? "border-gold bg-gold/10" : "border-card-border text-foreground-muted hover:text-foreground",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setTickedLives((prev) => {
                          const next = new Set(prev);
                          if (next.has(l.id)) next.delete(l.id);
                          else next.add(l.id);
                          return next;
                        })
                      }
                      className="h-3.5 w-3.5 rounded border-card-border accent-gold"
                    />
                    {l.date} · {l.title} · {formatCurrency(l.left)}
                  </label>
                );
              })}
            </div>
            {tickedLives.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-sm">
                <span className="font-medium">
                  {tickedLives.size} live{tickedLives.size === 1 ? "" : "s"} ticked · {formatCurrency(livePayLeft)} unpaid
                </span>
                <div className="ml-auto flex flex-wrap gap-2">
                  <Button variant="outline" type="button" className="px-3 py-1.5" onClick={copyPending}>
                    <ClipboardCopy size={13} /> {copied ? "Copied!" : `Copy invoice (${tickedLives.size})`}
                  </Button>
                  {livePayCards.length > 0 && (
                    <Button
                      variant="gold"
                      type="button"
                      className="px-3 py-1.5"
                      onClick={() => {
                        setPayFromLives(true);
                        setPayOpen(true);
                      }}
                    >
                      <Wallet size={13} /> Mark as paid ({formatCurrency(livePayLeft)})
                    </Button>
                  )}
                  <Button variant="outline" type="button" className="px-3 py-1.5" onClick={() => setTickedLives(new Set())}>
                    Clear
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {pendingCards.length > 0 && (
          <div className="mb-3">
            <div className="mb-1 flex items-baseline justify-between text-xs text-foreground-muted">
              <span>Paid on pending cards</span>
              <span>
                <span className="font-semibold text-foreground">{formatCurrency(pendingPaid)}</span> of {formatCurrency(pendingTotal)} · {pendingPct}%
              </span>
            </div>
            <div role="progressbar" aria-valuenow={pendingPct} aria-valuemin={0} aria-valuemax={100} aria-label="Paid on pending cards" className="h-2.5 overflow-hidden rounded-full bg-foreground/10">
              <div className={cn("h-full rounded-full transition-all", pendingPct >= 100 ? "bg-available" : "bg-gold")} style={{ width: `${pendingPct}%` }} />
            </div>
          </div>
        )}

        {selected.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-sm">
            <span className="font-medium">
              {selected.size} selected · {formatCurrency(selectedLeft)} unpaid
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              {payableSelected.length > 0 && (
                <Button variant="gold" type="button" className="px-3 py-1.5" onClick={() => setPayOpen(true)}>
                  <Wallet size={13} /> Record payment for these
                </Button>
              )}
              {toShip.length > 0 && (
                <Button variant="outline" type="button" className="px-3 py-1.5" onClick={() => setShipOpen(true)}>
                  <Truck size={13} /> Mark {toShip.length} shipped
                </Button>
              )}
              {toDistribute.length > 0 && (
                <Button
                  variant="outline"
                  type="button"
                  className="px-3 py-1.5"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      await setSalesDistributed(toDistribute.map((s) => s.id), true);
                      setSelected(new Set());
                    })
                  }
                >
                  <Package size={13} /> Mark {toDistribute.length} distributed
                </Button>
              )}
              <Button variant="outline" type="button" className="px-3 py-1.5" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          </div>
        )}

        {pendingCards.length === 0 ? (
          <p className="py-6 text-center text-sm text-foreground-muted">{sales.length === 0 ? "No cards yet." : "Nothing pending - every card has been shipped or handed over."}</p>
        ) : (
          <>
            <label className="mb-1 flex items-center gap-2 text-xs text-foreground-muted">
              <input
                type="checkbox"
                checked={pendingCards.every((s) => selected.has(s.id))}
                onChange={(e) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    for (const s of pendingCards) {
                      if (e.target.checked) next.add(s.id);
                      else next.delete(s.id);
                    }
                    return next;
                  })
                }
                className="h-4 w-4 rounded border-card-border accent-gold"
              />
              Select all pending
            </label>
            <ul className="divide-y divide-card-border">
              {pendingCards.map((s) => {
                const color = ownerColor(s.ownerTag, settings.ownerLabels);
                return (
                  <li key={s.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2 text-sm", color?.row)}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${s.cardName}`}
                      checked={selected.has(s.id)}
                      onChange={() => toggle(s.id)}
                      className="h-4 w-4 rounded border-card-border accent-gold"
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn("inline-block max-w-full truncate rounded-md px-2 py-0.5 align-middle font-medium", color?.name)}>{s.cardName}</span>
                      <span className="ml-2 text-xs text-foreground-muted">
                        {liveById.get(s.liveId)?.liveDate} · {liveById.get(s.liveId)?.title ?? "Live"}
                      </span>
                    </span>
                    <span className="font-medium">{formatCurrency(s.amount)}</span>
                    {payBadge(s)}
                    <label className="flex items-center gap-1.5 text-xs text-foreground-muted">
                      <input
                        type="checkbox"
                        checked={s.forShipping}
                        disabled={pending}
                        onChange={(e) => run(() => setSalesForShipping([s.id], e.target.checked))}
                        className="h-3.5 w-3.5 rounded border-card-border accent-gold"
                      />
                      For shipping
                    </label>
                    <button
                      type="button"
                      aria-label={`Delete ${s.cardName}`}
                      disabled={pending}
                      onClick={async () => {
                        if (await confirm({ title: "Delete card?", message: `Remove ${s.cardName} (${formatCurrency(s.amount)}) from ${customer.name}'s account?`, confirmLabel: "Delete", tone: "danger" }))
                          run(() => deleteSale(s.id));
                      }}
                      className="rounded p-1 text-foreground-muted hover:text-sold disabled:opacity-30"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {/* Shipped / handed over */}
      <section className={panel}>
        <h3 className="mb-3 font-semibold">
          Shipped <span className="text-sm font-normal text-foreground-muted">· {shippedCards.length} card{shippedCards.length === 1 ? "" : "s"} sent or handed over</span>
        </h3>
        {shippedCards.length === 0 ? (
          <p className="py-6 text-center text-sm text-foreground-muted">Nothing shipped yet.</p>
        ) : (
          <div className="space-y-4">
            {shipments
              .filter((sh) => shippedCards.some((s) => s.shipmentId === sh.id))
              .map((sh) => {
                const cards = shippedCards.filter((s) => s.shipmentId === sh.id);
                return (
                  <div key={sh.id}>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="font-medium">
                        <Truck size={13} className="mr-1.5 inline text-available" />
                        {sh.shippedOn} · {cards.length} card{cards.length === 1 ? "" : "s"} · fee {formatCurrency(sh.fee)}
                        {sh.prepaidApplied > 0 && <span className="font-normal text-foreground-muted"> (prepaid covered {formatCurrency(sh.prepaidApplied)})</span>}
                        {sh.note && <span className="font-normal text-foreground-muted"> · {sh.note}</span>}
                      </span>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={async () => {
                          if (await confirm({ title: "Undo this shipment?", message: "The cards go back to pending and the shipping fee is removed from this customer's balance.", confirmLabel: "Undo shipment", tone: "danger" }))
                            run(() => undoShipment(sh.id));
                        }}
                        className="inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-sold"
                      >
                        <Undo2 size={12} /> Undo
                      </button>
                    </div>
                    <ul className="divide-y divide-card-border rounded-xl border border-card-border">
                      {cards.map((s) => (
                        <ShippedRow key={s.id} s={s} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            {shippedCards.some((s) => s.shipmentId === null) && (
              <div>
                <div className="mb-1 text-sm font-medium">
                  <Package size={13} className="mr-1.5 inline text-available" />
                  Handed over (not shipped)
                </div>
                <ul className="divide-y divide-card-border rounded-xl border border-card-border">
                  {shippedCards
                    .filter((s) => s.shipmentId === null)
                    .map((s) => (
                      <ShippedRow key={s.id} s={s} undo />
                    ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Payments */}
      <section className={panel}>
        <h3 className="mb-3 font-semibold">Payments</h3>
        <form onSubmit={submitPayment} className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <div className="col-span-2 sm:col-span-1">
            <label className={label}>For live</label>
            <Select value={pay.liveId} onChange={(e) => setPay({ ...pay, liveId: e.target.value })}>
              <option value="">Any (oldest first)</option>
              {lives
                .filter((l) => sales.some((s) => s.liveId === l.id))
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
            </Select>
          </div>
          <div className="col-span-1">
            <label className={label}>Amount</label>
            <Input type="number" inputMode="decimal" min={0} step="0.01" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} placeholder="0" />
          </div>
          <div>
            <label className={label}>Method</label>
            <Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value as "GCASH" | "MARIBANK" })}>
              <option value="GCASH">GCash</option>
              <option value="MARIBANK">Maribank</option>
            </Select>
          </div>
          <div>
            <label className={label}>For</label>
            <Select value={pay.purpose} onChange={(e) => setPay({ ...pay, purpose: e.target.value as "CARDS" | "SHIPPING" })}>
              <option value="CARDS">Cards</option>
              <option value="SHIPPING">Shipping fee (prepaid)</option>
            </Select>
          </div>
          <div>
            <label className={label}>Date</label>
            <Input type="date" value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={label}>Note</label>
            <Input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} placeholder="optional" maxLength={300} />
          </div>
          <div className="col-span-2 flex items-end sm:col-span-1">
            <Button type="submit" variant="gold" className="w-full" disabled={pending}>
              Record payment
            </Button>
          </div>
        </form>

        {payments.length > 0 && (
          <ul className="mt-4 divide-y divide-card-border border-t border-card-border text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="w-24 text-foreground-muted">{p.paidOn}</span>
                <span className="font-medium">{formatCurrency(p.amount)}</span>
                <Badge tone="neutral">{p.method === "GCASH" ? "GCash" : "Maribank"}</Badge>
                {p.purpose === "SHIPPING" && <Badge tone="gold">Shipping prepaid</Badge>}
                {p.purpose === "CARDS" && (
                  <select
                    aria-label="This payment applies to"
                    value={p.liveId ?? ""}
                    disabled={pending}
                    onChange={(e) => run(() => setPaymentLive(p.id, e.target.value || null))}
                    className="max-w-[10rem] truncate rounded-md border border-card-border bg-background-elevated px-1.5 py-0.5 text-xs text-foreground"
                  >
                    <option value="">Any (oldest first)</option>
                    {lives
                      .filter((l) => sales.some((x) => x.liveId === l.id) || l.id === p.liveId)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.title}
                        </option>
                      ))}
                  </select>
                )}
                {p.note && <span className="min-w-0 flex-1 truncate text-foreground-muted">{p.note}</span>}
                <button
                  type="button"
                  aria-label="Delete payment"
                  disabled={pending}
                  onClick={async () => {
                    if (await confirm({ title: "Delete this payment?", message: `${formatCurrency(p.amount)} on ${p.paidOn} will be removed and ${customer.name}'s balance goes back up.`, confirmLabel: "Delete payment", tone: "danger" }))
                      run(() => deletePayment(p.id));
                  }}
                  className="ml-auto rounded p-1 text-foreground-muted hover:text-sold"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Address */}
      <section className={panel}>
        <h3 className="mb-1 font-semibold">Customer &amp; address</h3>
        <p className="mb-3 text-xs text-foreground-muted">
          The region decides Luzon / Visayas / Mindanao, which sets the shipping fee. The ZIP code is only used to warn about typos.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Name</label>
            <Input value={addr.name} onChange={(e) => setAddr({ ...addr, name: e.target.value })} maxLength={120} />
          </div>
          <div>
            <label className={label}>Region</label>
            <Select value={addr.region} onChange={(e) => setAddr({ ...addr, region: e.target.value })}>
              <option value="">Not set</option>
              {REGIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className={label}>Province / City</label>
            <Input value={addr.provinceCity} onChange={(e) => setAddr({ ...addr, provinceCity: e.target.value })} placeholder="e.g. Cebu City, Cebu" maxLength={120} />
          </div>
          <div>
            <label className={label}>Barangay</label>
            <Input value={addr.barangay} onChange={(e) => setAddr({ ...addr, barangay: e.target.value })} maxLength={120} />
          </div>
          <div>
            <label className={label}>ZIP code</label>
            <Input value={addr.zip} onChange={(e) => setAddr({ ...addr, zip: e.target.value })} inputMode="numeric" maxLength={4} placeholder="4 digits" />
          </div>
          <div>
            <label className={label}>Street / house no. (optional)</label>
            <Input value={addr.street} onChange={(e) => setAddr({ ...addr, street: e.target.value })} maxLength={200} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            {group ? (
              <>
                <span className="font-medium">{ISLAND_GROUP_LABELS[group]}</span> · shipping fee{" "}
                <span className="font-semibold">{formatCurrency(shippingFeeFor(group, settings) ?? 0)}</span> per parcel
              </>
            ) : (
              <span className="text-foreground-muted">Pick a region to set the shipping fee.</span>
            )}
            {zipWarning && <span className="mt-1 block text-pending">{zipWarning}</span>}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              type="button"
              disabled={pending}
              onClick={async () => {
                if (await confirm({ title: "Delete customer?", message: `${customer.name} will be removed. This only works for customers with no cards or payments.`, confirmLabel: "Delete", tone: "danger" }))
                  run(async () => {
                    await deleteCustomer(customer.id);
                    router.replace("/tracker/customers");
                  });
              }}
            >
              Delete
            </Button>
            <Button variant="gold" type="button" disabled={pending || !dirty} onClick={() => run(() => saveCustomer(customer.id, addr))}>
              Save changes
            </Button>
          </div>
        </div>
      </section>

      <ShipDialog
        open={shipOpen}
        onClose={() => setShipOpen(false)}
        onShipped={() => setSelected(new Set())}
        customer={{ id: customer.id, name: customer.name, islandGroup: customer.islandGroup }}
        saleIds={toShip.map((s) => s.id)}
        prepaidCredit={totals.prepaidShippingCredit}
        rates={settings}
      />
      {payOpen && (
        <PayDialog
          open
          onClose={() => {
            setPayOpen(false);
            setPayFromLives(false);
            setSelected(new Set());
            setTickedLives(new Set());
          }}
          customer={{ id: customer.id, name: customer.name, islandGroup: customer.islandGroup }}
          balance={totals.balance}
          rates={settings}
          live={null}
          liveDue={null}
          otherLivesDue={0}
          shippingUnpaid={Math.max(0, totals.shippingCharged - totals.shippingPaid)}
          lives={lives}
          customerLiveIds={[...new Set(sales.map((s) => s.liveId))]}
          payments={payments}
          selectedCards={(payFromLives ? livePayCards : payableSelected).map((s) => ({ id: s.id, name: s.cardName, amount: s.amount, left: leftOf(s) }))}
        />
      )}
    </div>
  );
}
