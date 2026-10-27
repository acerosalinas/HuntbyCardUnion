import { round2, sum } from "./money";
import { allocateCardPayments, SplitPayment, SplitSale } from "./split";
import { evaluatePlan, Installment, InstallmentState } from "./installments";

/**
 * What a customer is allowed to see of their own tracker data. This is the
 * ONLY shape that reaches the portal page: it deliberately has no owner tags,
 * no other customers, no address, no payment methods, no payouts - so nothing
 * private can leak just because the portal page forgot to hide a field.
 */
export type PortalCardState = "PENDING" | "SHIPPED" | "HANDED_OVER";

export interface PortalPlan {
  status: "REQUESTED" | "ACTIVE" | "DECLINED";
  declineReason: string | null;
  /** The schedule (for a request, what the customer proposed). `covered` is how much of each the card's payments have filled. */
  installments: { seq: number; dueDate: string; amount: number; covered: number; state: InstallmentState }[];
  total: number;
  paid: number;
  dueNow: number;
  overdue: boolean;
  complete: boolean;
}

export interface PortalCard {
  id: string;
  name: string;
  amount: number;
  paid: number;
  left: number;
  state: PortalCardState;
  /** Date the parcel went out, when state is SHIPPED. */
  shippedOn: string | null;
  /** Marked for shipping (by you or by the customer) and not shipped yet. */
  wantsShipping: boolean;
  /** Covered by a proof of payment the seller hasn't reviewed yet. */
  underReview: boolean;
  /** What to pre-fill when paying this card: the installment due (or next), else everything left. */
  payNow: number;
  /** The card's installment plan or pending request, if any. */
  plan: PortalPlan | null;
}

export type PortalClaimStatus = "PENDING" | "CONFIRMED" | "REJECTED";

export interface PortalClaim {
  id: string;
  status: PortalClaimStatus;
  cardsAmount: number;
  sfAmount: number;
  createdAt: string;
  rejectReason: string | null;
  cardNames: string[];
}

export interface PortalLive {
  id: string;
  title: string;
  liveDate: string;
  cards: PortalCard[];
  total: number;
  paid: number;
  left: number;
}

export interface PortalView {
  lives: PortalLive[];
  cardsTotal: number;
  cardsPaid: number;
  cardsLeft: number;
  /** Shipping fees already charged (a parcel went out) and not paid yet. */
  shippingUnpaid: number;
  /** Everything they currently owe: unpaid cards plus unpaid shipping fees. */
  amountDue: number;
  /** Share of their cards that's paid, 0-100. Moves only when a payment is recorded. */
  progressPct: number;
  /** Their proofs of payment, newest first (the last few). */
  claims: PortalClaim[];
}

export interface PortalInput {
  sales: {
    id: string;
    customerId: string;
    liveId: string;
    cardName: string;
    amount: number;
    forShipping: boolean;
    shipmentId: string | null;
    distributedAt: string | null;
    createdAt: string;
  }[];
  lives: { id: string; title: string; liveDate: string }[];
  payments: {
    customerId: string;
    amount: number;
    purpose: "CARDS" | "SHIPPING";
    liveId: string | null;
    allocations: { saleId: string; amount: number }[];
  }[];
  shipments: { id: string; fee: number; shippedOn: string }[];
  /** Proofs of payment the customer sent. Optional so callers without the feature still work. */
  plans?: { saleId: string; status: "REQUESTED" | "ACTIVE" | "DECLINED"; declineReason: string | null; installments: Installment[] }[];
  /** Today as YYYY-MM-DD (Philippine time by default); injectable so tests are stable. */
  today?: string;
  claims?: { id: string; status: PortalClaimStatus; cardsAmount: number; sfAmount: number; createdAt: string; rejectReason: string | null; saleIds: string[] }[];
}

