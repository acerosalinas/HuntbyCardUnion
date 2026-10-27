import { round2, sum } from "./money";

export interface OwnerLabel {
  code: string;
  name: string;
  /** Shown in the Dashboard graphs / progress bars. Missing = active, so owners saved before this existed keep working. */
  active?: boolean;
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

export interface SplitPayment {
  customerId: string;
  amount: number;
  /** The live this payment was made for, or null = not tied to a live. */
  liveId: string | null;
  purpose: "CARDS" | "SHIPPING";
  /** Cards this payment was explicitly recorded against (ticked when it was recorded). */
  allocations?: { saleId: string; amount: number }[];
}

/**
 * How much of each card has actually been paid, per customer:
 *  0. A payment recorded against specific cards (ticked when it was entered)
 *     pays exactly those cards, up to what each still needs. Whatever part of
 *     it couldn't be used there carries on below like an untargeted payment.
 *  1. A payment made FOR a live settles that live's cards first (oldest first
 *     within it). Anything beyond that live's total spills into the general pool.
 *  2. Payments not tied to a live join the pool too.
 *  3. The pool settles the customer's remaining cards oldest-first, so older
 *     lives are cleared before newer ones.
 * Only CARDS payments count here; shipping-fee payments only ever pay shipping.
 * Money beyond the customer's card total is simply not allocated to any card.
 */
export function allocateCardPayments(sales: SplitSale[], payments: SplitPayment[]): Map<string, number> {
  const paid = new Map<string, number>(sales.map((s) => [s.id, 0]));
  const byCustomer = new Map<string, SplitSale[]>();
  for (const s of sales) byCustomer.set(s.customerId, [...(byCustomer.get(s.customerId) ?? []), s]);

  const apply = (items: SplitSale[], amount: number): number => {
    let remaining = amount;
    for (const s of items) {
      const room = round2(s.amount - (paid.get(s.id) ?? 0));
      const applied = Math.min(room, Math.max(0, remaining));
      paid.set(s.id, round2((paid.get(s.id) ?? 0) + applied));
      remaining = round2(remaining - applied);
    }
    return remaining;
  };

  for (const [customerId, unsorted] of byCustomer) {
    const items = [...unsorted].sort((a, b) => a.order.localeCompare(b.order));
    const byId = new Map(items.map((s) => [s.id, s]));
    const mine = payments.filter((p) => p.customerId === customerId && p.purpose === "CARDS");

    // Step 0: explicit card allocations. What a payment couldn't place becomes its remainder.
    const remainders: { liveId: string | null; amount: number }[] = [];
    for (const p of mine) {
      let remaining = p.amount;
      for (const a of p.allocations ?? []) {
        const card = byId.get(a.saleId);
        if (!card) continue;
        const room = round2(card.amount - (paid.get(card.id) ?? 0));
        const applied = Math.min(room, a.amount, remaining);
        if (applied <= 0) continue;
        paid.set(card.id, round2((paid.get(card.id) ?? 0) + applied));
        remaining = round2(remaining - applied);
      }
      remainders.push({ liveId: p.liveId, amount: remaining });
    }

    let pool = sum(remainders.filter((r) => r.liveId === null).map((r) => r.amount));
    const liveIds = [...new Set(remainders.map((r) => r.liveId).filter((id): id is string => id !== null))];
    for (const liveId of liveIds) {
      const forLive = sum(remainders.filter((r) => r.liveId === liveId).map((r) => r.amount));
      pool = round2(pool + apply(items.filter((s) => s.liveId === liveId), forLive));
    }
    apply(items, pool);
  }
  return paid;
}

/** Cards and paid-so-far for every (customer, live) pair - what each live's order is worth and how much of it is settled. */
export function liveBalances(sales: SplitSale[], paid: Map<string, number>): Record<string, Record<string, { cards: number; paid: number }>> {
  const out: Record<string, Record<string, { cards: number; paid: number }>> = {};
  for (const s of sales) {
    const byLive = (out[s.customerId] ??= {});
    const entry = (byLive[s.liveId] ??= { cards: 0, paid: 0 });
    entry.cards = round2(entry.cards + s.amount);
    entry.paid = round2(entry.paid + (paid.get(s.id) ?? 0));
  }
  return out;
}

export interface SplitRow {
  /** null = cards with no owner tag. */
  code: string | null;
  name: string;
  expected: number;
  actual: number;
  /** Already handed to this owner (payouts). Filled in by the dashboard; 0 here. */
  distributed: number;
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
    distributed: 0,
  };
}

/** How much of a card is paid through payments recorded AGAINST it - the part "Mark unpaid" can take back. */
export function explicitlyPaid(saleId: string, payments: { purpose: "CARDS" | "SHIPPING"; allocations?: { saleId: string; amount: number }[] }[]): number {
  return sum(
    payments
      .filter((p) => p.purpose === "CARDS")
      .flatMap((p) => p.allocations ?? [])
      .filter((a) => a.saleId === saleId)
      .map((a) => a.amount),
  );
}
