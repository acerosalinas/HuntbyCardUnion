"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTrackerAdmin } from "@/lib/tracker/auth";
import { normalizeOwnerTag } from "@/lib/tracker/split";
import { sum } from "@/lib/tracker/money";
import { attributeCardPayments } from "@/lib/tracker/split";
import { fetchAll, loadTrackerData } from "@/lib/tracker/data";
import { handedPerSale, handoverCandidates, type HandoverLine } from "@/lib/tracker/handover";
import { notifyUser } from "@/lib/notify";
import { formatCurrency } from "@/lib/utils";
import { refresh, money, text, parse, assertOwned } from "./trackerHelpers";

export async function recordPayment(input: {
  customerId: string;
  amount: number;
  method: "GCASH" | "MARIBANK";
  purpose: "CARDS" | "SHIPPING";
  paidOn: string;
  note: string;
  /** The live this payment is for, or null/omitted = general. */
  liveId?: string | null;
}) {
  const admin = await requireTrackerAdmin();
  const v = parse(
    z.object({
      customerId: z.string().uuid(),
      liveId: z.string().uuid().nullish(),
      amount: money.refine((n) => n > 0, "Payment must be more than zero."),
      method: z.enum(["GCASH", "MARIBANK"]),
      purpose: z.enum(["CARDS", "SHIPPING"]),
      paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the payment date."),
      note: text(300),
    }),
    input,
  );
  const db = createAdminClient();
  await assertOwned(db, "tracker_customers", v.customerId, admin.id, "Customer");
  if (v.liveId) await assertOwned(db, "tracker_lives", v.liveId, admin.id, "Live");
  const { error } = await db.from("tracker_payments").insert({
    owner_id: admin.id,
    customer_id: v.customerId,
    live_id: v.liveId ?? null,
    amount: v.amount,
    method: v.method,
    purpose: v.purpose,
    paid_on: v.paidOn,
    note: v.note || null,
  });
  if (error) throw new Error(error.message);
  refresh();
}

/** One payment, optionally "paid with SF": the cards part and the shipping-fee part are inserted in a single statement, so both save or neither does. */
export async function recordPayments(input: {
  customerId: string;
  /** The live this payment is for, or null = general (settles the oldest cards first). */
  liveId: string | null;
  cardsAmount: number;
  shippingAmount: number;
  method: "GCASH" | "MARIBANK";
  paidOn: string;
  note: string;
  /** Cards the cards-part of this payment was ticked against, in the order they should be paid. */
  allocations?: { saleId: string; amount: number }[];
}) {
  const admin = await requireTrackerAdmin();
  const v = parse(
    z.object({
      customerId: z.string().uuid(),
      liveId: z.string().uuid().nullable(),
      allocations: z.array(z.object({ saleId: z.string().uuid(), amount: money.refine((n) => n > 0, "Each allocation must be more than zero.") })).max(500).optional(),
      cardsAmount: money,
      shippingAmount: money,
      method: z.enum(["GCASH", "MARIBANK"]),
      paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the payment date."),
      note: text(300),
    }),
    input,
  );
  if (v.cardsAmount + v.shippingAmount <= 0) throw new Error("Payment must be more than zero.");
  const db = createAdminClient();
  await assertOwned(db, "tracker_customers", v.customerId, admin.id, "Customer");
  if (v.liveId) await assertOwned(db, "tracker_lives", v.liveId, admin.id, "Live");
  const base = { owner_id: admin.id, customer_id: v.customerId, live_id: v.liveId, method: v.method, paid_on: v.paidOn, note: v.note || null };
  const rows = [
    ...(v.cardsAmount > 0 ? [{ ...base, amount: v.cardsAmount, purpose: "CARDS" }] : []),
    ...(v.shippingAmount > 0 ? [{ ...base, amount: v.shippingAmount, purpose: "SHIPPING" }] : []),
  ];
  const allocations = v.allocations ?? [];
  if (allocations.length > 0) {
    const allocated = sum(allocations.map((a) => a.amount));
    if (allocated > v.cardsAmount + 0.001) throw new Error("The cards ticked add up to more than the amount paid for cards.");
    const ids = [...new Set(allocations.map((a) => a.saleId))];
    const { count, error: ownError } = await db
      .from("tracker_sales")
      .select("id", { count: "exact", head: true })
      .in("id", ids)
      .eq("owner_id", admin.id)
      .eq("customer_id", v.customerId);
    if (ownError) throw new Error(ownError.message);
    if (count !== ids.length) throw new Error("Some of the ticked cards don't belong to this customer.");
  }

  const { data: inserted, error } = await db.from("tracker_payments").insert(rows).select("id, purpose");
  if (error) throw new Error(error.message);

  const cardsPayment = (inserted ?? []).find((r) => r.purpose === "CARDS");
  if (allocations.length > 0 && cardsPayment) {
    const { error: allocError } = await db
      .from("tracker_payment_allocations")
      .insert(allocations.map((a) => ({ owner_id: admin.id, payment_id: cardsPayment.id, sale_id: a.saleId, amount: a.amount })));
    if (allocError) {
      // Don't leave a payment behind that isn't tied to the cards the user ticked.
      await db.from("tracker_payments").delete().in("id", (inserted ?? []).map((r) => r.id)).eq("owner_id", admin.id);
      throw new Error(allocError.message);
    }
  }
  refresh();
}

