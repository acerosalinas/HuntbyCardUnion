"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { deletePayout, recordPayout } from "@/app/tracker/paymentActions";
import type { TrackerPayout } from "@/lib/tracker/data";
import { handoverStatement, type HandoverCard } from "@/lib/tracker/handover";
import { sum } from "@/lib/tracker/money";
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
  liveDate: string;
  /** Owner code the money is for; null = cards with no owner. */
  recipientTag: string | null;
  recipientName: string;
  /** Collected so far on this owner's cards (the Actual column). */
  actual: number;
  distributed: number;
  payouts: TrackerPayout[];
  /** This owner's cards in the live with collected money not yet handed over, with who paid for each. */
  cards: HandoverCard[];
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
        <Modal open onClose={() => setOpen(false)} title={`Payment distributed - ${props.recipientName}`} className="max-w-2xl">
          <PayoutBody {...props} left={left} onClose={() => setOpen(false)} />
        </Modal>
      )}
    </>
  );
}

/** Shows a handover's cards grouped by who paid, with a Copy button for a plain-text statement. Used in the pop-up and the history list. */
export function HandoverDetails({ payout, recipientName, liveTitle, liveDate }: { payout: TrackerPayout; recipientName: string; liveTitle: string; liveDate: string }) {
  const [copied, setCopied] = useState(false);
  const byCustomer = useMemo(() => {
    const map = new Map<string, TrackerPayout["cards"]>();
    for (const c of payout.cards) map.set(c.customerName, [...(map.get(c.customerName) ?? []), c]);
    return [...map].sort((a, b) => a[0].localeCompare(b[0]));
  }, [payout.cards]);

  const copy = async () => {
    const text = handoverStatement({ recipientName, liveTitle, liveDate, paidOn: payout.paidOn, amount: payout.amount, note: payout.note, lines: payout.cards });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: nothing else to do.
    }
  };

  return (
    <div className="space-y-2 rounded-lg bg-foreground/5 p-3 text-sm">
      {byCustomer.length === 0 ? (
        <p className="text-xs text-foreground-muted">No card list was saved for this handover (it was recorded as just an amount).</p>
      ) : (
        <ul className="space-y-1.5">
          {byCustomer.map(([customer, lines]) => (
            <li key={customer}>
              <div className="flex justify-between gap-3 font-medium">
                <span>{customer}</span>
                <span>{formatCurrency(sum(lines.map((l) => l.amount)))}</span>
              </div>
              <ul className="ml-3 text-xs text-foreground-muted">
                {lines.map((l, i) => (
                  <li key={`${l.saleId ?? "x"}-${i}`} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">{l.cardName}</span>
                    <span>{formatCurrency(l.amount)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded-md border border-card-border px-2 py-0.5 text-xs text-foreground-muted hover:text-foreground">
        <Copy size={12} /> {copied ? "Copied" : "Copy statement"}
      </button>
    </div>
  );
}

function PayoutBody({ liveId, liveTitle, liveDate, recipientTag, recipientName, actual, distributed, payouts, cards, left, onClose }: Props & { left: number; onClose: () => void }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(cards.map((c) => c.saleId)));
  const [amount, setAmount] = useState(cards.length === 0 && left > 0 ? String(left) : "");
  const [paidOn, setPaidOn] = useState(todayLocal);
  const [note, setNote] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const pickedCards = cards.filter((c) => picked.has(c.saleId));
  const pickedTotal = sum(pickedCards.map((c) => c.available));
  // Older handovers were recorded as just an amount, so their money is not matched to any card.
  const legacy = sum(payouts.filter((p) => p.cards.length === 0).map((p) => p.amount));

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
    if (pickedCards.length > 0) {
      run(async () => {
        await recordPayout({ liveId, recipientTag, amount: pickedTotal, paidOn, note, saleIds: pickedCards.map((c) => c.saleId) });
        setPicked(new Set());
        setNote("");
      });
      return;
    }
    const value = Number(amount);
    if (amount.trim() === "" || !Number.isFinite(value) || value <= 0) return setError("Tick the cards you are handing over, or enter an amount.");
    run(async () => {
      await recordPayout({ liveId, recipientTag, amount: value, paidOn, note });
      setAmount("");
      setNote("");
    });
  };

  // Group the checklist by who paid.
  const grouped = useMemo(() => {
    const map = new Map<string, HandoverCard[]>();
    for (const c of cards) map.set(c.customerName, [...(map.get(c.customerName) ?? []), c]);
    return [...map];
  }, [cards]);

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

      {cards.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h4 className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Cards in this handover - tick what you are handing over</h4>
            <div className="flex gap-2 text-xs">
              <button type="button" className="text-foreground-muted hover:text-foreground" onClick={() => setPicked(new Set(cards.map((c) => c.saleId)))}>
                All
              </button>
              <button type="button" className="text-foreground-muted hover:text-foreground" onClick={() => setPicked(new Set())}>
                None
              </button>
            </div>
          </div>
          {legacy > 0 && (
            <p className="mb-1.5 rounded-md bg-pending/10 px-2 py-1 text-xs text-pending">
              {formatCurrency(legacy)} was handed over earlier without a card list, so some cards below may already be covered by it. Untick those.
            </p>
          )}
          <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-card-border p-2">
            {grouped.map(([customer, list]) => (
              <div key={customer}>
                <div className="flex justify-between text-xs font-semibold">
                  <span>Paid by {customer}</span>
                  <span>{formatCurrency(sum(list.filter((c) => picked.has(c.saleId)).map((c) => c.available)))}</span>
                </div>
                <ul className="mt-0.5">
                  {list.map((c) => (
                    <li key={c.saleId}>
                      <label className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
                        <input type="checkbox" checked={picked.has(c.saleId)} onChange={() => toggle(c.saleId)} className="h-4 w-4 accent-gold" />
                        <span className="min-w-0 flex-1 truncate">{c.cardName}</span>
                        {c.handed > 0 && <span className="text-[11px] text-foreground-muted">balance of {formatCurrency(c.paid)}</span>}
                        <span className="font-medium">{formatCurrency(c.available)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>{pickedCards.length > 0 ? "Total of ticked cards" : "Amount handed over"}</label>
          {pickedCards.length > 0 ? (
            <p className="rounded-lg border border-card-border bg-foreground/5 px-3 py-2 text-sm font-semibold">{formatCurrency(pickedTotal)}</p>
          ) : (
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" autoFocus />
          )}
        </div>
        <div>
          <label className={label}>Distribution date</label>
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
          <ul className="max-h-60 divide-y divide-card-border overflow-y-auto text-sm">
            {payouts.map((p) => (
              <li key={p.id} className="py-1.5">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setOpenId(openId === p.id ? null : p.id)} className="flex items-center gap-1 text-left" aria-expanded={openId === p.id}>
                    {openId === p.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="w-20 shrink-0 text-xs text-foreground-muted">{p.paidOn}</span>
                    <span className="font-medium">{formatCurrency(p.amount)}</span>
                    <span className="text-xs text-foreground-muted">{p.cards.length > 0 ? `${p.cards.length} card${p.cards.length === 1 ? "" : "s"}` : "no card list"}</span>
                  </button>
                  {p.note && <span className="min-w-0 flex-1 truncate text-xs text-foreground-muted">{p.note}</span>}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={async () => {
                      const ok = await confirm({
                        title: "Undo this handover?",
                        message: `${formatCurrency(p.amount)} on ${p.paidOn} will no longer count as given to ${recipientName}${p.cards.length > 0 ? ", and its cards become available to hand over again" : ""}.`,
                        confirmLabel: "Undo",
                        tone: "danger",
                      });
                      if (ok) run(() => deletePayout(p.id));
                    }}
                    className="ml-auto inline-flex items-center gap-1 rounded-md border border-card-border px-2 py-0.5 text-xs text-foreground-muted hover:border-sold/50 hover:text-sold disabled:opacity-40"
                  >
                    <Undo2 size={12} /> Undo
                  </button>
                </div>
                {openId === p.id && (
                  <div className="mt-1.5">
                    <HandoverDetails payout={p} recipientName={recipientName} liveTitle={liveTitle} liveDate={liveDate} />
                  </div>
                )}
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
