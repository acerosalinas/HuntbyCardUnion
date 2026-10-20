/** Rounds to centavos so float drift (0.1 + 0.2) never leaks into a balance. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function sum(values: number[]): number {
  return round2(values.reduce((a, b) => a + b, 0));
}

export interface LedgerSale {
  amount: number;
  liveId: string;
  forShipping: boolean;
  shipped: boolean;
  /** Handed over (cards NOT flagged for shipping). Optional so shipping-only callers needn't pass it. */
  distributed?: boolean;
}
export interface LedgerPayment {
  amount: number;
  purpose: "CARDS" | "SHIPPING";
}
export interface LedgerShipment {
  fee: number;
}

export interface CustomerTotals {
  /** Everything sold to the customer. */
  cardsTotal: number;
  /** Shipping fees actually charged (a shipment exists). */
  shippingCharged: number;
  paid: number;
  /** Money paid specifically toward shipping fees (the "SF" part of payments). */
  shippingPaid: number;
  /** Positive = customer owes; negative = customer has credit. */
  balance: number;
  /** Prepaid shipping money not yet used by a shipment. */
  prepaidShippingCredit: number;
  cardCount: number;
  forShippingCount: number;
  /** For-shipping cards not yet shipped - a fee is expected when they go out. */
  awaitingShipCount: number;
  shippedCount: number;
  /** Not-for-shipping cards still to be handed over / already handed over. */
  toDistributeCount: number;
  distributedCount: number;
}

export function computeCustomerTotals(
  sales: LedgerSale[],
  payments: LedgerPayment[],
  shipments: LedgerShipment[],
): CustomerTotals {
  const cardsTotal = sum(sales.map((s) => s.amount));
  const shippingCharged = sum(shipments.map((s) => s.fee));
  const paid = sum(payments.map((p) => p.amount));
  const shippingPaid = sum(payments.filter((p) => p.purpose === "SHIPPING").map((p) => p.amount));
  return {
    cardsTotal,
    shippingCharged,
    paid,
    shippingPaid,
    balance: round2(cardsTotal + shippingCharged - paid),
    prepaidShippingCredit: Math.max(0, round2(shippingPaid - shippingCharged)),
    cardCount: sales.length,
    forShippingCount: sales.filter((s) => s.forShipping).length,
    awaitingShipCount: sales.filter((s) => s.forShipping && !s.shipped).length,
    shippedCount: sales.filter((s) => s.shipped).length,
    toDistributeCount: sales.filter((s) => !s.forShipping && !s.distributed).length,
    distributedCount: sales.filter((s) => !s.forShipping && s.distributed).length,
  };
}
