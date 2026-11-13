import { attributePayments, SplitSale } from "./split";

/** For every card: the payments that paid for it (date and amount of each whole payment), oldest first. Used to say which earlier payment already covers a card. */
export function paymentsCoveringSales(input: {
  sales: { id: string; customerId: string; liveId: string; amount: number; ownerTag: string | null; createdAt: string }[];
  liveDates: Map<string, string>;
  payments: { id: string; customerId: string; amount: number; liveId: string | null; purpose: "CARDS" | "SHIPPING"; allocations: { saleId: string; amount: number }[]; paidOn: string; createdAt: string }[];
  strict: boolean;
}): Map<string, { paymentId: string; paidOn: string; amount: number }[]> {
  const splitSales: SplitSale[] = input.sales.map((s) => ({ id: s.id, customerId: s.customerId, liveId: s.liveId, amount: s.amount, ownerTag: s.ownerTag, order: `${input.liveDates.get(s.liveId) ?? ""}|${s.createdAt}` }));
  const cardPayments = input.payments.filter((p) => p.purpose === "CARDS" && p.amount > 0);
  const attribution = attributePayments(
    splitSales,
    cardPayments.map((p) => ({ id: p.id, customerId: p.customerId, amount: p.amount, liveId: p.liveId, purpose: p.purpose, allocations: p.allocations, order: `${p.paidOn}|${p.createdAt}` })),
    { strict: input.strict },
  );
  const byPayment = new Map(cardPayments.map((p) => [p.id, p]));
  const out = new Map<string, { paymentId: string; paidOn: string; amount: number }[]>();
  for (const [paymentId, cards] of attribution) {
    const p = byPayment.get(paymentId);
    if (!p) continue;
    for (const saleId of cards.keys()) out.set(saleId, [...(out.get(saleId) ?? []), { paymentId, paidOn: p.paidOn, amount: p.amount }]);
  }
  for (const list of out.values()) list.sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  return out;
}
