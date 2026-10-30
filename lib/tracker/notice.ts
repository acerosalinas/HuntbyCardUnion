import { formatCurrency } from "@/lib/utils";
import { round2 } from "./money";

/** A customer who has cards in a live, as far as "tell them their invoice is ready" is concerned. */
export interface NoticeCandidate {
  customerId: string;
  name: string;
  /** Marketplace account they're linked to, or null (then they can't be notified in the app - you copy their invoice instead). */
  buyerId: string | null;
  cardCount: number;
  total: number;
  paid: number;
}

/** What was true the last time they were notified about this live. */
export interface PriorNotice {
  total: number;
  cardCount: number;
}

export interface NoticePlan {
  toNotify: NoticeCandidate[];
  /** Notified before and the invoice hasn't changed since - not told again. */
  unchanged: NoticeCandidate[];
  /** Nothing left to pay on this live, so there's nothing to chase. */
  paidUp: NoticeCandidate[];
  /** Not linked to an account. */
  unlinked: NoticeCandidate[];
}

/**
 * Decides who actually gets a notification. Pressing the button twice never
 * re-notifies someone whose invoice is the same; it only reaches people whose
 * cards or total changed since they were last told. `force` (used when you
 * press Notify on ONE customer) skips that check, because asking again for a
 * specific person is deliberate.
 */
export function planNotices(candidates: NoticeCandidate[], prior: Map<string, PriorNotice>, force = false): NoticePlan {
  const plan: NoticePlan = { toNotify: [], unchanged: [], paidUp: [], unlinked: [] };
  for (const c of candidates) {
    if (!c.buyerId) plan.unlinked.push(c);
    else if (round2(c.total - c.paid) <= 0) plan.paidUp.push(c);
    else {
      const before = prior.get(c.customerId);
      if (!force && before && Math.abs(before.total - c.total) < 0.005 && before.cardCount === c.cardCount) plan.unchanged.push(c);
      else plan.toNotify.push(c);
    }
  }
  return plan;
}

/** The bell notification the customer receives. */
export function invoiceReadyText(liveTitle: string, c: Pick<NoticeCandidate, "cardCount" | "total" | "paid">): { title: string; body: string } {
  const left = round2(c.total - c.paid);
  const cards = `${c.cardCount} card${c.cardCount === 1 ? "" : "s"}`;
  const paidPart = c.paid > 0 ? ` You've already paid ${formatCurrency(c.paid)}, so ${formatCurrency(left)} is left.` : "";
  return {
    title: `Your invoice for ${liveTitle} is ready`,
    body: `${cards} · ${formatCurrency(c.total)}.${paidPart} Open My Live Orders to see it and send your payment.`,
  };
}
