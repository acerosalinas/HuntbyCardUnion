"use client";

import { FormEvent, useState, useTransition } from "react";
import { CalendarClock, Package, Send, Truck } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { PlanEditor } from "@/components/tracker/PlanEditor";
import { portalRequestPlan, portalSetShipping, portalSubmitClaim, portalWithdrawPlan } from "@/app/account/orders/actions";
import type { PortalCustomer } from "@/lib/tracker/portal";
import { cn, extractErrorMessage, formatCurrency } from "@/lib/utils";

const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted";

const cleanAmount = (v: string) => {
  const cleaned = v.replace(/[^0-9.]/g, "");
  const dot = cleaned.indexOf(".");
  return dot === -1 ? cleaned : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "");
};

/** The customer's own live orders: balance, progress line, how to pay, tick-to-ship, and sending proof of payment. */
export function LiveOrders({ customer }: { customer: PortalCustomer }) {
  const { view } = customer;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Cards ticked as "I paid for these".
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [amountText, setAmountText] = useState<string | null>(null); // null = follow the ticked cards' total
  const [method, setMethod] = useState<"GCASH" | "MARIBANK">("GCASH");
  const [withSf, setWithSf] = useState(false);
  const [sfText, setSfText] = useState(customer.shippingFee === null ? "" : String(customer.shippingFee));
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);

  const allCards = view.lives.flatMap((l) => l.cards);
  const pickedCards = allCards.filter((c) => picked.has(c.id));
  // Pre-fill what's due now: the installment for a card on a plan, otherwise everything left on it.
  const pickedOwed = Math.round(pickedCards.reduce((n, c) => n + c.payNow, 0) * 100) / 100;
  const pickedLeft = Math.round(pickedCards.reduce((n, c) => n + c.left, 0) * 100) / 100;
  const [planCardId, setPlanCardId] = useState<string | null>(null);
  const cardsAmount = amountText === null ? pickedOwed : Number(amountText);
  const sfAmount = withSf ? Number(sfText || 0) : 0;
  const total = (Number.isFinite(cardsAmount) ? cardsAmount : 0) + (Number.isFinite(sfAmount) ? sfAmount : 0);

  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = (fn: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Something went wrong.");
      }
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pickedCards.length === 0 && !withSf) return setError("Tick the cards you paid for first.");
    if (!Number.isFinite(cardsAmount) || cardsAmount < 0) return setError("Enter a valid amount for your cards.");
    if (withSf && (!Number.isFinite(sfAmount) || sfAmount <= 0)) return setError("Enter the shipping fee you paid, or untick the shipping fee box.");
    if (total <= 0) return setError("Enter the amount you paid.");
    if (!file) return setError("Attach a screenshot of your payment.");

    const body = new FormData();
    body.set("customerId", customer.customerId);
    body.set("saleIds", JSON.stringify(pickedCards.map((c) => c.id)));
    body.set("cardsAmount", String(cardsAmount));
    body.set("sfAmount", String(sfAmount));
    body.set("method", method);
    body.set("note", note);
    body.set("proof", file);
    run(async () => {
      await portalSubmitClaim(body);
      setPicked(new Set());
      setAmountText(null);
      setWithSf(false);
      setNote("");
      setFile(null);
      setFileKey((k) => k + 1);
      setNotice("Sent! The seller will check your payment. Your line moves once it's confirmed.");
    });
  };

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

      {error && <p className="rounded-lg border border-sold/30 bg-sold-bg px-3 py-2 text-sm text-sold">{error}</p>}
      {notice && !error && <p className="rounded-lg border border-available/30 bg-available-bg px-3 py-2 text-sm text-available">{notice}</p>}

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
        <>
          {view.amountDue > 0 && <p className="text-xs text-foreground-muted">Tick the cards you paid for, then send your proof of payment below. Tick &quot;Ship&quot; on the cards you want sent to you.</p>}
          {view.lives.map((live) => (
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
                {live.cards.map((c) => {
                  const canPay = c.left > 0 && !c.underReview;
                  return (
                    <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                      <input
                        type="checkbox"
                        aria-label={`I paid for ${c.name}`}
                        title={canPay ? "Tick if you paid for this card" : c.underReview ? "Waiting for the seller to review your proof" : "Already paid"}
                        checked={picked.has(c.id)}
                        disabled={!canPay}
                        onChange={() => togglePick(c.id)}
                        className="h-4 w-4 rounded border-card-border accent-gold disabled:opacity-30"
                      />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="font-medium">{formatCurrency(c.amount)}</span>
                      {c.underReview ? (
                        <Badge tone="pending">Pending review</Badge>
                      ) : c.left <= 0 ? (
                        <Badge tone="available">Paid</Badge>
                      ) : c.paid > 0 ? (
                        <Badge tone="pending">{formatCurrency(c.left)} left</Badge>
                      ) : (
                        <Badge tone="neutral">Unpaid</Badge>
                      )}
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
                      {c.state === "PENDING" && (
                        <label className="flex items-center gap-1.5 text-xs text-foreground-muted">
                          <input
                            type="checkbox"
                            checked={c.wantsShipping}
                            disabled={pending}
                            onChange={(e) => run(() => portalSetShipping(customer.customerId, [c.id], e.target.checked))}
                            className="h-3.5 w-3.5 rounded border-card-border accent-gold"
                          />
                          Ship
                        </label>
                      )}
                      {c.plan?.status === "ACTIVE" && (
                        <div className="basis-full rounded-lg bg-foreground/5 px-3 py-2">
                          <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-medium">
                              <CalendarClock size={12} className="mr-1 inline" /> Installment plan
                            </span>
                            <span className="text-foreground-muted">
                              {formatCurrency(c.plan.paid)} of {formatCurrency(c.plan.total)}
                              {c.plan.overdue && <span className="ml-1 font-semibold text-sold">· overdue</span>}
                            </span>
                          </div>
                          <div
                            role="progressbar"
                            aria-valuenow={c.plan.total > 0 ? Math.round((c.plan.paid / c.plan.total) * 100) : 0}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${c.name} installment progress`}
                            className="mb-1.5 h-2 overflow-hidden rounded-full bg-foreground/10"
                          >
                            <div className={cn("h-full rounded-full", c.plan.complete ? "bg-available" : c.plan.overdue ? "bg-sold" : "bg-gold")} style={{ width: `${c.plan.total > 0 ? Math.min(100, (c.plan.paid / c.plan.total) * 100) : 0}%` }} />
                          </div>
                          <ul className="flex flex-wrap gap-1.5 text-xs">
                            {c.plan.installments.map((i) => (
                              <li
                                key={i.seq}
                                className={cn(
                                  "rounded-full border px-2 py-0.5",
                                  i.state === "PAID" && "border-available/40 text-available",
                                  i.state === "OVERDUE" && "border-sold/50 text-sold",
                                  i.state === "DUE" && "border-pending/50 text-pending",
                                  i.state === "UPCOMING" && "border-card-border text-foreground-muted",
                                )}
                              >
                                {i.state === "PAID" ? "✓ " : ""}
                                {formatCurrency(i.amount)} · {i.dueDate}
                                {i.state === "OVERDUE" && i.covered > 0 ? ` (${formatCurrency(i.amount - i.covered)} left)` : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {c.plan?.status === "REQUESTED" && (
                        <div className="flex basis-full flex-wrap items-center gap-2 text-xs">
                          <Badge tone="gold">Installment request sent</Badge>
                          <span className="text-foreground-muted">Waiting for the seller to approve.</span>
                          <button type="button" disabled={pending} onClick={() => run(() => portalWithdrawPlan(customer.customerId, c.id))} className="text-foreground-muted underline hover:text-sold">
                            Withdraw
                          </button>
                        </div>
                      )}
                      {c.plan?.status === "DECLINED" && c.left > 0 && <p className="basis-full text-xs text-sold">Installments weren&apos;t approved: {c.plan.declineReason}</p>}
                      {c.left > 0 && !c.underReview && (!c.plan || c.plan.status === "DECLINED") && (
                        <button type="button" onClick={() => setPlanCardId(c.id)} className="inline-flex items-center gap-1 text-xs text-gold hover:underline">
                          <CalendarClock size={12} /> Ask for installments
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </>
      )}

      {view.amountDue > 0 && (
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-card-border bg-card p-4">
          <h3 className="font-semibold">Send proof of payment</h3>
          <p className="text-xs text-foreground-muted">
            {pickedCards.length > 0
              ? `${pickedCards.length} card${pickedCards.length === 1 ? "" : "s"} ticked · ${formatCurrency(pickedLeft)} unpaid`
              : "Tick the cards you paid for above (or just the shipping fee below)."}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Amount paid for cards</label>
              <Input inputMode="decimal" value={amountText ?? (pickedOwed > 0 ? String(pickedOwed) : "")} onChange={(e) => setAmountText(cleanAmount(e.target.value))} placeholder="0" />
            </div>
            <div>
              <label className={label}>Method</label>
              <Select value={method} onChange={(e) => setMethod(e.target.value as "GCASH" | "MARIBANK")}>
                <option value="GCASH">GCash</option>
                <option value="MARIBANK">Maribank</option>
              </Select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={withSf} onChange={(e) => setWithSf(e.target.checked)} className="h-4 w-4 rounded border-card-border accent-gold" />
            I included my shipping fee
            {customer.shippingFee !== null && <span className="text-xs text-foreground-muted">({formatCurrency(customer.shippingFee)}{customer.shippingGroup ? ` · ${customer.shippingGroup}` : ""})</span>}
          </label>
          {withSf && (
            <div>
              <label className={label}>Shipping fee paid</label>
              <Input inputMode="decimal" value={sfText} onChange={(e) => setSfText(cleanAmount(e.target.value))} placeholder="0" />
            </div>
          )}
          <div>
            <label className={label}>Screenshot of your payment</label>
            <input
              key={fileKey}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-card-border file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:text-foreground"
            />
          </div>
          <div>
            <label className={label}>Note (optional)</label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-foreground-muted">
              Total sent: <span className="font-semibold text-foreground">{formatCurrency(total)}</span>
            </span>
            <Button type="submit" variant="gold" disabled={pending}>
              <Send size={14} /> {pending ? "Sending..." : "Send proof"}
            </Button>
          </div>
        </form>
      )}

      {view.claims.length > 0 && (
        <div className="rounded-2xl border border-card-border bg-card p-4">
          <h3 className="mb-2 font-semibold">Your payment proofs</h3>
          <ul className="divide-y divide-card-border text-sm">
            {view.claims.map((c) => (
              <li key={c.id} className="space-y-0.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-foreground-muted">{c.createdAt.slice(0, 10)}</span>
                  <span className="font-medium">{formatCurrency(c.cardsAmount + c.sfAmount)}</span>
                  {c.sfAmount > 0 && <span className="text-xs text-foreground-muted">(incl. shipping {formatCurrency(c.sfAmount)})</span>}
                  {c.status === "PENDING" && <Badge tone="pending">Waiting for review</Badge>}
                  {c.status === "CONFIRMED" && <Badge tone="available">Confirmed</Badge>}
                  {c.status === "REJECTED" && <Badge tone="sold">Not accepted</Badge>}
                </div>
                {c.cardNames.length > 0 && <p className="truncate text-xs text-foreground-muted">{c.cardNames.join(", ")}</p>}
                {c.status === "REJECTED" && c.rejectReason && <p className="text-xs text-sold">{c.rejectReason}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {planCardId &&
        (() => {
          const card = allCards.find((c) => c.id === planCardId);
          if (!card) return null;
          return (
            <Modal open onClose={() => setPlanCardId(null)} title={`Pay ${card.name} in installments`} className="max-w-lg">
              <p className="mb-3 text-sm text-foreground-muted">
                {card.name} is {formatCurrency(card.amount)}. Choose how you&apos;d like to pay it in parts. The seller will approve it or suggest changes. It only starts once approved.
              </p>
              <PlanEditor
                cardAmount={card.amount}
                submitLabel="Send request"
                pending={pending}
                noteLabel="Message to the seller (optional)"
                onSubmit={(installments, note) =>
                  run(async () => {
                    await portalRequestPlan(customer.customerId, card.id, installments, note);
                    setPlanCardId(null);
                    setNotice("Request sent! The seller will let you know.");
                  })
                }
                extra={
                  <Button type="button" variant="outline" onClick={() => setPlanCardId(null)}>
                    Cancel
                  </Button>
                }
              />
            </Modal>
          );
        })()}
    </section>
  );
}
