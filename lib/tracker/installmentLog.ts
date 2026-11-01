import { round2 } from "./money";

export interface CardPaymentSummary {
  saleId: string;
  paid: number;
  left: number;
  /** Payments recorded against this card (ticked or via Add payment). */
  paymentCount: number;
  /** Date of the latest of those, or null when the card was only paid through general payments. */
  lastPaidOn: string | null;
  /** Separate chunks of money the card was paid in: recorded payments, plus one if general "oldest cards first" payments covered part of it. */
  parts: number;
}

/**
 * Per card that has any money on it: how much, how many payments, and when the last one was. A card's money can come from
 * payments recorded against it and from general payments that settle the oldest cards first, so `parts` counts both - a card
 * is "paid in installments" when it was paid in two or more parts.
 */
export function summarizeCardPayments(
  sales: { id: string; amount: number }[],
  payments: { purpose: string; paidOn: string; allocations: { saleId: string; amount: number }[] }[],
  paidBySale: Record<string, number>,
): CardPaymentSummary[] {
  const explicit = new Map<string, { count: number; total: number; last: string | null }>();
  for (const p of payments) {
    if (p.purpose !== "CARDS") continue;
    for (const a of p.allocations) {
      const cur = explicit.get(a.saleId) ?? { count: 0, total: 0, last: null };
      cur.count += 1;
      cur.total = round2(cur.total + a.amount);
      if (!cur.last || p.paidOn > cur.last) cur.last = p.paidOn;
      explicit.set(a.saleId, cur);
    }
  }

  const out: CardPaymentSummary[] = [];
  for (const sale of sales) {
    const paid = paidBySale[sale.id] ?? 0;
    if (paid <= 0) continue;
    const e = explicit.get(sale.id) ?? { count: 0, total: 0, last: null };
    out.push({
      saleId: sale.id,
      paid,
      left: round2(sale.amount - paid),
      paymentCount: e.count,
      lastPaidOn: e.last,
      parts: e.count + (round2(paid - e.total) > 0 ? 1 : 0),
    });
  }
  return out;
}
