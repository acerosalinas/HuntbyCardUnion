import { round2 } from "./money";

/**
 * Where the Live Tracker and the marketplace meet: a tracker customer linked to a marketplace account (tracker_customers.buyer_id)
 * is one person with two ledgers. These helpers are pure so the rules can be tested; the queries live in marketplaceData.ts.
 */

/** One of a linked buyer's marketplace orders (a card_claims row) on this seller's cards, not yet received. */
export interface MarketClaim {
  id: string;
  buyerId: string;
  orderId: string | null;
  title: string;
  packNumber: number | null;
  image: string | null;
  /** unit price x quantity */
  amount: number;
  /** PENDING = not paid yet, SOLD = paid. */
  status: "PENDING" | "SOLD";
  paymentMethod: "PREPAID" | "COD";
  fulfillment: "SHIP" | "STASH";
  shipped: boolean;
  shipRequestedAt: string | null;
  claimedAt: string;
  proofPath: string | null;
  proofNote: string | null;
  proofUploadedAt: string | null;
}

/** A paid marketplace order that is waiting to go out: to be shipped, or stashed with a ship request. Only these can ride in a tracker parcel. */
export const canShipWithParcel = (c: Pick<MarketClaim, "status" | "shipped" | "fulfillment" | "shipRequestedAt">) =>
  c.status === "SOLD" && !c.shipped && (c.fulfillment === "SHIP" || c.shipRequestedAt !== null);

export interface MarketplaceSummary {
  /** Pay-now orders not paid yet. */
  unpaid: number;
  unpaidCount: number;
  /** Cash-on-delivery orders: owed, but paid to the courier, so kept apart from what is chased. */
  cod: number;
  codCount: number;
  /** Paid orders ready to go out in a parcel. */
  readyToShip: MarketClaim[];
  /** Paid orders the seller is holding (stash, no ship request yet). */
  stashed: number;
}

export function marketplaceSummary(claims: MarketClaim[]): MarketplaceSummary {
  const pending = claims.filter((c) => c.status === "PENDING");
  const prepaid = pending.filter((c) => c.paymentMethod === "PREPAID");
  const cod = pending.filter((c) => c.paymentMethod === "COD");
  const paid = claims.filter((c) => c.status === "SOLD" && !c.shipped);
  return {
    unpaid: round2(prepaid.reduce((n, c) => n + c.amount, 0)),
    unpaidCount: prepaid.length,
    cod: round2(cod.reduce((n, c) => n + c.amount, 0)),
    codCount: cod.length,
    readyToShip: claims.filter(canShipWithParcel),
    stashed: paid.filter((c) => !canShipWithParcel(c)).length,
  };
}

/** What a linked customer owes in total: the live balance (never below 0 here - a live credit is not netted against marketplace orders) plus pay-now marketplace orders. */
export const combinedOwed = (liveBalance: number, summary: MarketplaceSummary) => round2(Math.max(0, liveBalance) + summary.unpaid);

export interface LinkSuggestion {
  customerId: string;
  customerName: string;
  buyerId: string;
  handle: string;
  fullName: string;
  /** What matched: the account's @handle, or its full name. */
  reason: "handle" | "name";
}

const norm = (s: string) => s.trim().toLowerCase().replace(/^@/, "").replace(/\s+/g, " ");

/**
 * Accounts that look like an unlinked customer: the customer's name equals the account's handle (spaces read as underscores) or its full name.
 * Only suggestions - never applied on their own, since linking hands the account that customer's whole ledger. A name that fits two accounts,
 * or an account that fits two customers, is left out as too ambiguous.
 */
export function suggestLinks(
  customers: { id: string; name: string; buyerId: string | null }[],
  profiles: { id: string; handle: string; fullName: string }[],
): LinkSuggestion[] {
  const linked = new Set(customers.map((c) => c.buyerId).filter((id): id is string => Boolean(id)));
  const free = profiles.filter((p) => !linked.has(p.id));
  const found: LinkSuggestion[] = [];
  for (const c of customers) {
    if (c.buyerId) continue;
    const name = norm(c.name);
    if (!name) continue;
    const asHandle = name.replace(/ /g, "_");
    const byHandle = free.filter((p) => norm(p.handle) === asHandle);
    const hits = byHandle.length > 0 ? byHandle : free.filter((p) => norm(p.fullName) === name);
    if (hits.length !== 1) continue;
    const p = hits[0];
    found.push({ customerId: c.id, customerName: c.name, buyerId: p.id, handle: p.handle, fullName: p.fullName, reason: byHandle.length > 0 ? "handle" : "name" });
  }
  const uses = new Map<string, number>();
  for (const f of found) uses.set(f.buyerId, (uses.get(f.buyerId) ?? 0) + 1);
  return found.filter((f) => uses.get(f.buyerId) === 1).sort((a, b) => a.customerName.localeCompare(b.customerName));
}
