import { formatCurrency } from "@/lib/utils";
import { round2 } from "./money";

/**
 * Two ways the same payment can be counted twice, both of which showed up as a mysterious customer credit:
 *  1. a customer sends a proof, the seller marks the same invoice paid by hand, then confirms the proof too;
 *  2. a proof is confirmed for cards that were already paid some other way.
 * These helpers find both so the screen can warn BEFORE the second record is made. They only warn; nothing is blocked.
 */

/** A customer proof still waiting for review, reduced to what is needed to spot overlap. */
export interface PendingProofInfo {
  id: string;
  customerId: string;
  createdAt: string;
  cardsAmount: number;
  saleIds: string[];
  liveIds: string[];
}

/** The waiting proofs that cover what is about to be paid by hand: those sharing a ticked card, else those for the same live, else (no card or live picked) any. */
export function proofsWaitingFor(proofs: PendingProofInfo[], target: { saleIds?: string[]; liveId?: string | null }): PendingProofInfo[] {
  if (target.saleIds && target.saleIds.length > 0) {
    const wanted = new Set(target.saleIds);
    return proofs.filter((p) => p.saleIds.some((id) => wanted.has(id)));
  }
  if (target.liveId) return proofs.filter((p) => p.liveIds.includes(target.liveId as string));
  return proofs;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Manila" });

export function waitingProofText(customerName: string, proofs: PendingProofInfo[]): string {
  const list = proofs.map((p) => `${formatCurrency(p.cardsAmount)} sent ${day(p.createdAt)}`).join(", ");
  return `${customerName} already sent a payment proof that covers these cards (${list}) and it hasn't been reviewed yet. If you mark them paid here and then confirm that proof too, the same money is counted twice and ${customerName} will show a credit. Confirm the proof instead, or reject it first.`;
}

export interface ProofOverlap {
  /** How much of the proof is for cards that are already paid. */
  amount: number;
  cards: { name: string; alreadyPaid: number }[];
  /** The earlier payments that already covered those cards. */
  payments: { paidOn: string; amount: number }[];
}

/** For a proof about to be confirmed: how much of it pays cards that are already settled (null when none), and which earlier payments settled them. */
export function proofOverlap(input: {
  claimCards: { saleId: string; amount: number }[];
  sales: Map<string, { cardName: string; amount: number }>;
  paidBySale: Record<string, number>;
  coveredBy: Map<string, { paymentId: string; paidOn: string; amount: number }[]>;
}): ProofOverlap | null {
  let amount = 0;
  const cards: ProofOverlap["cards"] = [];
  const payments = new Map<string, { paidOn: string; amount: number }>();
  for (const c of input.claimCards) {
    const sale = input.sales.get(c.saleId);
    if (!sale) continue;
    const paid = input.paidBySale[c.saleId] ?? 0;
    const left = Math.max(0, round2(sale.amount - paid));
    const extra = round2(Math.max(0, c.amount - left));
    if (extra <= 0.004) continue;
    amount = round2(amount + extra);
    cards.push({ name: sale.cardName, alreadyPaid: Math.min(paid, sale.amount) });
    for (const p of input.coveredBy.get(c.saleId) ?? []) payments.set(p.paymentId, { paidOn: p.paidOn, amount: p.amount });
  }
  if (amount <= 0.004) return null;
  return { amount, cards, payments: [...payments.values()].sort((a, b) => a.paidOn.localeCompare(b.paidOn)) };
}

export function overlapText(customerName: string, o: ProofOverlap): string {
  const earlier = o.payments.length > 0 ? ` They were already paid by ${o.payments.map((p) => `${formatCurrency(p.amount)} on ${p.paidOn}`).join(" and ")}.` : "";
  return `${formatCurrency(o.amount)} of this proof is for cards ${customerName} has already paid for (${o.cards.slice(0, 3).map((c) => c.name).join(", ")}${o.cards.length > 3 ? ` and ${o.cards.length - 3} more` : ""}).${earlier} Confirming it would give ${customerName} a ${formatCurrency(o.amount)} credit.`;
}
