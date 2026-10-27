import { round2, sum } from "./money";

/**
 * Installment plans: one card, paid in parts on agreed dates (e.g. a ₱1,500
 * card as ₱750 today + ₱750 next week). A plan never holds money itself - the
 * card's normal payments (ticked cards, the Paid button, confirmed customer
 * proofs) pay the card, and the plan just reads how much the card has been
 * paid and fills the installments in order. So there's one source of truth for
 * money, and a plan can't drift out of step with the payments.
 */
export interface Installment {
  seq: number;
  /** YYYY-MM-DD */
  dueDate: string;
  amount: number;
}

export type InstallmentState = "PAID" | "OVERDUE" | "DUE" | "UPCOMING";

export interface InstallmentRow extends Installment {
  /** How much of this installment the card's payments so far have covered. */
  covered: number;
  state: InstallmentState;
}

export interface PlanEvaluation {
  rows: InstallmentRow[];
  total: number;
  paid: number;
  left: number;
  /** Owed right now: installments due today or earlier that aren't fully covered. */
  dueNow: number;
  /** The first installment not yet due that still has something to pay, or null. */
  next: { seq: number; dueDate: string; amount: number } | null;
  /** What to pre-fill when the customer pays: what's due now, or else the next installment. */
  payNext: number;
  overdue: boolean;
  complete: boolean;
  paidCount: number;
  count: number;
}

export function evaluatePlan(installments: Installment[], paidOnCard: number, today: string): PlanEvaluation {
  const sorted = [...installments].sort((a, b) => a.seq - b.seq);
  let remaining = Math.max(0, paidOnCard);
  const rows: InstallmentRow[] = sorted.map((i) => {
    const covered = Math.min(i.amount, remaining);
    remaining = round2(remaining - covered);
    const covers = round2(covered);
    const state: InstallmentState = covers >= i.amount ? "PAID" : i.dueDate < today ? "OVERDUE" : i.dueDate === today ? "DUE" : "UPCOMING";
    return { ...i, covered: covers, state };
  });

  const total = sum(rows.map((r) => r.amount));
  const paid = sum(rows.map((r) => r.covered));
  const dueNow = sum(rows.filter((r) => r.dueDate <= today).map((r) => round2(r.amount - r.covered)));
  const nextRow = rows.find((r) => r.state === "UPCOMING");
  const firstOpen = rows.find((r) => r.state !== "PAID");

  return {
    rows,
    total,
    paid,
    left: round2(total - paid),
    dueNow,
    next: nextRow ? { seq: nextRow.seq, dueDate: nextRow.dueDate, amount: round2(nextRow.amount - nextRow.covered) } : null,
    payNext: dueNow > 0 ? dueNow : firstOpen ? round2(firstOpen.amount - firstOpen.covered) : 0,
    overdue: rows.some((r) => r.state === "OVERDUE"),
    complete: rows.length > 0 && rows.every((r) => r.state === "PAID"),
    paidCount: rows.filter((r) => r.state === "PAID").length,
    count: rows.length,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns a message if the schedule isn't acceptable for a card of this price, else null. Used by the forms and again on the server. */
export function validateSchedule(installments: { dueDate: string; amount: number }[], cardAmount: number): string | null {
  if (installments.length < 2) return "An installment plan needs at least 2 payments.";
  if (installments.length > 12) return "A plan can have at most 12 payments.";
  for (const [index, i] of installments.entries()) {
    if (!ISO_DATE.test(i.dueDate)) return `Pick a date for payment ${index + 1}.`;
    if (!Number.isFinite(i.amount) || i.amount <= 0) return `Payment ${index + 1} must be more than zero.`;
  }
  for (let i = 1; i < installments.length; i++) {
    if (installments[i].dueDate < installments[i - 1].dueDate) return "Put the payments in date order.";
  }
  const total = sum(installments.map((i) => i.amount));
  if (Math.abs(total - cardAmount) > 0.01) return `The payments add up to ₱${total.toLocaleString("en-PH")} but the card is ₱${cardAmount.toLocaleString("en-PH")}.`;
  return null;
}

/** "2026-10-27" + 7 -> "2026-11-03" (calendar math in UTC, so daylight saving never shifts a date). */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** An even starting split: the first payment takes any odd centavos, dates are `intervalDays` apart starting at `firstDate`. */
export function splitEvenly(total: number, count: number, firstDate: string, intervalDays: number): { dueDate: string; amount: number }[] {
  const n = Math.max(1, Math.floor(count));
  const base = Math.floor((total / n) * 100) / 100;
  const first = round2(total - base * (n - 1));
  return Array.from({ length: n }, (_, i) => ({ dueDate: addDays(firstDate, i * intervalDays), amount: i === 0 ? first : base }));
}
