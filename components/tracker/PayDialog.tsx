"use client";

import { useState, useTransition } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { deletePayment, recordPayments, setPaymentLive } from "@/app/tracker/actions";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { TrackerLive, TrackerPayment } from "@/lib/tracker/data";
import { ISLAND_GROUP_LABELS, IslandGroup, ShippingRates, shippingFeeFor } from "@/lib/tracker/regions";
import { extractErrorMessage, formatCurrency } from "@/lib/utils";

const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted";

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const cleanAmount = (v: string) => {
  const cleaned = v.replace(/[^0-9.]/g, "");
  const dot = cleaned.indexOf(".");
  return dot === -1 ? cleaned : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "");
};

interface Props {
  open: boolean;
  onClose: () => void;
  customer: { id: string; name: string; islandGroup: IslandGroup | null };
  /** What the customer owes right now (negative = credit). Pre-fills the amount. */
  balance: number;
  rates: ShippingRates;
  /** The live whose order this is, so the payment can be tied to it - or null when opened without one. */
  live: { id: string; title: string } | null;
  /** What's still unpaid on that live's order (null when unknown). */
  liveDue: number | null;
  /** Still unpaid on the customer's other lives' cards. */
  otherLivesDue: number;
  /** Shipping fees already charged (parcels shipped) that haven't been paid. */
  shippingUnpaid: number;
  lives: TrackerLive[];
  /** Lives the customer actually has cards in - the choices when pointing a payment at a live. */
  customerLiveIds: string[];
  /** This customer's payments, newest first - each can be undone here. */
  payments: TrackerPayment[];
  /** Cards ticked on the customer page: this payment is recorded against exactly these, in this order. `left` = still unpaid. */
  selectedCards?: { id: string; name: string; amount: number; left: number }[];
}

/** Records one payment - optionally together with the shipping fee ("paid with SF"), saved as a cards part and a prepaid-shipping part in a single step. */
export function PayDialog(props: Props) {
  return (
    <Modal open={props.open} onClose={props.onClose} title={`Record payment - ${props.customer.name}`}>
      <PayDialogBody {...props} />
    </Modal>
  );
}

