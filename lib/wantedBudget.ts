import { formatCurrency } from "@/lib/utils";

/** What a buyer says they're willing to spend on a wanted card: "Under ₱500" (a ceiling) or "Over ₱500" (they'd pay more for a better copy). */
export type BudgetType = "UNDER" | "OVER";

export const BUDGET_TYPE_LABEL: Record<BudgetType, string> = { UNDER: "Under", OVER: "Over" };

export const MAX_BUDGET = 10_000_000;

export interface Budget {
  type: BudgetType;
  amount: number;
}

/**
 * An empty amount means "no budget" (it's optional). Anything entered has to be a real amount above zero - 0 or a negative number is refused,
 * because "under ₱0" tells the seller nothing and is almost always a slip.
 */
export function parseBudget(typeRaw: string, amountRaw: string): { budget: Budget | null; error?: undefined } | { budget?: undefined; error: string } {
  const text = amountRaw.trim().replace(/,/g, "");
  if (text === "") return { budget: null };
  const amount = Number(text);
  if (!Number.isFinite(amount)) return { error: "Enter the budget as a number, like 500." };
  if (amount <= 0) return { error: "The budget has to be more than ₱0." };
  if (amount > MAX_BUDGET) return { error: "That budget is too large." };
  const type: BudgetType = typeRaw === "OVER" ? "OVER" : "UNDER";
  return { budget: { type, amount: Math.round(amount * 100) / 100 } };
}

/** "Under ₱500" / "Over ₱500", or null when the buyer gave no budget. */
export function budgetLabel(type: string | null | undefined, amount: number | string | null | undefined): string | null {
  const n = Number(amount);
  if (amount === null || amount === undefined || !Number.isFinite(n) || n <= 0) return null;
  return `${type === "OVER" ? "Over" : "Under"} ${formatCurrency(n)}`;
}