/** Re-points a payment at a specific live (or null = general, settles the oldest cards first). The amount, method and date never change, so the payment history stays intact. */
export async function setPaymentLive(paymentId: string, liveId: string | null) {
  const admin = await requireTrackerAdmin();
  const v = parse(z.object({ paymentId: z.string().uuid(), liveId: z.string().uuid().nullable() }), { paymentId, liveId });
  const db = createAdminClient();
  if (v.liveId) await assertOwned(db, "tracker_lives", v.liveId, admin.id, "Live");
  const { error } = await db.from("tracker_payments").update({ live_id: v.liveId }).eq("id", v.paymentId).eq("owner_id", admin.id);
  if (error) throw new Error(error.message);
  refresh();
}

/** Records money handed to a card owner (or to "no owner") for a live. */
/**
 * Records money handed to a card owner. Pass `saleIds` to hand over specific cards: each card's collected money that
 * is not already in an earlier handover goes in, the amount is worked out from them (the `amount` sent is ignored),
 * and the cards with who paid for each are saved with the date. Without `saleIds` it records just an amount, as before.
 */
export async function recordPayout(input: { liveId: string; recipientTag: string | null; amount: number; paidOn: string; note: string; saleIds?: string[] }) {
  const admin = await requireTrackerAdmin();
  const v = parse(
    z.object({
      liveId: z.string().uuid(),
      recipientTag: z.string().trim().max(8).nullable(),
      amount: z.number().finite().min(0).max(10_000_000),
      paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date."),
      note: text(300),
      saleIds: z.array(z.string().uuid()).max(500).optional(),
    }),
    input,
  );
  const db = createAdminClient();
  await assertOwned(db, "tracker_lives", v.liveId, admin.id, "Live");
  const tag = normalizeOwnerTag(v.recipientTag);

  // Work out what each ticked card can still hand over, from the real numbers (never from the browser).
  const lines: HandoverLine[] = [];
  if (v.saleIds && v.saleIds.length > 0) {
    const data = await loadTrackerData(admin.id);
    const customerName = new Map(data.customers.map((c) => [c.id, c.name]));
    const handed = handedPerSale(data.payouts.flatMap((p) => p.cards));
    const candidates = handoverCandidates(data.sales, data.paidBySale, handed, v.liveId, tag, customerName);
    const byId = new Map(candidates.map((c) => [c.saleId, c]));
    for (const id of new Set(v.saleIds)) {
      const c = byId.get(id);
      if (!c) throw new Error("One of the ticked cards has nothing left to hand over - refresh the page and try again.");
      lines.push({ saleId: c.saleId, cardName: c.cardName, customerName: c.customerName, amount: c.available });
    }
  }
  const amount = lines.length > 0 ? sum(lines.map((l) => l.amount)) : v.amount;
  if (!(amount > 0)) throw new Error("Amount must be more than zero.");

  const { data: payout, error } = await db
    .from("tracker_payouts")
    .insert({ owner_id: admin.id, live_id: v.liveId, recipient_tag: tag, amount, paid_on: v.paidOn, note: v.note || null })
    .select("id")
    .single();
  if (error || !payout) throw new Error(error?.message ?? "Couldn't save the handover.");

  if (lines.length > 0) {
    const { error: lineError } = await db
      .from("tracker_payout_cards")
      .insert(lines.map((l) => ({ owner_id: admin.id, payout_id: payout.id, sale_id: l.saleId, card_name: l.cardName, customer_name: l.customerName, amount: l.amount })));
    if (lineError) {
      // Never keep a handover whose card list failed to save.
      await db.from("tracker_payouts").delete().eq("id", payout.id);
      throw new Error(/tracker_payout_cards|schema cache|does not exist/i.test(lineError.message) ? "Run supabase/migration_live_tracker_payout_cards.sql in the Supabase SQL editor first." : lineError.message);
    }
  }
  refresh();
}

