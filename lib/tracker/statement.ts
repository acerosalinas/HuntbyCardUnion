import { formatCurrency } from "@/lib/utils";
import { round2, sum } from "./money";
import { ISLAND_GROUP_LABELS, IslandGroup } from "./regions";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-24" -> "Oct 24". Unambiguous either way round, unlike 10/24 vs 24/10. */
export function formatShortDate(isoDate: string): string {
  const [, m, d] = isoDate.split("-").map(Number);
  if (!m || !d) return isoDate;
  return `${MONTHS[m - 1] ?? ""} ${d}`;
}

export interface StatementOrder {
  liveTitle: string;
  liveDate: string;
  /** Every card of the customer in that live, with how much of it is already paid. */
  cards: {
    cardName: string;
    amount: number;
    paid: number;
    /** Set when the card is on an approved installment plan: only what's due now is billed, the rest is "upcoming". */
    plan?: { dueNow: number; next: { dueDate: string; amount: number } | null };
  }[];
}

/** One marketplace order on the statement (a card from the shop's listings, not from a live). */
export interface StatementMarketplaceItem {
  title: string;
  packNumber: number | null;
  amount: number;
}

export interface StatementInput {
  customerName: string;
  orders: StatementOrder[];
  /**
   * The customer's open marketplace orders. `unpaid` are pay-now orders still to be paid and are added to the total; `cod` are cash-on-delivery
   * orders, paid to the courier, so they are listed for information and left out of the total.
   */
  marketplace?: { unpaid: StatementMarketplaceItem[]; cod: StatementMarketplaceItem[] };
  /** Shipping fees already charged (parcels sent) and still unpaid. */
  shippingUnpaid: number;
  /** Cards flagged for shipping that haven't gone out - a parcel fee is quoted for them. */
  awaitingShipCount: number;
  shippingFee: number | null;
  islandGroup: IslandGroup | null;
  prepaidCredit: number;
  address: string | null;
  showAddress: boolean;
  paymentInstructions: string;
  qrLinks?: { label: string; url: string }[];
  /** Whether shipping fees go on the statement. Defaults to true; the screens pass false unless the user switches it on. */
  includeShipping?: boolean;
}

export interface PendingOrder {
  liveTitle: string;
  liveDate: string;
  /** Only cards that still have something left to pay. `left` < `amount` means partly paid. */
  lines: { cardName: string; amount: number; left: number; plan?: { remaining: number; next: { dueDate: string; amount: number } | null } }[];
  balance: number;
}

export interface Statement {
  orders: PendingOrder[];
  /** Installments on plan cards that aren't due yet - listed for information, not added to the total. */
  upcoming: { cardName: string; amount: number; dueDate: string }[];
  cardsDue: number;
  /** Pay-now marketplace orders still unpaid. */
  marketplace: StatementMarketplaceItem[];
  marketplaceDue: number;
  /** Cash-on-delivery orders: not part of the total. */
  cod: StatementMarketplaceItem[];
  shippingUnpaid: number;
  shippingFee: number | null;
  prepaidCovered: number;
  shippingDue: number;
  shippingUnknown: boolean;
  totalToPay: number;
}

/**
 * The customer's PENDING balance only: lives that are fully paid vanish, a
 * partly paid live keeps just the cards (or part of a card) still owed, and
 * oldest orders come first. Shipping is quoted once, for the parcel(s) still
 * to go out, net of any prepaid shipping credit.
 */
export function computeStatement(input: StatementInput): Statement {
  const upcoming: Statement["upcoming"] = [];
  const orders: PendingOrder[] = input.orders
    .map((o) => {
      const lines: PendingOrder["lines"] = [];
      for (const c of o.cards) {
        const remaining = round2(c.amount - c.paid);
        if (remaining <= 0) continue;
        if (c.plan) {
          // A plan card is billed only for what's due now; later installments are just announced.
          const dueNow = Math.min(remaining, Math.max(0, c.plan.dueNow));
          if (dueNow > 0) lines.push({ cardName: c.cardName, amount: c.amount, left: dueNow, plan: { remaining, next: c.plan.next } });
          else if (c.plan.next) upcoming.push({ cardName: c.cardName, amount: c.plan.next.amount, dueDate: c.plan.next.dueDate });
          if (dueNow > 0 && remaining > dueNow && c.plan.next) upcoming.push({ cardName: c.cardName, amount: c.plan.next.amount, dueDate: c.plan.next.dueDate });
          continue;
        }
        lines.push({ cardName: c.cardName, amount: c.amount, left: remaining });
      }
      return { liveTitle: o.liveTitle, liveDate: o.liveDate, lines, balance: sum(lines.map((l) => l.left)) };
    })
    .filter((o) => o.lines.length > 0)
    .sort((a, b) => a.liveDate.localeCompare(b.liveDate));

  const includeShipping = input.includeShipping !== false;
  const needsShipping = includeShipping && input.awaitingShipCount > 0;
  const shippingUnknown = needsShipping && input.shippingFee === null;
  const shippingFee = needsShipping && input.shippingFee !== null ? input.shippingFee : null;
  const prepaidCovered = shippingFee === null ? 0 : Math.min(input.prepaidCredit, shippingFee);
  const shippingDue = shippingFee === null ? 0 : round2(shippingFee - prepaidCovered);
  const cardsDue = sum(orders.map((o) => o.balance));
  const shippingUnpaid = includeShipping ? Math.max(0, input.shippingUnpaid) : 0;
  const marketplace = input.marketplace?.unpaid ?? [];
  const marketplaceDue = sum(marketplace.map((m) => m.amount));

  return {
    orders,
    upcoming,
    cardsDue,
    marketplace,
    marketplaceDue,
    cod: input.marketplace?.cod ?? [],
    shippingUnpaid,
    shippingFee,
    prepaidCovered,
    shippingDue,
    shippingUnknown,
    totalToPay: round2(cardsDue + marketplaceDue + shippingUnpaid + shippingDue),
  };
}

