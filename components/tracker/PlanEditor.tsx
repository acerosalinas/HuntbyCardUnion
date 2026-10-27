"use client";

import { ReactNode, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { splitEvenly, validateSchedule } from "@/lib/tracker/installments";
import { sum } from "@/lib/tracker/money";
import { cn, formatCurrency } from "@/lib/utils";

const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted";

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface Props {
  /** What the card costs - the payments must add up to exactly this. */
  cardAmount: number;
  /** Existing schedule to edit; omit to start from an even two-way split. */
  initial?: { dueDate: string; amount: number }[];
  initialNote?: string;
  submitLabel: string;
  pending: boolean;
  /** An error from the server to show under the form. */
  error?: string | null;
  onSubmit: (installments: { dueDate: string; amount: number }[], note: string) => void;
  /** Extra buttons next to Submit (Decline, Cancel plan...). */
  extra?: ReactNode;
  noteLabel?: string;
}

/** Edits a card's installment schedule: a date and amount per payment, with an even-split helper and a live check that they add up to the card price. */
export function PlanEditor({ cardAmount, initial, initialNote = "", submitLabel, pending, error, onSubmit, extra, noteLabel = "Note (optional)" }: Props) {
  const [rows, setRows] = useState<{ dueDate: string; amount: string }[]>(() =>
    (initial && initial.length >= 2 ? initial : splitEvenly(cardAmount, 2, todayLocal(), 7)).map((r) => ({ dueDate: r.dueDate, amount: String(r.amount) })),
  );
  const [count, setCount] = useState("2");
  const [interval, setIntervalDays] = useState("7");
  const [note, setNote] = useState(initialNote);
  const [localError, setLocalError] = useState<string | null>(null);

  const parsed = rows.map((r) => ({ dueDate: r.dueDate, amount: r.amount.trim() === "" ? 0 : Number(r.amount) }));
  const total = sum(parsed.map((r) => (Number.isFinite(r.amount) ? r.amount : 0)));
  const diff = Math.round((cardAmount - total) * 100) / 100;

  const setRow = (i: number, patch: Partial<{ dueDate: string; amount: string }>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = () => {
    const problem = validateSchedule(parsed, cardAmount);
    if (problem) return setLocalError(problem);
    setLocalError(null);
    onSubmit(parsed, note);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-card-border bg-foreground/5 p-2.5">
        <div>
          <label className={label}>Split into</label>
          <Select className="w-20" value={count} onChange={(e) => setCount(e.target.value)}>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className={label}>Every</label>
          <Select className="w-32" value={interval} onChange={(e) => setIntervalDays(e.target.value)}>
            <option value="7">week</option>
            <option value="14">2 weeks</option>
            <option value="30">month</option>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          className="px-3 py-2"
          onClick={() => setRows(splitEvenly(cardAmount, Number(count), rows[0]?.dueDate || todayLocal(), Number(interval)).map((r) => ({ dueDate: r.dueDate, amount: String(r.amount) })))}
        >
          Split evenly
        </Button>
      </div>

      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-5 text-center text-xs text-foreground-muted">{i + 1}</span>
            <Input type="date" value={r.dueDate} onChange={(e) => setRow(i, { dueDate: e.target.value })} aria-label={`Payment ${i + 1} date`} />
            <Input
              inputMode="decimal"
              value={r.amount}
              onChange={(e) => setRow(i, { amount: e.target.value.replace(/[^0-9.]/g, "") })}
              placeholder="0"
              aria-label={`Payment ${i + 1} amount`}
              className="w-32"
            />
            <button
              type="button"
              aria-label={`Remove payment ${i + 1}`}
              disabled={rows.length <= 2}
              onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
              className="rounded p-1.5 text-foreground-muted hover:text-sold disabled:opacity-30"
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={rows.length >= 12}
        onClick={() => {
          const last = rows[rows.length - 1];
          setRows((prev) => [...prev, { dueDate: last?.dueDate ?? todayLocal(), amount: diff > 0 ? String(diff) : "" }]);
        }}
        className="inline-flex items-center gap-1 text-xs text-gold hover:underline disabled:opacity-40"
      >
        <Plus size={12} /> Add a payment
      </button>

      <p className={cn("text-sm", Math.abs(diff) <= 0.01 ? "text-available" : "text-pending")}>
        {formatCurrency(total)} of {formatCurrency(cardAmount)}
        {Math.abs(diff) <= 0.01 ? " ✓" : diff > 0 ? ` · ${formatCurrency(diff)} still to assign` : ` · ${formatCurrency(-diff)} over`}
      </p>

      <div>
        <label className={label}>{noteLabel}</label>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </div>

      {(localError || error) && <p className="text-sm text-sold">{localError ?? error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="gold" disabled={pending} onClick={submit}>
          {submitLabel}
        </Button>
        {extra}
      </div>
    </div>
  );
}
