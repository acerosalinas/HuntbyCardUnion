import { evaluatePlan, Installment, PlanEvaluation } from "@/lib/tracker/installments";
import { round2 } from "@/lib/tracker/money";

/**
 * Marketplace installments: how a plan is laid out and read. The money logic is the live tracker's (evaluatePlan): a plan never holds money
 * itself - the payments the seller has CONFIRMED fill the installments in order - so what's paid and what's due can't drift apart.
 */

/** A plan is 2 to 4 weekly payments, the last one no later than this many days after the first. */
export const PLAN_COUNTS = [2, 3, 4] as const;
export const PLAN_SPACING_DAYS = 7;
export const MAX_PLAN_DAYS = 28;
/** Smallest installment worth asking for: below this a plan is just noise. */
export const MIN_INSTALLMENT = 20;

export type PlanCount = (typeof PLAN_COUNTS)[number];

const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Equal weekly installments starting `start` (the first is due that day), the last one absorbing any rounding so they add up to the total.
 * Returns an error message when the plan can't be made: a count outside 2-4, or installments that would be below the minimum.
 */
export function buildSchedule(total: number, count: number, start: string): { installments: Installment[]; error?: undefined } | { installments?: undefined; error: string } {
  if (!(PLAN_COUNTS as readonly number[]).includes(count)) return { error: "Choose 2, 3 or 4 installments." };
  if (!Number.isFinite(total) || total <= 0) return { error: "There's nothing to split." };
  const each = Math.floor((total / count) * 100) / 100;
  if (each < MIN_INSTALLMENT) return { error: `Each installment would be under ₱${MIN_INSTALLMENT}. Pick fewer installments, or pay in full.` };
  const installments: Installment[] = [];
  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    installments.push({ seq: i + 1, dueDate: addDays(start, i * PLAN_SPACING_DAYS), amount: isLast ? round2(total - each * (count - 1)) : each });
  }
  if (installments.some((i) => i.amount <= 0)) return { error: "Those installments don't add up. Try a different number." };
  return { installments };
}

export interface ClaimPlanView {
  evaluation: PlanEvaluation;
  /** Confirmed so far. */
  paid: number;
  /** Still to pay in total. */
  left: number;
}

/** What a plan looks like given the payments the seller has CONFIRMED so far. */
export function readPlan(installments: Installment[], confirmedPaid: number, today: string): ClaimPlanView {
  const evaluation = evaluatePlan(installments, confirmedPaid, today);
  return { evaluation, paid: evaluation.paid, left: evaluation.left };
}

/** The most a buyer can send as an installment now: what's still unpaid after confirmed AND waiting payments, so the same money can't be sent twice. */
export function maxInstallmentPayment(total: number, confirmed: number, waiting: number): number {
  return Math.max(0, round2(total - confirmed - waiting));
}
