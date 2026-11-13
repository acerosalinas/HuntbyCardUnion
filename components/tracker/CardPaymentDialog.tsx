"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { deletePayment, recordPayments } from "@/app/tracker/paymentActions";
import type { TrackerPayment } from "@/lib/tracker/data";
import { PendingProofInfo, proofsWaitingFor, waitingProofText } from "@/lib/tracker/proofWarnings";
import { extractErrorMessage, formatCurrency } from "@/lib/utils";

const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted";
const round2 = (n: number) => Math.round(n * 100) / 100;

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
  onClose: () => void;
  customer: { id: string; name: string };
  card: { id: string; name: string; amount: number; paid: number; liveId: string };
  /** The customer's payments, any order; the ones recorded against this card are picked out here. */
  payments: TrackerPayment[];
  /** This customer's proofs still waiting for review: recording a payment on a card one of them covers would count it twice, so it asks first. */
  pendingProofs?: PendingProofInfo[];
}

/**
 * Pay one card in parts: enter what the customer just paid, the card flips to "Partially paid", and the same dialog
 * adds the next payment whenever it arrives. Every payment recorded against the card is listed (and can be undone).
 */
export function CardPaymentDialog(props: Props) {
  return (
    <Modal open onClose={props.onClose} title={`Payments - ${props.card.name}`} className="max-w-lg">
      <Body {...props} />
    </Modal>
  );
}

