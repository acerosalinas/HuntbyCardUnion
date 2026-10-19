import { formatCurrency } from "@/lib/utils";
import { CustomerTotals, round2, sum } from "./money";
import { ISLAND_GROUP_LABELS, IslandGroup } from "./regions";

export interface InvoiceInput {
  customerName: string;
  liveTitle: string;
  /** This live's cards for the customer. */
  cards: { cardName: string; amount: number }[];
  /** Whole-ledger totals for the customer (all lives). */
  totals: CustomerTotals;
  /** Fee for one parcel to the customer's island group; null when the group is unknown. */
  shippingFee: number | null;
  islandGroup: IslandGroup | null;
  /** One-line address, or null when none is saved. */
  address: string | null;
  showAddress: boolean;
  paymentInstructions: string;
  /** Links to payment QR images, e.g. GCash / Maribank - appended so customers can tap to open them. */
  qrLinks?: { label: string; url: string }[];
}

export interface InvoiceBreakdown {
  liveTotal: number;
  previousBalance: number;
  /** Payments already received that reduce this live's total. */
  paymentsApplied: number;
  /** Quoted shipping fee, or null when none applies / the group is unknown. */
  shippingFee: number | null;
  prepaidCovered: number;
  shippingDue: number;
  shippingUnknown: boolean;
  totalToPay: number;
}

/**
 * Prepaid shipping credit is held apart from card payments: it can only pay
 * shipping, so it's removed from the payments that reduce card balances and
 * instead netted against the quoted shipping fee.
 */
export function computeInvoice(input: InvoiceInput): InvoiceBreakdown {
  const { totals } = input;
  const liveTotal = sum(input.cards.map((c) => c.amount));
  const effectivePayments = round2(totals.paid - totals.prepaidShippingCredit);
  const priorRaw = round2(totals.cardsTotal - liveTotal + totals.shippingCharged - effectivePayments);
  const previousBalance = Math.max(0, priorRaw);
  const paymentsApplied = priorRaw < 0 ? Math.min(-priorRaw, liveTotal) : 0;

  const needsShipping = totals.awaitingShipCount > 0;
  const shippingUnknown = needsShipping && input.shippingFee === null;
  const shippingFee = needsShipping && input.shippingFee !== null ? input.shippingFee : null;
  const prepaidCovered = shippingFee === null ? 0 : Math.min(totals.prepaidShippingCredit, shippingFee);
  const shippingDue = shippingFee === null ? 0 : round2(shippingFee - prepaidCovered);

  return {
    liveTotal,
    previousBalance,
    paymentsApplied,
    shippingFee,
    prepaidCovered,
    shippingDue,
    shippingUnknown,
    totalToPay: round2(Math.max(0, liveTotal - paymentsApplied + previousBalance) + shippingDue),
  };
}

export function buildInvoiceText(input: InvoiceInput): string {
  const b = computeInvoice(input);
  const lines: string[] = [];
  lines.push(`Hi ${input.customerName}! Here's your invoice for ${input.liveTitle}:`, "");
  input.cards.forEach((c, i) => lines.push(`${i + 1}. ${c.cardName} - ${formatCurrency(c.amount)}`));
  lines.push(`Cards total: ${formatCurrency(b.liveTotal)}`, "");

  if (b.shippingFee !== null) {
    const label = input.islandGroup ? ` (${ISLAND_GROUP_LABELS[input.islandGroup]})` : "";
    if (b.prepaidCovered >= b.shippingFee) {
      lines.push(`Shipping${label}: ${formatCurrency(b.shippingFee)} - already prepaid`);
    } else if (b.prepaidCovered > 0) {
      lines.push(
        `Shipping${label}: ${formatCurrency(b.shippingFee)} (less prepaid ${formatCurrency(b.prepaidCovered)}) = ${formatCurrency(b.shippingDue)}`,
      );
    } else {
      lines.push(`Shipping${label}: ${formatCurrency(b.shippingFee)}`);
    }
  } else if (b.shippingUnknown) {
    lines.push("Shipping: to be confirmed (please send your address)");
  }
  if (b.previousBalance > 0) lines.push(`Previous balance: ${formatCurrency(b.previousBalance)}`);
  if (b.paymentsApplied > 0) lines.push(`Payments received: -${formatCurrency(b.paymentsApplied)}`);
  lines.push(`TOTAL TO PAY: ${formatCurrency(b.totalToPay)}`);

  if (input.showAddress && input.address && input.totals.awaitingShipCount > 0) {
    lines.push("", `Ship to: ${input.customerName}, ${input.address}`);
  }
  const instructions = input.paymentInstructions.trim();
  if (instructions) lines.push("", instructions);
  const qr = (input.qrLinks ?? []).filter((q) => q.url);
  if (qr.length > 0) {
    lines.push("", "Scan to pay:");
    for (const q of qr) lines.push(q.label + " QR: " + q.url);
  }
  return lines.join("\n");
}
