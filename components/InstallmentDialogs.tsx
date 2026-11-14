"use client";

import { FormEvent, useMemo, useState } from "react";
import { CalendarClock, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { requestInstallmentPlan, submitInstallmentProof } from "@/app/account/installmentActions";
import { buildSchedule, PLAN_COUNTS } from "@/lib/claimInstallments";
import { formatShortDate } from "@/lib/tracker/statement";
import { cn, formatCurrency } from "@/lib/utils";

const localToday = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** The buyer picks how many weekly installments (2-4) and sees the dates and amounts before asking. The seller then approves or declines. */
export function InstallmentRequestDialog({ title, total, claimId, onClose, onRequested }: { title: string; total: number; claimId: string; onClose: () => void; onRequested: () => void }) {
  const [count, setCount] = useState<number>(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => buildSchedule(total, count, localToday()), [total, count]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await requestInstallmentPlan(claimId, count);
    setBusy(false);
    if (result.error) return setError(result.error);
    onRequested();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Pay in installments" className="max-w-md">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-foreground-muted">
          <span className="font-medium text-foreground">{title}</span> · {formatCurrency(total)}. Pay it in equal weekly payments, all within 4 weeks. The seller approves your plan first, and the card stays reserved for you until it&apos;s fully paid.
        </p>
        <div role="group" aria-label="Number of installments" className="grid grid-cols-3 gap-2">
          {PLAN_COUNTS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={count === n}
              onClick={() => setCount(n)}
              className={cn("rounded-lg border px-3 py-2 text-sm font-semibold transition-colors", count === n ? "border-gold bg-gold text-navy-950" : "border-card-border text-foreground-muted hover:border-gold/50 hover:text-foreground")}
            >
              {n} payments
            </button>
          ))}
        </div>
        {preview.installments ? (
          <ul className="divide-y divide-card-border rounded-xl border border-card-border text-sm">
            {preview.installments.map((i) => (
              <li key={i.seq} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="flex items-center gap-2 text-foreground-muted">
                  <CalendarClock size={14} aria-hidden="true" /> {i.seq === 1 ? "Today" : formatShortDate(i.dueDate)}
                </span>
                <span className="font-semibold tabular-nums">{formatCurrency(i.amount)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg bg-pending-bg px-3 py-2 text-sm text-pending">{preview.error}</p>
        )}
        {error && <p className="text-sm text-sold">{error}</p>}
        <Button type="submit" variant="gold" disabled={busy || !preview.installments} className="w-full">
          {busy ? "Sending..." : "Ask the seller to approve this plan"}
        </Button>
      </form>
    </Modal>
  );
}

/** Send a screenshot for one installment: how much it covers and the proof. It counts once the seller confirms it. */
export function InstallmentProofDialog({ title, claimId, suggested, most, onClose, onSent }: { title: string; claimId: string; suggested: number; most: number; onClose: () => void; onSent: () => void }) {
  const [amount, setAmount] = useState(String(Math.min(suggested, most)));
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return setError("Enter how much you paid.");
    if (value > most + 0.001) return setError(`That's more than what's left (${formatCurrency(most)}).`);
    if (!file) return setError("Attach a screenshot of your payment.");
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set("claimId", claimId);
    body.set("amount", String(value));
    body.set("note", note);
    body.set("proof", file);
    const result = await submitInstallmentProof(body);
    setBusy(false);
    if (result.error) return setError(result.error);
    onSent();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Send installment proof" className="max-w-md">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-foreground-muted">
          For <span className="font-medium text-foreground">{title}</span>. The seller checks the screenshot and confirms it; the amount counts once they do.
        </p>
        <div>
          <label htmlFor="installment-amount" className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
            Amount you paid
          </label>
          <Input id="installment-amount" type="number" inputMode="decimal" min={0.01} max={most} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <p className="mt-1 text-xs text-foreground-muted">Up to {formatCurrency(most)} (what&apos;s left, counting payments still waiting for the seller).</p>
        </div>
        <div>
          <label htmlFor="installment-file" className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
            Screenshot
          </label>
          <input
            id="installment-file"
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-card-border file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:text-foreground"
          />
        </div>
        <div>
          <label htmlFor="installment-note" className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
            Note (optional)
          </label>
          <Input id="installment-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. 2nd payment via GCash" />
        </div>
        {error && <p className="text-sm text-sold">{error}</p>}
        <Button type="submit" variant="gold" disabled={busy} className="w-full">
          <Send size={14} /> {busy ? "Sending..." : "Send proof"}
        </Button>
      </form>
    </Modal>
  );
}
