import { catalogImageUrl } from "@/lib/pokemonCatalog";
import { round2 } from "./money";

/** Everything we are holding for customers: Live Tracker cards not yet shipped or handed over, plus marketplace orders buyers chose to stash. */

export interface StashCustomerInput {
  id: string;
  name: string;
  /** Marketplace account this tracker customer is linked to, when it is. */
  buyerId: string | null;
}

export interface StashSaleInput {
  id: string;
  customerId: string;
  liveId: string;
  cardName: string;
  amount: number;
  forShipping: boolean;
  shipmentId: string | null;
  distributedAt: string | null;
  /** Raw catalog picture, when the card was picked from the catalog. */
  image?: string | null;
  createdAt: string;
}

export interface StashLiveInput {
  id: string;
  title: string;
  liveDate: string;
}

/** A marketplace order the buyer chose "Stash With Us" for (card_claims.fulfillment_method = STASH). */
export interface StashClaimInput {
  id: string;
  buyerId: string | null;
  buyerHandle: string;
  buyerName: string | null;
  title: string;
  setName: string | null;
  image: string | null;
  sellerHandle: string;
  quantity: number;
  unitPrice: number;
  /** PENDING = not paid yet, SOLD = paid. */
  status: "PENDING" | "SOLD";
  heldSince: string;
}

export interface StashItem {
  id: string;
  source: "LIVE" | "MARKETPLACE";
  name: string;
  /** Where it came from: the live and its date, or the marketplace seller. */
  origin: string;
  image: string | null;
  amount: number;
  unpaid: number;
  /** A live card the customer asked to have shipped (it is waiting for a parcel). */
  shipRequested: boolean;
  heldDays: number;
}

export interface StashCustomer {
  key: string;
  name: string;
  /** Tracker customer id when there is one (links to their page), else null. */
  customerId: string | null;
  items: StashItem[];
  cardCount: number;
  total: number;
  unpaid: number;
  oldestDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysSince = (iso: string, nowMs: number) => Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / DAY_MS));

/** Same rule the Distribution page uses: a live card is done once handed over (not shipping) or put in a parcel (shipping). */
export const isHeld = (s: Pick<StashSaleInput, "forShipping" | "shipmentId" | "distributedAt">) =>
  s.forShipping ? s.shipmentId === null : s.distributedAt === null;

export function buildStash(input: {
  customers: StashCustomerInput[];
  lives: StashLiveInput[];
  sales: StashSaleInput[];
  paidBySale: Record<string, number>;
  claims: StashClaimInput[];
  nowMs: number;
}): StashCustomer[] {
  const { customers, lives, sales, paidBySale, claims, nowMs } = input;
  const liveById = new Map(lives.map((l) => [l.id, l]));
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const customerByBuyer = new Map(customers.filter((c) => c.buyerId).map((c) => [c.buyerId as string, c]));

  const groups = new Map<string, StashCustomer>();
  const group = (key: string, name: string, customerId: string | null) => {
    let g = groups.get(key);
    if (!g) {
      g = { key, name, customerId, items: [], cardCount: 0, total: 0, unpaid: 0, oldestDays: 0 };
      groups.set(key, g);
    }
    return g;
  };

  for (const s of sales) {
    if (!isHeld(s)) continue;
    const customer = customerById.get(s.customerId);
    if (!customer) continue;
    const live = liveById.get(s.liveId);
    group(`c:${customer.id}`, customer.name, customer.id).items.push({
      id: s.id,
      source: "LIVE",
      name: s.cardName,
      origin: live ? `${live.title} · ${live.liveDate}` : "Live",
      image: catalogImageUrl(s.image ?? null),
      amount: s.amount,
      unpaid: round2(Math.max(0, s.amount - (paidBySale[s.id] ?? 0))),
      shipRequested: s.forShipping,
      heldDays: daysSince(s.createdAt, nowMs),
    });
  }

  for (const c of claims) {
    const linked = c.buyerId ? customerByBuyer.get(c.buyerId) : undefined;
    const g = linked
      ? group(`c:${linked.id}`, linked.name, linked.id)
      : group(`b:${c.buyerId ?? c.buyerHandle}`, c.buyerName?.trim() || c.buyerHandle, null);
    const amount = round2(c.unitPrice * c.quantity);
    g.items.push({
      id: c.id,
      source: "MARKETPLACE",
      name: c.quantity > 1 ? `${c.title} ×${c.quantity}` : c.title,
      origin: `Marketplace · ${c.sellerHandle}${c.setName ? ` · ${c.setName}` : ""}`,
      image: c.image,
      amount,
      unpaid: c.status === "PENDING" ? amount : 0,
      shipRequested: false,
      heldDays: daysSince(c.heldSince, nowMs),
    });
  }

  const result = [...groups.values()].filter((g) => g.items.length > 0);
  for (const g of result) {
    g.items.sort((a, b) => b.heldDays - a.heldDays);
    g.cardCount = g.items.length;
    g.total = round2(g.items.reduce((n, i) => n + i.amount, 0));
    g.unpaid = round2(g.items.reduce((n, i) => n + i.unpaid, 0));
    g.oldestDays = g.items.reduce((n, i) => Math.max(n, i.heldDays), 0);
  }
  return result.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
