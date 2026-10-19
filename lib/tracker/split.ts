import { round2, sum } from "./money";

export interface OwnerLabel {
  code: string;
  name: string;
}

export const DEFAULT_OWNER_LABELS: OwnerLabel[] = [
  { code: "A", name: "AC" },
  { code: "S", name: "Shane" },
];

/** "a " -> "A"; empty -> null. Codes are stored upper-case so filters and labels always match. */
export function normalizeOwnerTag(tag: string | null | undefined): string | null {
  const t = (tag ?? "").trim().toUpperCase();
  return t === "" ? null : t;
}

export interface SplitSale {
  id: string;
  customerId: string;
  liveId: string;
  amount: number;
  ownerTag: string | null;
  /** Sortable chronological key (live date + entry time): older cards get paid first. */
  order: string;
}

/**
 * How much of each card has actually been paid. A customer's card payments
 * are applied to their cards oldest-first, so older cards are settled before
 * newer ones - the same order the invoice uses for "previous balance". A
 * payment beyond the customer's card total (e.g. one that also covered
 * shipping) is simply not allocated to any card.
 */
export function paidPerSale(sales: SplitSale[], cardPaidByCustomer: Record<string, number>): Map<string, number> {
  const paid = new Map<string, number>();
  const byCustomer = new Map<string, SplitSale[]>();
  for (const s of sales) byCustomer.set(s.customerId, [...(byCustomer.get(s.customerId) ?? []), s]);

  for (const [customerId, items] of byCustomer) {
    let remaining = cardPaidByCustomer[customerId] ?? 0;
    for (const s of [...items].sort((a, b) => a.order.localeCompare(b.order))) {
      const applied = Math.min(s.amount, Math.max(0, remaining));
      paid.set(s.id, round2(applied));
      remaining = round2(remaining - applied);
    }
  }
  return paid;
}

export interface SplitRow {
  /** null = cards with no owner tag. */
  code: string | null;
  name: string;
  expected: number;
  actual: number;
}

export interface LiveSplit {
  rows: SplitRow[];
  expectedTotal: number;
  actualTotal: number;
}

/** Expected (what the live's cards add up to) vs actual (what's been paid on them), per owner. Every configured owner always gets a row; untagged / unknown-code cards get their own. */
export function liveSplit(liveId: string, sales: SplitSale[], paid: Map<string, number>, labels: OwnerLabel[]): LiveSplit {
  const inLive = sales.filter((s) => s.liveId === liveId);
  const known = new Set(labels.map((l) => l.code));
  const rows: SplitRow[] = labels.map((l) => rowFor(l.code, l.name, inLive.filter((s) => s.ownerTag === l.code), paid));

  const unknownCodes = [...new Set(inLive.filter((s) => s.ownerTag !== null && !known.has(s.ownerTag)).map((s) => s.ownerTag as string))];
  for (const code of unknownCodes) rows.push(rowFor(code, code, inLive.filter((s) => s.ownerTag === code), paid));

  const untagged = inLive.filter((s) => s.ownerTag === null);
  if (untagged.length > 0) rows.push(rowFor(null, "Unassigned", untagged, paid));

  return {
    rows,
    expectedTotal: sum(rows.map((r) => r.expected)),
    actualTotal: sum(rows.map((r) => r.actual)),
  };
}

function rowFor(code: string | null, name: string, items: SplitSale[], paid: Map<string, number>): SplitRow {
  return {
    code,
    name,
    expected: sum(items.map((i) => i.amount)),
    actual: sum(items.map((i) => paid.get(i.id) ?? 0)),
  };
}
