import { round2, sum } from "./money";

/** A card whose collected money can go into a handover: who paid for it, how much was collected, how much is already handed over. */
export interface HandoverCard {
  saleId: string;
  cardName: string;
  customerName: string;
  /** Collected so far on this card. */
  paid: number;
  /** Already included in earlier handovers. */
  handed: number;
  /** paid - handed: what a new handover can still include for this card. */
  available: number;
}

/** One card line saved on a handover. */
export interface HandoverLine {
  saleId: string | null;
  cardName: string;
  customerName: string;
  amount: number;
}

interface SaleLike {
  id: string;
  customerId: string;
  liveId: string;
  cardName: string;
  ownerTag: string | null;
}

/**
 * The cards of one owner in one live that have collected money not yet handed over, grouped by customer so it is
 * easy to see who paid for what. A card paid only in part shows the part collected; the rest becomes available
 * again once the customer pays more.
 */
export function handoverCandidates(
  sales: SaleLike[],
  paidBySale: Record<string, number>,
  handedBySale: Record<string, number>,
  liveId: string,
  ownerCode: string | null,
  customerNameById: Map<string, string>,
): HandoverCard[] {
  return sales
    .filter((s) => s.liveId === liveId && s.ownerTag === ownerCode)
    .map((s) => {
      const paid = round2(paidBySale[s.id] ?? 0);
      const handed = round2(handedBySale[s.id] ?? 0);
      return {
        saleId: s.id,
        cardName: s.cardName,
        customerName: customerNameById.get(s.customerId) ?? "Customer",
        paid,
        handed,
        available: round2(paid - handed),
      };
    })
    .filter((c) => c.available > 0)
    .sort((a, b) => a.customerName.localeCompare(b.customerName) || a.cardName.localeCompare(b.cardName));
}

/** Money already handed over per card, from the saved handover lines. */
export function handedPerSale(lines: { saleId: string | null; amount: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) if (l.saleId) out[l.saleId] = round2((out[l.saleId] ?? 0) + l.amount);
  return out;
}

export interface HandoverRecord {
  recipientName: string;
  liveTitle: string;
  liveDate: string;
  paidOn: string;
  amount: number;
  note: string | null;
  lines: HandoverLine[];
}

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Plain text of a handover, for copying into a message: the date, the total, and each card with who paid for it. */
export function handoverStatement(h: HandoverRecord): string {
  const out = [`Handover to ${h.recipientName} - ${h.paidOn}`, `${h.liveTitle} (${h.liveDate})`, `Total: ${peso(h.amount)}`];
  if (h.lines.length === 0) {
    out.push("(no card list was saved for this handover)");
  } else {
    const byCustomer = new Map<string, HandoverLine[]>();
    for (const l of h.lines) byCustomer.set(l.customerName, [...(byCustomer.get(l.customerName) ?? []), l]);
    out.push("");
    for (const [customer, lines] of [...byCustomer].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push(`${customer} - ${peso(sum(lines.map((l) => l.amount)))}`);
      for (const l of lines) out.push(`  ${l.cardName} - ${peso(l.amount)}`);
    }
  }
  if (h.note) out.push("", `Note: ${h.note}`);
  return out.join("\n");
}