function Body({ onClose, customer, card, payments, pendingProofs }: Props) {
  const confirm = useConfirm();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const left = round2(card.amount - card.paid);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayLocal);
  const [method, setMethod] = useState<"GCASH" | "MARIBANK">("GCASH");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const history = payments
    .filter((p) => p.purpose === "CARDS" && p.allocations.some((a) => a.saleId === card.id))
    .sort((a, b) => b.paidOn.localeCompare(a.paidOn));
  const itemized = round2(history.reduce((n, p) => n + p.allocations.filter((a) => a.saleId === card.id).reduce((m, a) => m + a.amount, 0), 0));
  // Money that reached this card from general ("oldest cards first") payments isn't tied to it, so it can't be listed or undone here.
  const fromGeneral = round2(card.paid - itemized);
  const pct = card.amount > 0 ? Math.min(100, Math.round((card.paid / card.amount) * 100)) : 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return setError("Enter how much they paid.");
    if (value > left + 0.001) return setError(`That's more than the ${formatCurrency(left)} still owed on this card.`);
    const waiting = proofsWaitingFor(pendingProofs ?? [], { saleIds: [card.id] });
    if (waiting.length > 0 && !(await confirm({ title: "A payment proof is already waiting", message: waitingProofText(customer.name, waiting), confirmLabel: "Record anyway", tone: "danger" }))) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await recordPayments({
          customerId: customer.id,
          liveId: card.liveId,
          cardsAmount: value,
          shippingAmount: 0,
          method,
          paidOn,
          note,
          allocations: [{ saleId: card.id, amount: value }],
        });
        const remaining = round2(left - value);
        setNotice(remaining > 0 ? `Recorded ${formatCurrency(value)}. ${formatCurrency(remaining)} left on this card.` : `Recorded ${formatCurrency(value)}. This card is fully paid.`);
        setAmount("");
        setNote("");
        router.refresh();
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Couldn't record the payment.");
      }
    });
  };

  const undo = async (p: TrackerPayment) => {
    const mine = p.allocations.filter((a) => a.saleId === card.id).reduce((n, a) => n + a.amount, 0);
    const others = p.allocations.filter((a) => a.saleId !== card.id).length;
    const ok = await confirm({
      title: "Undo this payment?",
      message:
        `${formatCurrency(p.amount)} on ${p.paidOn} will be removed and ${customer.name}'s balance goes back up.` +
        (others > 0 ? ` It also paid ${others} other card${others === 1 ? "" : "s"}, which become${others === 1 ? "s" : ""} less paid too (${formatCurrency(mine)} of it was for this card).` : ""),
      confirmLabel: "Undo payment",
      tone: "danger",
    });
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      try {
        await deletePayment(p.id);
        setNotice(null);
        router.refresh();
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Couldn't undo the payment.");
      }
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-sm">
          {left <= 0 ? <Badge tone="available">Paid</Badge> : card.paid > 0 ? <Badge tone="pending">Partially paid</Badge> : <Badge tone="neutral">Unpaid</Badge>}
          <span className="text-foreground-muted">
            <span className="font-semibold tabular-nums text-foreground">{formatCurrency(card.paid)}</span> of{" "}
            <span className="font-semibold tabular-nums text-foreground">{formatCurrency(card.amount)}</span>
            {left > 0 && (
              <>
                {" "}
                · <span className="font-semibold tabular-nums text-pending">{formatCurrency(left)} left</span>
              </>
            )}
          </span>
        </div>
        <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Paid so far" className="h-2 overflow-hidden rounded-full bg-foreground/10">
          <div className={left <= 0 ? "h-full rounded-full bg-available" : "h-full rounded-full bg-gold"} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {left > 0 ? (
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-card-border p-3">
          <p className="text-sm font-semibold">Add a payment</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label htmlFor="card-pay-amount" className={label}>
                Amount paid
              </label>
              <Input
                id="card-pay-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(cleanAmount(e.target.value))}
                placeholder={`up to ${left}`}
                autoFocus
              />
              <button type="button" onClick={() => setAmount(String(left))} className="mt-1 text-xs text-foreground-muted underline underline-offset-2 hover:text-gold">
                Pay the rest ({formatCurrency(left)})
              </button>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label htmlFor="card-pay-date" className={label}>
                Date
              </label>
              <Input id="card-pay-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <div>
              <label htmlFor="card-pay-method" className={label}>
                Method
              </label>
              <Select id="card-pay-method" value={method} onChange={(e) => setMethod(e.target.value as "GCASH" | "MARIBANK")}>
                <option value="GCASH">GCash</option>
                <option value="MARIBANK">Maribank</option>
              </Select>
            </div>
            <div>
              <label htmlFor="card-pay-note" className={label}>
                Note (optional)
              </label>
              <Input id="card-pay-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. 2nd payment" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="gold" disabled={pending}>
              {pending ? "Saving…" : "Record payment"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-available/30 bg-available-bg px-3 py-2 text-sm text-available">
          <span>This card is fully paid.</span>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      )}

      {notice && (
        <p role="status" className="rounded-lg bg-available-bg px-3 py-2 text-sm text-available">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-sold/30 bg-sold-bg px-3 py-2 text-sm text-sold">
          {error}
        </p>
      )}

      <div>
        <p className="mb-1.5 text-sm font-semibold">
          Payment log <span className="text-xs font-normal text-foreground-muted">{history.length}</span>
        </p>
        {history.length === 0 && fromGeneral <= 0 ? (
          <p className="rounded-xl border border-dashed border-card-border px-3 py-4 text-center text-sm text-foreground-muted">No payments on this card yet.</p>
        ) : (
          <ul className="divide-y divide-card-border rounded-xl border border-card-border text-sm">
            {history.map((p) => {
              const mine = round2(p.allocations.filter((a) => a.saleId === card.id).reduce((n, a) => n + a.amount, 0));
              const shared = p.allocations.some((a) => a.saleId !== card.id);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="w-24 text-xs tabular-nums text-foreground-muted">{p.paidOn}</span>
                  <span className="font-medium tabular-nums">{formatCurrency(mine)}</span>
                  <span className="text-xs text-foreground-muted">{p.method === "GCASH" ? "GCash" : "Maribank"}</span>
                  {shared && <span className="text-xs text-foreground-muted">· part of a {formatCurrency(p.amount)} payment for several cards</span>}
                  {p.note && <span className="min-w-0 flex-1 truncate text-xs text-foreground-muted">“{p.note}”</span>}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => undo(p)}
                    className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-foreground-muted hover:text-sold disabled:opacity-40"
                  >
                    <Undo2 size={12} /> Undo
                  </button>
                </li>
              );
            })}
            {fromGeneral > 0 && (
              <li className="px-3 py-2 text-xs text-foreground-muted">
                <span className="font-medium tabular-nums text-foreground">{formatCurrency(fromGeneral)}</span> covered by {customer.name}&apos;s general payments (settled oldest cards first). Undo those from the customer&apos;s payment list.
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