export function buildPortalView(input: PortalInput): PortalView {
  const liveById = new Map(input.lives.map((l) => [l.id, l]));
  const shipmentById = new Map(input.shipments.map((s) => [s.id, s]));

  const splitSales: SplitSale[] = input.sales.map((s) => ({
    id: s.id,
    customerId: s.customerId,
    liveId: s.liveId,
    amount: s.amount,
    ownerTag: null,
    order: `${liveById.get(s.liveId)?.liveDate ?? ""}|${s.createdAt}`,
  }));
  const splitPayments: SplitPayment[] = input.payments.map((p) => ({
    customerId: p.customerId,
    amount: p.amount,
    liveId: p.liveId,
    purpose: p.purpose,
    allocations: p.allocations,
  }));
  const paidMap = allocateCardPayments(splitSales, splitPayments);
  const claims = input.claims ?? [];
  const today = input.today ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const planBySale = new Map((input.plans ?? []).map((pl) => [pl.saleId, pl]));
  const underReviewIds = new Set(claims.filter((c) => c.status === "PENDING").flatMap((c) => c.saleIds));

  const cards = input.sales.map((s): PortalCard & { liveId: string; createdAt: string } => {
    const paid = paidMap.get(s.id) ?? 0;
    const shipment = s.shipmentId ? shipmentById.get(s.shipmentId) : undefined;
    const state: PortalCardState = s.shipmentId ? "SHIPPED" : s.distributedAt ? "HANDED_OVER" : "PENDING";
    return {
      id: s.id,
      name: s.cardName,
      amount: s.amount,
      paid,
      left: Math.max(0, round2(s.amount - paid)),
      state,
      shippedOn: shipment?.shippedOn ?? null,
      wantsShipping: s.forShipping && state === "PENDING",
      underReview: underReviewIds.has(s.id),
      payNow: 0,
      plan: null,
      liveId: s.liveId,
      createdAt: s.createdAt,
    };
  });

  for (const c of cards) {
    const pl = planBySale.get(c.id);
    c.payNow = c.left;
    if (!pl) continue;
    if (pl.status === "ACTIVE") {
      const ev = evaluatePlan(pl.installments, c.paid, today);
      c.plan = {
        status: "ACTIVE",
        declineReason: null,
        installments: ev.rows.map((r) => ({ seq: r.seq, dueDate: r.dueDate, amount: r.amount, covered: r.covered, state: r.state })),
        total: ev.total,
        paid: ev.paid,
        dueNow: ev.dueNow,
        overdue: ev.overdue,
        complete: ev.complete,
      };
      c.payNow = Math.min(c.left, ev.payNext > 0 ? ev.payNext : c.left);
    } else {
      c.plan = {
        status: pl.status,
        declineReason: pl.declineReason,
        installments: [...pl.installments].sort((a, b) => a.seq - b.seq).map((r) => ({ seq: r.seq, dueDate: r.dueDate, amount: r.amount, covered: 0, state: "UPCOMING" as const })),
        total: round2(pl.installments.reduce((n, r) => n + r.amount, 0)),
        paid: 0,
        dueNow: 0,
        overdue: false,
        complete: false,
      };
    }
  }

  const lives: PortalLive[] = [...liveById.values()]
    .sort((a, b) => a.liveDate.localeCompare(b.liveDate))
    .map((l) => {
      const liveCards = cards
        .filter((c) => c.liveId === l.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        // Strip the helper fields so only PortalCard's own fields are exposed.
        .map((c) => ({
          id: c.id,
          name: c.name,
          amount: c.amount,
          paid: c.paid,
          left: c.left,
          state: c.state,
          shippedOn: c.shippedOn,
          wantsShipping: c.wantsShipping,
          underReview: c.underReview,
          payNow: c.payNow,
          plan: c.plan,
        }));
      return {
        id: l.id,
        title: l.title,
        liveDate: l.liveDate,
        cards: liveCards,
        total: sum(liveCards.map((c) => c.amount)),
        paid: sum(liveCards.map((c) => c.paid)),
        left: sum(liveCards.map((c) => c.left)),
      };
    })
    .filter((l) => l.cards.length > 0);

  const cardsTotal = sum(lives.map((l) => l.total));
  const cardsPaid = sum(lives.map((l) => l.paid));
  const cardsLeft = sum(lives.map((l) => l.left));
  const shippingCharged = sum(input.shipments.map((s) => s.fee));
  const shippingPaid = sum(input.payments.filter((p) => p.purpose === "SHIPPING").map((p) => p.amount));
  const shippingUnpaid = Math.max(0, round2(shippingCharged - shippingPaid));

  return {
    lives,
    cardsTotal,
    cardsPaid,
    cardsLeft,
    shippingUnpaid,
    amountDue: round2(cardsLeft + shippingUnpaid),
    progressPct: cardsTotal > 0 ? Math.min(100, Math.round((cardsPaid / cardsTotal) * 100)) : 0,
    claims: [...claims]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8)
      .map((c) => ({
        id: c.id,
        status: c.status,
        cardsAmount: c.cardsAmount,
        sfAmount: c.sfAmount,
        createdAt: c.createdAt,
        rejectReason: c.rejectReason,
        cardNames: c.saleIds.map((id) => input.sales.find((x) => x.id === id)?.cardName).filter((n): n is string => Boolean(n)),
      })),
  };
}
