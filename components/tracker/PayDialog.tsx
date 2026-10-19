"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { recordPayments } from "@/app/tracker/actions";
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
}

/** Records one payment - optionally together with the shipping fee ("paid with SF"), saved as a cards part and a prepaid-shipping part in a single step. */
export function PayDialog(props: Props) {
  return (
    <Modal open={props.open} onClose={props.onClose} title={`Record payment - ${props.customer.name}`}>
      <PayDialogBody {...props} />
    </Modal>
  );
}

function PayDialogBody({ onClose, customer, balance, rates }: Props) {
  const defaultFee = shippingFeeFor(customer.islandGroup, rates);
  const [cards, setCards] = useState(balance > 0 ? String(balance) : "");
  const [withSf, setWithSf] = useState(false);
  const [sf, setSf] = useState(defaultFee === null ? "" : String(defaultFee));
  const [method, setMethod] = useState<"GCASH" | "MARIBANK">("GCASH");
  const [paidOn, setPaidOn] = useState(todayLocal);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const cardsAmount = cards.trim() === "" ? 0 : Number(cards);
  const sfAmount = withSf && sf.trim() !== "" ? Number(sf) : 0;
  const total = (Number.isFinite(cardsAmount) ? cardsAmount : 0) + (Number.isFinite(sfAmount) ? sfAmount : 0);

  const submit = () => {
    if (!Number.isFinite(cardsAmount) || cardsAmount < 0) return setError("Enter a valid amount for the cards.");
    if (withSf && (!Number.isFinite(sfAmount) || sfAmount <= 0)) return setError("Enter the shipping fee amount, or untick Paid with SF.");
    if (total <= 0) return setError("Enter the amount they paid.");
    setError(null);
    startTransition(async () => {
      try {
        await recordPayments({ customerId: customer.id, cardsAmount, shippingAmount: sfAmount, method, paidOn, note });
        onClose();
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Couldn't record the payment.");
      }
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground-muted">
        {balance > 0 ? (
          <>
            Currently owes <span className="font-semibold text-pending">{formatCurrency(balance)}</span>.
          </>
        ) : balance < 0 ? (
          <>
            Currently has a credit of <span className="font-semibold text-available">{formatCurrency(-balance)}</span>.
          </>
        ) : (
          "Nothing owed right now."
        )}
      </p>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className={label}>Amount paid for cards</label>
          {balance > 0 && (
            <button type="button" onClick={() => setCards(String(balance))} className="text-xs text-gold hover:underline">
              Paid in full ({formatCurrency(balance)})
            </button>
          )}
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