export async function deletePayout(id: string) {
  const admin = await requireTrackerAdmin();
  const { error } = await createAdminClient().from("tracker_payouts").delete().eq("id", id).eq("owner_id", admin.id);
  if (error) throw new Error(error.message);
  refresh();
}

export async function deletePayment(id: string) {
  const admin = await requireTrackerAdmin();
  const { error } = await createAdminClient().from("tracker_payments").delete().eq("id", id).eq("owner_id", admin.id);
  if (error) throw new Error(error.message);
  refresh();
}

/**
 * Confirms a customer's proof of payment: records the real payment(s) tied to the
 * cards they ticked (and their shipping-fee part), atomically, then tells them.
 * Only now does their progress line move.
 */
export async function confirmClaim(claimId: string, paidOn: string) {
  const admin = await requireTrackerAdmin();
  const v = parse(z.object({ claimId: z.string().uuid(), paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the payment date.") }), { claimId, paidOn });
  const db = createAdminClient();
  const { data: claim, error: findError } = await db
    .from("tracker_payment_claims")
    .select("buyer_id, cards_amount, sf_amount")
    .eq("id", v.claimId)
    .eq("owner_id", admin.id)
    .maybeSingle();
  if (findError) throw new Error(findError.message);
  if (!claim) throw new Error("Proof not found.");

  const { error } = await db.rpc("tracker_confirm_claim", { p_owner: admin.id, p_claim: v.claimId, p_paid_on: v.paidOn });
  if (error) throw new Error(error.message);

  await notifyUser(db, {
    recipientId: claim.buyer_id as string,
    type: "tracker_proof_confirmed",
    title: "Payment confirmed",
    body: `Your payment of ${formatCurrency(Number(claim.cards_amount) + Number(claim.sf_amount))} was confirmed.`,
    link: "/account/orders",
  });
  refresh();
  revalidatePath("/account/orders");
}

export async function rejectClaim(claimId: string, reason: string) {
  const admin = await requireTrackerAdmin();
  const v = parse(z.object({ claimId: z.string().uuid(), reason: text(300).min(3, "Tell the customer why (a few words).") }), { claimId, reason });
  const db = createAdminClient();
  const { data: updated, error } = await db
    .from("tracker_payment_claims")
    .update({ status: "REJECTED", reject_reason: v.reason, reviewed_at: new Date().toISOString() })
    .eq("id", v.claimId)
    .eq("owner_id", admin.id)
    .eq("status", "PENDING")
    .select("buyer_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) throw new Error("This proof was already reviewed.");

  await notifyUser(db, {
    recipientId: updated.buyer_id as string,
    type: "tracker_proof_rejected",
    title: "Payment proof not accepted",
    body: v.reason,
    link: "/account/orders",
  });
  refresh();
  revalidatePath("/account/orders");
}

/**
 * Takes one card's paid status back, whatever paid it (ticked cards, the Paid button, a confirmed proof, or an
 * older automatic payment). Other cards stay exactly as paid as they were: their coverage is frozen first.
 * Returns { error } for expected refusals - production hides the text of thrown action errors (React #441).
 */
export async function markCardUnpaid(saleId: string): Promise<{ error?: string; amount?: number }> {
  const admin = await requireTrackerAdmin();
  const id = parse(z.string().uuid(), saleId);
  const db = createAdminClient();

  const { data: sale, error: saleError } = await db.from("tracker_sales").select("id, customer_id").eq("id", id).eq("owner_id", admin.id).maybeSingle();
  if (saleError) return { error: saleError.message };
  if (!sale) return { error: "Card not found." };
  const customerId = sale.customer_id as string;

  const [sales, payments] = await Promise.all([
    fetchAll<Record<string, unknown>>((f, t) => db.from("tracker_sales").select("id, live_id, amount, created_at").eq("customer_id", customerId).eq("owner_id", admin.id).range(f, t)),
    fetchAll<Record<string, unknown>>((f, t) =>
      db.from("tracker_payments").select("id, amount, purpose, live_id, paid_on, created_at").eq("customer_id", customerId).eq("owner_id", admin.id).order("paid_on").order("created_at").range(f, t),
    ),
  ]);
  const liveIds = [...new Set(sales.map((r) => r.live_id as string))];
  const { data: lives } = liveIds.length ? await db.from("tracker_lives").select("id, live_date").eq("owner_id", admin.id).in("id", liveIds) : { data: [] as Record<string, unknown>[] };
  const liveDate = new Map((lives ?? []).map((l) => [l.id as string, l.live_date as string]));

  const paymentIds = payments.map((p) => p.id as string);
  const { data: allocRows, error: allocError } = paymentIds.length
    ? await db.from("tracker_payment_allocations").select("payment_id, sale_id, amount").in("payment_id", paymentIds)
    : { data: [] as Record<string, unknown>[], error: null };
  if (allocError) return { error: allocError.message };

  const explicit = new Map<string, number>(); // `${paymentId}|${saleId}` -> already-explicit amount
  const allocationsByPayment = new Map<string, { saleId: string; amount: number }[]>();
  for (const r of allocRows ?? []) {
    const key = `${r.payment_id}|${r.sale_id}`;
    explicit.set(key, (explicit.get(key) ?? 0) + Number(r.amount));
    const list = allocationsByPayment.get(r.payment_id as string) ?? [];
    list.push({ saleId: r.sale_id as string, amount: Number(r.amount) });
    allocationsByPayment.set(r.payment_id as string, list);
  }

  const { data: strictRow } = await db.from("tracker_settings").select("strict_payments").eq("owner_id", admin.id).maybeSingle();
  const attribution = attributeCardPayments(
    sales.map((r) => ({
      id: r.id as string,
      customerId,
      liveId: r.live_id as string,
      amount: Number(r.amount),
      ownerTag: null,
      order: `${liveDate.get(r.live_id as string) ?? ""}|${r.created_at as string}`,
    })),
    payments.map((r) => ({
      id: r.id as string,
      customerId,
      amount: Number(r.amount),
      liveId: (r.live_id as string | null) ?? null,
      purpose: r.purpose as "CARDS" | "SHIPPING",
      allocations: allocationsByPayment.get(r.id as string) ?? [],
    })),
    { strict: strictRow?.strict_payments === true },
  );

  const mine = attribution.get(id) ?? [];
  if (sum(mine.map((c) => c.amount)) <= 0) return { error: "This card isn't marked paid." };

  // Freeze: whatever automatic money is covering the OTHER cards becomes explicit, so it can't slide onto this card.
  const freeze: { payment_id: string; sale_id: string; amount: number }[] = [];
  for (const [otherId, contributions] of attribution) {
    if (otherId === id) continue;
    for (const c of contributions) {
      const automatic = Math.round((c.amount - (explicit.get(`${c.paymentId}|${otherId}`) ?? 0)) * 100) / 100;
      if (automatic > 0.004) freeze.push({ payment_id: c.paymentId, sale_id: otherId, amount: automatic });
    }
  }
  const reductions = mine.map((c) => ({ payment_id: c.paymentId, amount: c.amount }));

  const { data, error } = await db.rpc("tracker_revert_card_full", { p_owner: admin.id, p_sale: id, p_freeze: freeze, p_reductions: reductions });
  if (error) return { error: error.message };
  refresh();
  revalidatePath("/account/orders");
  return { amount: Number(data ?? 0) };
}

/** Marks a cards payment as split between the card owners (or takes the mark back), so everyone can see which payments are still waiting to be distributed. */
export async function setPaymentDistributed(paymentId: string, distributed: boolean): Promise<{ error?: string }> {
  const admin = await requireTrackerAdmin();
  const v = parse(z.object({ paymentId: z.string().uuid(), distributed: z.boolean() }), { paymentId, distributed });
  const { data, error } = await createAdminClient()
    .from("tracker_payments")
    .update({ distributed_at: v.distributed ? new Date().toISOString() : null })
    .eq("id", v.paymentId)
    .eq("owner_id", admin.id)
    .eq("purpose", "CARDS")
    .select("id");
  if (error) return { error: /distributed_at/i.test(error.message) ? "Run supabase/migration_payment_distributed.sql in the Supabase SQL editor first." : error.message };
  if (!data || data.length === 0) return { error: "That payment wasn't found." };
  refresh();
  return {};
}

/** Catch-up for payments that were split before this page existed: marks every cards payment dated on or before `date` as distributed. */
export async function markDistributedUpTo(date: string): Promise<{ count?: number; error?: string }> {
  const admin = await requireTrackerAdmin();
  const v = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.") }), { date });
  const { data, error } = await createAdminClient()
    .from("tracker_payments")
    .update({ distributed_at: new Date().toISOString() })
    .eq("owner_id", admin.id)
    .eq("purpose", "CARDS")
    .is("distributed_at", null)
    .lte("paid_on", v.date)
    .select("id");
  if (error) return { error: /distributed_at/i.test(error.message) ? "Run supabase/migration_payment_distributed.sql in the Supabase SQL editor first." : error.message };
  refresh();
  return { count: data?.length ?? 0 };
}
