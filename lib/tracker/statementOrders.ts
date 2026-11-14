import type { StatementOrder } from "./statement";

/**
 * The live part of a customer's statement: one order per live that still has a pending card, each with its cards, what's paid on them and -
 * for a card on an approved installment plan - what is due now and next. `liveIds`, when given, limits it to those lives (an invoice for just
 * the ticked ones). Shared by the customer page and the one-tap copy on the Customers list, so both say the same thing.
 */
export function statementOrders(input: {
  lives: { id: string; title: string; liveDate: string }[];
  pendingCards: { id: string; liveId: string; cardName: string; amount: number }[];
  paidOf: (saleId: string) => number;
  planFor: (saleId: string) => { dueNow: number; next: { dueDate: string; amount: number } | null } | null;
  liveIds?: Set<string>;
}): StatementOrder[] {
  return input.lives
    .filter((l) => (!input.liveIds || input.liveIds.size === 0 || input.liveIds.has(l.id)) && input.pendingCards.some((c) => c.liveId === l.id))
    .map((l) => ({
      liveTitle: l.title,
      liveDate: l.liveDate,
      cards: input.pendingCards
        .filter((c) => c.liveId === l.id)
        .map((c) => {
          const plan = input.planFor(c.id);
          return { cardName: c.cardName, amount: c.amount, paid: input.paidOf(c.id), plan: plan ? { dueNow: plan.dueNow, next: plan.next ? { dueDate: plan.next.dueDate, amount: plan.next.amount } : null } : undefined };
        }),
    }));
}
