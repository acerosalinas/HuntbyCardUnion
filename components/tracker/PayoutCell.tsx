"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { deletePayout, recordPayout } from "@/app/tracker/actions";
import type { TrackerPayout } from "@/lib/tracker/data";
import { extractErrorMessage, formatCurrency } from "@/lib/utils";

const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted";

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface Props {
  liveId: string;
  liveTitle: string;
  /** Owner code the money is for; null = cards with no owner. */
  recipientTag: string | null;
  recipientName: string;
  /** Collected so far on this owner's cards (the Actual column). */
  actual: number;
  distributed: number;
  payouts: TrackerPayout[];
}

/** One owner's "payment distributed" cell for a live: the amount handed over so far, and a dialog to record or undo handovers. */
export function PayoutCell(props: Props) {
  const [open, setOpen] = useState(false);
  const left = Math.round((props.actual - props.distributed) * 100) / 100;
  return (
    <>
      <div className="flex items-center justify-end gap-2">
        <span>{formatCurrency(props.distributed)}</span>
        {left > 0 ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md border border-gold/50 bg-gold/10 px-2 py-0.5 text-xs font-medium text-foreground hover:bg-gold/20"
          >
            Give {formatCurrency(left)}
          </button>
        ) : props.actual > 0 ? (
          <button type="button" onClick={() => setOpen(true)} aria-label="Distributed - view" className="text-available">
            <Check size={14} />
          </button>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="text-xs text-foreground-muted hover:text-foreground">
            Record
          </button>
        )}
      </div>
      {open && (
        <Modal open onClose={() => setOpen(false)} title={`Payment distributed - ${props.recipientName}`}>
          <PayoutBody {...props} left={left} onClose={() => setOpen(false)} />
        </Modal>
      )}
    </>
  );
}

function PayoutBody({ liveId, liveTitle, recipientTag, recipientName, actual, distributed, payouts, left, onClose }: Props & { left: number; onClose: () => void }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(left > 0 ? String(left) : "");
  const [paidOn, setPaidOn] = useState(todayLocal);
  const [note, setNote] = useState("");

  const run = (fn: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Something went wrong.");
      }
    });
  };

  const submit = () => {
    const value = Number(amount);
    if (amount.trim() === "" || !Number.isFinite(value) || value <= 0) return setError("Enter how much you handed over.");
    run(async () => {
      await recordPayout({ liveId, recipientTag, amount: value, paidOn, note });
      setAmount("");
      setNote("");
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground-muted">
        {liveTitle}: collected <span className="font-semibold text-foreground">{formatCurrency(actual)}</span> on {recipientName}&apos;s cards, handed over{" "}
        <span className="font-semibold text-foreground">{formatCurrency(distributed)}</span>
        {left > 0 ? (
          <>
            , <span className="font-semibold text-pending">{formatCurrency(left)} still to give</span>.
          </>
        ) : left < 0 ? (
          <>
            , <span className="font-semibold text-pending">{formatCurrency(-left)} more than collected</span>.
          </>
        ) : (
          <>
            . <span className="font-semibold text-available">All handed over.</span>
          </>
        )}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Amount handed over</label>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0"
            autoFocus
          />
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

      {payouts.length > 0 && (
        <div className="border-t border-card-border pt-3">
          <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-foreground-muted">Handed over so far</h4>
          <ul className="max-h-40 divide-y divide-card-border overflow-y-auto text-sm">
            {payouts.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-1.5">
                <span className="w-20 shrink-0 text-xs text-foreground-muted">{p.paidOn}</span>
                <span className="font-medium">{formatCurrency(p.amount)}</span>
                {p.note && <span className="min-w-0 flex-1 truncate text-xs text-foreground-muted">{p.note}</span>}
                <button
                  type="button"
                  disabled={pending}
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Undo this handover?",
                      message: `${formatCurrency(p.amount)} on ${p.paidOn} will no longer count as given to ${recipientName}.`,
                      confirmLabel: "Undo",
                      tone: "danger",
                    });
                    if (ok) run(() => deletePayout(p.id));
                  }}
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
      <div className="flex justify-end gap-2">
        <Button variant="outline" type="button" onClick={onClose}>
          Close
        </Button>
        <Button variant="gold" type="button" disabled={pending} onClick={submit}>
          Record handover
        </Button>
      </div>
    </div>
  );
}
