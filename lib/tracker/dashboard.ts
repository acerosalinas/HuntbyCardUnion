import { round2, sum } from "./money";
import type { CustomerTotals } from "./money";
import type { IslandGroup } from "./regions";
import { LiveSplit, OwnerLabel, SplitRow, SplitSale, allocateCardPayments, liveSplit } from "./split";

export interface DateRange {
  /** Inclusive YYYY-MM-DD; undefined = open-ended. */
  from?: string;
  to?: string;
}

export interface DashboardInput {
  customers: { id: string; name: string; islandGroup: IslandGroup | null }[];
  lives: { id: string; title: string; liveDate: string }[];
  sales: SplitSale[];
  payments: { customerId: string; amount: number; method: "GCASH" | "MARIBANK"; purpose: "CARDS" | "SHIPPING"; paidOn: string; liveId: string | null; allocations?: { saleId: string; amount: number }[] }[];
  ownerLabels: OwnerLabel[];
  /** Money handed to card owners, per live. */
  payouts: { liveId: string; recipientTag: string | null; amount: number }[];
  shipments: { fee: number; shippedOn: string }[];
  totalsByCustomer: Record<string, CustomerTotals>;
}

export interface DashboardData {
  /** Range-based: what happened inside the date range. */
  soldInRange: number;
  cardsInRange: number;
  collectedInRange: number;
  shippingChargedInRange: number;
  parcelsInRange: number;
  livesInRange: number;
  perLive: { id: string; title: string; liveDate: string; total: number; cards: number; customers: number }[];
  /** Expected vs actual per owner, one entry per live in range, newest first. */
  splitPerLive: ({ id: string; title: string; liveDate: string; distributedTotal: number } & LiveSplit)[];
  byMethod: { GCASH: number; MARIBANK: number };
  recentPayments: { customerId: string; name: string; amount: number; method: "GCASH" | "MARIBANK"; paidOn: string }[];
  /** Point-in-time: where things stand right now, whatever the range. */
  outstandingNow: number;
  owingCount: number;
  topOwing: { id: string; name: string; balance: number }[];
  awaitingShipCards: number;
  shipQueue: { id: string; name: string; cards: number; islandGroup: IslandGroup | null }[];
}

export function inRange(date: string, range: DateRange): boolean {
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

export function computeDashboard(input: DashboardInput, range: DateRange): DashboardData {
  const nameById = new Map(input.customers.map((c) => [c.id, c.name]));
  const livesInRange = input.lives.filter((l) => inRange(l.liveDate, range));
  const liveIds = new Set(livesInRange.map((l) => l.id));
  const salesInRange = input.sales.filter((s) => liveIds.has(s.liveId));
  const paymentsInRange = input.payments.filter((p) => inRange(p.paidOn, range));
  const shipmentsInRange = input.shipments.filter((s) => inRange(s.shippedOn, range));

  const perLive = livesInRange
    .map((l) => {
      const items = input.sales.filter((s) => s.liveId === l.id);
      return {
        id: l.id,
        title: l.title,
        liveDate: l.liveDate,
        total: sum(items.map((i) => i.amount)),
        cards: items.length,
        customers: new Set(items.map((i) => i.customerId)).size,
      };
    })
    .sort((a, b) => a.liveDate.localeCompare(b.liveDate));

  const paid = allocateCardPayments(input.sales, input.payments);
  const splitPerLive = [...livesInRange]
    .sort((a, b) => b.liveDate.localeCompare(a.liveDate))
    .map((l) => {
      const split = liveSplit(l.id, input.sales, paid, input.ownerLabels);
      const rows = split.rows
        .map((r) => ({
          ...r,
          distributed: sum(input.payouts.filter((p) => p.liveId === l.id && p.recipientTag === r.code).map((p) => p.amount)),
        }))
        // A switched-off owner with nothing in this live (no cards, nothing collected, nothing handed over) isn't listed at all.
        // One who DOES have cards or money stays, so the tables still add up to the live's real total.
        .filter((r) => {
          const label = input.ownerLabels.find((o) => o.code === r.code);
          return !(label?.active === false && r.expected === 0 && r.actual === 0 && r.distributed === 0);
        });
      return { id: l.id, title: l.title, liveDate: l.liveDate, ...split, rows, distributedTotal: sum(rows.map((r) => r.distributed)) };
    });

  const owing = Object.entries(input.totalsByCustomer)
    .filter(([, t]) => t.balance > 0)
    .map(([id, t]) => ({ id, name: nameById.get(id) ?? "Customer", balance: t.balance }))
    .sort((a, b) => b.balance - a.balance);

  const shipQueue = input.customers
    .map((c) => ({ id: c.id, name: c.name, cards: input.totalsByCustomer[c.id]?.awaitingShipCount ?? 0, islandGroup: c.islandGroup }))
    .filter((c) => c.cards > 0)
    .sort((a, b) => b.cards - a.cards);

  return {
    soldInRange: sum(salesInRange.map((s) => s.amount)),
    cardsInRange: salesInRange.length,
    collectedInRange: sum(paymentsInRange.map((p) => p.amount)),
    shippingChargedInRange: sum(shipmentsInRange.map((s) => s.fee)),
    parcelsInRange: shipmentsInRange.length,
    livesInRange: livesInRange.length,
    perLive,
    splitPerLive,
    byMethod: {
      GCASH: sum(paymentsInRange.filter((p) => p.method === "GCASH").map((p) => p.amount)),
      MARIBANK: sum(paymentsInRange.filter((p) => p.method === "MARIBANK").map((p) => p.amount)),
    },
    recentPayments: paymentsInRange.slice(0, 8).map((p) => ({
      customerId: p.customerId,
      name: nameById.get(p.customerId) ?? "Customer",
      amount: p.amount,
      method: p.method,
      paidOn: p.paidOn,
    })),
    outstandingNow: round2(owing.reduce((s, o) => s + o.balance, 0)),
    owingCount: owing.length,
    topOwing: owing.slice(0, 5),
    awaitingShipCards: shipQueue.reduce((s, c) => s + c.cards, 0),
    shipQueue: shipQueue.slice(0, 8),
  };
}

export interface OwnerProgress {
  code: string;
  name: string;
  expected: number;
  actual: number;
  distributed: number;
}

/**
 * Expected / actual / given-out per ACTIVE owner, added up across the given
 * lives. Inactive owners are left out of the progress bars only - they still
 * appear in the split tables, so those totals keep adding up.
 */
export function ownerProgress(splits: { rows: SplitRow[] }[], labels: OwnerLabel[]): OwnerProgress[] {
  return labels
    .filter((l) => l.active !== false)
    .map((l) => {
      const rows = splits.map((sp) => sp.rows.find((r) => r.code === l.code)).filter((r): r is SplitRow => r !== undefined);
      return {
        code: l.code,
        name: l.name,
        expected: sum(rows.map((r) => r.expected)),
        actual: sum(rows.map((r) => r.actual)),
        distributed: sum(rows.map((r) => r.distributed)),
      };
    });
}
