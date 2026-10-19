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
  /** Positive = customer owes; negative = customer has credit. */
  balance: number;
  /** Prepaid shipping money not yet used by a shipment. */
  prepaidShippingCredit: number;
  cardCount: number;
  forShippingCount: number;
  /** For-shipping cards not yet shipped - a fee is expected when they go out. */
  awaitingShipCount: number;
  shippedCount: number;
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
    balance: round2(cardsTotal + shippingCharged - paid),
    prepaidShippingCredit: Math.max(0, round2(shippingPaid - shippingCharged)),
    cardCount: sales.length,
    forShippingCount: sales.filter((s) => s.forShipping).length,
    awaitingShipCount: sales.filter((s) => s.forShipping && !s.shipped).length,
    shippedCount: sales.filter((s) => s.shipped).length,
  };
}