function PayDialogBody({ onClose, customer, balance, rates, payments, live, liveDue, otherLivesDue, shippingUnpaid, lives, customerLiveIds, selectedCards }: Props) {
  const confirm = useConfirm();
  const router = useRouter();
  const defaultFee = shippingFeeFor(customer.islandGroup, rates);
  // Customers often pay for one live only, so by default the payment is tied to this live's order.
  const [applyTo, setApplyTo] = useState<"LIVE" | "ANY">(live ? "LIVE" : "ANY");
  const selectedLeft = selectedCards && selectedCards.length > 0 ? Math.round(selectedCards.reduce((n, c) => n + c.left, 0) * 100) / 100 : null;
  const initialDue = selectedLeft ?? (live && liveDue !== null ? liveDue : balance);
  const [cards, setCards] = useState(initialDue > 0 ? String(initialDue) : "");
  // A shipping fee that's been charged but not paid is the usual reason a customer still "owes" after their cards are settled,
  // so it's pre-filled here instead of leaving it to be spotted.
  const [withSf, setWithSf] = useState(shippingUnpaid > 0);
  const [sf, setSf] = useState(shippingUnpaid > 0 ? String(shippingUnpaid) : defaultFee === null ? "" : String(defaultFee));
  const [method, setMethod] = useState<"GCASH" | "MARIBANK">("GCASH");
  const [paidOn, setPaidOn] = useState(todayLocal);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const cardsAmount = cards.trim() === "" ? 0 : Number(cards);
  const sfAmount = withSf && sf.trim() !== "" ? Number(sf) : 0;
  const total = (Number.isFinite(cardsAmount) ? cardsAmount : 0) + (Number.isFinite(sfAmount) ? sfAmount : 0);

  const undo = async (p: TrackerPayment) => {
    const ok = await confirm({
      title: "Undo this payment?",
      message: `${formatCurrency(p.amount)} ${p.method === "GCASH" ? "GCash" : "Maribank"} on ${p.paidOn}${p.purpose === "SHIPPING" ? " (shipping fee)" : ""} will be removed and ${customer.name}'s balance goes back up.`,
      confirmLabel: "Undo payment",
      tone: "danger",
    });
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      try {
        await deletePayment(p.id);
        router.refresh();
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Couldn't undo the payment.");
      }
    });
  };

  const reassign = (p: TrackerPayment, liveId: string) => {
    setError(null);
    startTransition(async () => {
      try {
        await setPaymentLive(p.id, liveId || null);
        router.refresh();
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Couldn't change the payment.");
      }
    });
  };

  const submit = () => {
    if (!Number.isFinite(cardsAmount) || cardsAmount < 0) return setError("Enter a valid amount for the cards.");
    if (withSf && (!Number.isFinite(sfAmount) || sfAmount <= 0)) return setError("Enter the shipping fee amount, or untick Paid with SF.");
    if (total <= 0) return setError("Enter the amount they paid.");
    setError(null);
    startTransition(async () => {
      try {
        // Spread the amount over the ticked cards in order; a smaller payment fully pays the first cards and part-pays the last.
        let remaining = cardsAmount;
        const allocations: { saleId: string; amount: number }[] = [];
        for (const c of selectedCards ?? []) {
          const part = Math.min(c.left, remaining);
          if (part > 0) allocations.push({ saleId: c.id, amount: Math.round(part * 100) / 100 });
          remaining = Math.round((remaining - part) * 100) / 100;
        }
        await recordPayments({
          customerId: customer.id,
          liveId: applyTo === "LIVE" && live ? live.id : null,
          cardsAmount,
          shippingAmount: sfAmount,
          method,
          paidOn,
          note,
          allocations,
        });
        onClose();
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Couldn't record the payment.");
      }
    });
  };

  return (
    <div className="space-y-4">
      {selectedCards && selectedCards.length > 0 && (
        <div className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm">
          <p className="mb-1 font-medium">
            Paying for {selectedCards.length} ticked card{selectedCards.length === 1 ? "" : "s"} · {formatCurrency(selectedLeft ?? 0)} unpaid
          </p>
          <ul className="max-h-24 space-y-0.5 overflow-y-auto text-xs text-foreground-muted">
            {selectedCards.map((c) => (
              <li key={c.id} className="flex justify-between gap-2">
                <span className="truncate">{c.name}</span>
                <span className="shrink-0">{formatCurrency(c.left)}{c.left < c.amount ? ` left of ${formatCurrency(c.amount)}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-1 text-sm text-foreground-muted">
        {live && liveDue !== null && (
          <p>
            {live.title} cards:{" "}
            {liveDue > 0 ? <span className="font-semibold text-pending">{formatCurrency(liveDue)} unpaid</span> : <span className="font-semibold text-available">paid in full</span>}
          </p>
        )}
        {otherLivesDue > 0 && (
          <p>
            Other lives: <span className="font-semibold text-pending">{formatCurrency(otherLivesDue)} unpaid</span>
          </p>
        )}
        {shippingUnpaid > 0 && (
          <p>
            Shipping fees: <span className="font-semibold text-pending">{formatCurrency(shippingUnpaid)} unpaid</span>
          </p>
        )}
        <p>
          Total:{" "}
          {balance > 0 ? (
            <span className="font-semibold text-pending">owes {formatCurrency(balance)}</span>
          ) : balance < 0 ? (
            <span className="font-semibold text-available">credit {formatCurrency(-balance)}</span>
          ) : (
            <span className="font-semibold text-available">nothing owed</span>
          )}
        </p>
      </div>

      {live && (
        <div>
          <label className={label}>This payment is for</label>
          <Select
            value={applyTo}
            onChange={(e) => {
              const next = e.target.value as "LIVE" | "ANY";
              setApplyTo(next);
              const due = next === "LIVE" && liveDue !== null ? liveDue : balance;
              setCards(due > 0 ? String(due) : "");
            }}
          >
            <option value="LIVE">{live.title} only</option>
            <option value="ANY">Whole balance (settles the oldest first)</option>
          </Select>
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className={label}>Amount paid for cards</label>
          {(() => {
            const due = selectedLeft ?? (applyTo === "LIVE" && liveDue !== null ? liveDue : balance);
            return (
              due > 0 && (
                <button type="button" onClick={() => setCards(String(due))} className="text-xs text-gold hover:underline">
                  Paid in full ({formatCurrency(due)})
                </button>
              )
            );
          })()}
        </div>
        <Input inputMode="decimal" value={cards} onChange={(e) => setCards(cleanAmount(e.target.value))} placeholder="0" autoFocus />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={withSf} onChange={(e) => setWithSf(e.target.checked)} className="h-4 w-4 rounded border-card-border accent-gold" />
        Paid with SF (shipping fee)
      </label>
      {withSf && (
        <div>
          <label className={label}>Shipping fee paid{customer.islandGroup ? ` (${ISLAND_GROUP_LABELS[customer.islandGroup]})` : ""}</label>
          <Input inputMode="decimal" value={sf} onChange={(e) => setSf(cleanAmount(e.target.value))} placeholder="0" />
          <p className="mt-1 text-xs text-foreground-muted">
            Kept as prepaid shipping - it&apos;s used automatically when you mark their parcel shipped.
            {customer.islandGroup === null && " (No region saved, so type the fee.)"}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Method</label>
          <Select value={method} onChange={(e) => setMethod(e.target.value as "GCASH" | "MARIBANK")}>
            <option value="GCASH">GCash</option>
            <option value="MARIBANK">Maribank</option>
          </Select>
        </div>
        <div>
          <label className={label}>Date</label>
          <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </div>
      </div>
      <div>
        <label className={label}>Note (optional)</label>
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </div>

      {payments.length > 0 && (
        <div className="border-t border-card-border pt-3">
          <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-foreground-muted">Payments so far</h4>
          <ul className="max-h-40 divide-y divide-card-border overflow-y-auto text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-1.5">
                <span className="w-20 shrink-0 text-xs text-foreground-muted">{p.paidOn}</span>
                <span className="font-medium">{formatCurrency(p.amount)}</span>
                <span className="text-xs text-foreground-muted">
                  {p.method === "GCASH" ? "GCash" : "Maribank"}
                  {p.purpose === "SHIPPING" && " · SF"}
                </span>
                {p.purpose === "CARDS" && (
                  <select
                    aria-label="This payment applies to"
                    value={p.liveId ?? ""}
                    disabled={pending}
                    onChange={(e) => reassign(p, e.target.value)}
                    className="max-w-[9rem] truncate rounded-md border border-card-border bg-background-elevated px-1.5 py-0.5 text-xs text-foreground"
                  >
                    <option value="">Any (oldest first)</option>
                    {lives
                      .filter((l) => customerLiveIds.includes(l.id) || l.id === p.liveId)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.title}
                        </option>
                      ))}
                  </select>
                )}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => undo(p)}
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-card-border px-2 py-0.5 text-xs text-foreground-muted hover:border-sold/50 hover:text-sold disabled:opacity-40"
                >
                  <Undo2 size={12} /> Undo
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="text-sm text-sold">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-foreground-muted">
          Total received: <span className="font-semibold text-foreground">{formatCurrency(total)}</span>
        </span>
        <div className="flex gap-2">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="gold" type="button" disabled={pending} onClick={submit}>
            Record payment
          </Button>
        </div>
      </div>
    </div>
  );
}
