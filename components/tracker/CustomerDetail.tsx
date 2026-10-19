"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState, useTransition } from "react";
import { ArrowLeft, ClipboardCopy, Trash2, Truck, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { ShipDialog } from "@/components/tracker/ShipDialog";
import { Select } from "@/components/ui/Select";
import {
  deleteCustomer,
  deletePayment,
  deleteSale,
  recordPayment,
  saveCustomer,
  setSalesForShipping,
  undoShipment,
} from "@/app/tracker/actions";
import { copyText } from "@/lib/tracker/clipboard";
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
import { extractErrorMessage, formatCurrency } from "@/lib/utils";

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
}

const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted";
const panel = "rounded-2xl border border-card-border bg-card p-4";

export function CustomerDetail({ customer, totals, lives, sales, payments, shipments, settings }: Props) {
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
  const [pay, setPay] = useState({ amount: "", method: "GCASH" as "GCASH" | "MARIBANK", purpose: "CARDS" as "CARDS" | "SHIPPING", paidOn: todayLocal(), note: "" });
  const submitPayment = (e: FormEvent) => {
    e.preventDefault();
    const amount = Number(pay.amount);
    if (!Number.isFinite(amount) || amount <= 0) return setError("Enter a payment amount above zero.");
    run(async () => {
      await recordPayment({ customerId: customer.id, amount, method: pay.method, purpose: pay.purpose, paidOn: pay.paidOn, note: pay.note });
      setPay((p) => ({ ...p, amount: "", note: "" }));
    });
  };

  // ---- Shipping ----
  const liveById = useMemo(() => new Map(lives.map((l) => [l.id, l])), [lives]);
  const unshipped = sales.filter((s) => s.shipmentId === null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(unshipped.filter((s) => s.forShipping).map((s) => s.id)));
  const [shipOpen, setShipOpen] = useState(false);
  const selectedIds = unshipped.filter((s) => selected.has(s.id)).map((s) => s.id);

  const openShip = () => {
    if (selectedIds.length === 0) return setError("Tick the cards that are going in this parcel first.");
    setError(null);
    setShipOpen(true);
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copyReminder = async () => {
    const lines = [`Hi ${customer.name}! Just a friendly reminder - your outstanding balance is ${formatCurrency(totals.balance)}.`];
    if (settings.paymentInstructions.trim()) lines.push("", settings.paymentInstructions.trim());
    const ok = await copyText(lines.join("\n"));
    setCopied(ok);
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
        {totals.balance > 0 && (
          <Button variant="outline" type="button" onClick={copyReminder}>
            <ClipboardCopy size={14} /> {copied ? "Copied!" : "Copy payment reminder"}
          </Button>
        )}
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

      {/* Cards & shipping */}
      <section className={panel}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Cards</h3>
          {unshipped.length > 0 && (
            <Button variant="gold" type="button" onClick={openShip} disabled={pending}>
              <Truck size={14} /> Mark {selectedIds.length || ""} shipped
            </Button>
          )}
        </div>
        {sales.length === 0 ? (
          <p className="py-6 text-center text-sm text-foreground-muted">No cards yet.</p>
        ) : (
          <ul className="divide-y divide-card-border">
            {sales.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                {s.shipmentId === null ? (
                  <input
                    type="checkbox"
                    aria-label={`Include ${s.cardName} in the parcel`}
                    checked={selected.has(s.id)}
                    onChange={() => toggle(s.id)}
                    className="h-4 w-4 rounded border-card-border accent-gold"
                  />
                ) : (
                  <Truck size={14} className="text-available" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{s.cardName}</span>
                  <span className="text-xs text-foreground-muted">
                    {liveById.get(s.liveId)?.title ?? "Live"}
                    {s.ownerTag && <> · {settings.ownerLabels.find((o) => o.code === s.ownerTag)?.name ?? s.ownerTag}</>}
                  </span>
                </span>
                <span className="font-medium">{formatCurrency(s.amount)}</span>
                {s.shipmentId === null ? (
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
                ) : (
                  <Badge tone="available">Shipped</Badge>
                )}
                <button
                  type="button"
                  aria-label={`Delete ${s.cardName}`}
                  disabled={pending || s.shipmentId !== null}
                  onClick={async () => {
                    if (await confirm({ title: "Delete card?", message: `Remove ${s.cardName} (${formatCurrency(s.amount)}) from ${customer.name}'s account?`, confirmLabel: "Delete", tone: "danger" }))
                      run(() => deleteSale(s.id));
                  }}
                  className="rounded p-1 text-foreground-muted hover:text-sold disabled:opacity-30"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {shipments.length > 0 && (
          <div className="mt-4 border-t border-card-border pt-3">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground-muted">Parcels shipped</h4>
            <ul className="space-y-1.5 text-sm">
              {shipments.map((sh) => {
                const count = sales.filter((s) => s.shipmentId === sh.id).length;
                return (
                  <li key={sh.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {sh.shippedOn} · {count} card{count === 1 ? "" : "s"} · fee {formatCurrency(sh.fee)}
                      {sh.prepaidApplied > 0 && <span className="text-foreground-muted"> (prepaid covered {formatCurrency(sh.prepaidApplied)})</span>}
                      {sh.note && <span className="text-foreground-muted"> · {sh.note}</span>}
                    </span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={async () => {
                        if (await confirm({ title: "Undo this shipment?", message: "The cards go back to not shipped and the shipping fee is removed from this customer's balance.", confirmLabel: "Undo shipment", tone: "danger" }))
                          run(() => undoShipment(sh.id));
                      }}
                      className="inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-sold"
                    >
                      <Undo2 size={12} /> Undo
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {/* Payments */}
      <section className={panel}>
        <h3 className="mb-3 font-semibold">Payments</h3>
        <form onSubmit={submitPayment} className="grid grid-cols-2 gap-3 sm:grid-cols-6">
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
        saleIds={selectedIds}
        prepaidCredit={totals.prepaidShippingCredit}
        rates={settings}
      />
    </div>
  );
}