const itemLabel = (m: StatementMarketplaceItem) => `${m.title}${m.packNumber !== null ? ` (Pack #${m.packNumber})` : ""}`;

export function buildStatementText(input: StatementInput): string {
  const s = computeStatement(input);
  if (s.totalToPay <= 0 && !s.shippingUnknown) {
    const codLine = s.cod.length > 0 ? `\nCash on delivery (pay the courier): ${s.cod.map((m) => `${itemLabel(m)} - ${formatCurrency(m.amount)}`).join(", ")}` : "";
    if (s.upcoming.length === 0) return `Hi ${input.customerName}! You're all settled - no pending balance. Thank you!${codLine}`;
    const parts = s.upcoming.map((u) => `${u.cardName} - ${formatCurrency(u.amount)} on ${formatShortDate(u.dueDate)}`);
    return `Hi ${input.customerName}! Nothing is due right now. Your next installment${parts.length === 1 ? "" : "s"}:\n${parts.join("\n")}${codLine}`;
  }

  const lines: string[] = [`Hi ${input.customerName}! Here's your pending balance:`, ""];
  for (const o of s.orders) {
    lines.push(`${formatShortDate(o.liveDate)} order (${o.liveTitle}):`);
    o.lines.forEach((l, i) => {
      if (l.plan) {
        const more = l.plan.remaining > l.left ? ` - ${formatCurrency(l.plan.remaining - l.left)} more later` : "";
        lines.push(`${i + 1}. ${l.cardName} - ${formatCurrency(l.left)} due now (installment plan${more})`);
        return;
      }
      const partial = l.left < l.amount ? ` (${formatCurrency(l.left)} left of ${formatCurrency(l.amount)})` : "";
      lines.push(`${i + 1}. ${l.cardName} - ${partial ? formatCurrency(l.left) + partial : formatCurrency(l.amount)}`);
    });
    lines.push(`Order balance: ${formatCurrency(o.balance)}`, "");
  }

  if (s.marketplace.length > 0) {
    lines.push("Marketplace orders:");
    s.marketplace.forEach((m, i) => lines.push(`${i + 1}. ${itemLabel(m)} - ${formatCurrency(m.amount)}`));
    lines.push(`Marketplace balance: ${formatCurrency(s.marketplaceDue)}`, "");
  }

  if (s.upcoming.length > 0) {
    lines.push("Coming up:");
    for (const u of s.upcoming) lines.push(`- ${u.cardName}: ${formatCurrency(u.amount)} on ${formatShortDate(u.dueDate)}`);
    lines.push("");
  }
  if (s.shippingUnpaid > 0) lines.push(`Shipping fees (parcels sent): ${formatCurrency(s.shippingUnpaid)}`);
  if (s.shippingFee !== null) {
    const label = input.islandGroup ? ` (${ISLAND_GROUP_LABELS[input.islandGroup]})` : "";
    if (s.prepaidCovered >= s.shippingFee) lines.push(`Shipping${label}: ${formatCurrency(s.shippingFee)} - already prepaid`);
    else if (s.prepaidCovered > 0)
      lines.push(`Shipping${label}: ${formatCurrency(s.shippingFee)} (less prepaid ${formatCurrency(s.prepaidCovered)}) = ${formatCurrency(s.shippingDue)}`);
    else lines.push(`Shipping${label}: ${formatCurrency(s.shippingFee)}`);
  } else if (s.shippingUnknown) {
    lines.push("Shipping: to be confirmed (please send your address)");
  }
  lines.push(`TOTAL TO PAY: ${formatCurrency(s.totalToPay)}`);
  if (s.cod.length > 0) lines.push(`Cash on delivery (pay the courier, not in the total): ${s.cod.map((m) => `${itemLabel(m)} - ${formatCurrency(m.amount)}`).join(", ")}`);

  if (input.showAddress && input.address && input.includeShipping !== false && input.awaitingShipCount > 0) {
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
