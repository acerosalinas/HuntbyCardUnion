import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "./data";
import { buildPortalView, PortalClaimStatus, PortalView } from "./portalView";
import { ISLAND_GROUP_LABELS, islandGroupForRegion, shippingFeeFor } from "./regions";

export interface PortalCustomer {
  customerId: string;
  customerName: string;
  view: PortalView;
  /** Seller's payment instructions and QR images, shown so the customer knows how to pay. */
  paymentInstructions: string;
  qr: { label: string; url: string }[];
  /** Shipping fee for this customer's region (so they can tick "I included my shipping fee"), or null if no region is saved. */
  shippingFee: number | null;
  shippingGroup: string | null;
}

/** Server-only: the same data plus the seller's id, which actions need but the browser never should. */
export interface PortalCustomerInternal extends PortalCustomer {
  ownerId: string;
}

type Row = Record<string, unknown>;

const MISSING = /schema cache|does not exist/i;

/**
 * Everything a signed-in buyer may see: the tracker customers LINKED to their
 * account (buyer_id = their id), and nothing else. The buyer id must come from
 * the verified session (getCurrentBuyer), never from the request. Reads only
 * that customer's rows - the rest of the seller's ledger is never loaded.
 */
export async function loadPortalInternal(buyerId: string): Promise<PortalCustomerInternal[]> {
  const db = createAdminClient();
  const { data: linked, error } = await db.from("tracker_customers").select("id, name, owner_id, region").eq("buyer_id", buyerId);
  if (error) {
    // The column arrives with migration_live_tracker_portal.sql; until it's run nobody is linked.
    if (/buyer_id/i.test(error.message) || MISSING.test(error.message)) return [];
    throw new Error(error.message);
  }

  const out: PortalCustomerInternal[] = [];
  for (const c of linked ?? []) {
    const customerId = c.id as string;
    const ownerId = c.owner_id as string;

    const [sales, payments, shipments, settingsRes] = await Promise.all([
      fetchAll<Row>((f, t) => db.from("tracker_sales").select("*").eq("customer_id", customerId).eq("owner_id", ownerId).order("created_at").range(f, t)),
      fetchAll<Row>((f, t) => db.from("tracker_payments").select("*").eq("customer_id", customerId).eq("owner_id", ownerId).range(f, t)),
      fetchAll<Row>((f, t) => db.from("tracker_shipments").select("*").eq("customer_id", customerId).eq("owner_id", ownerId).range(f, t)),
      db
        .from("tracker_settings")
        .select("payment_instructions, gcash_qr_url, maribank_qr_url, luzon_fee, visayas_mindanao_fee")
        .eq("owner_id", ownerId)
        .maybeSingle(),
    ]);

    const liveIds = [...new Set(sales.map((s) => s.live_id as string))];
    const lives = liveIds.length
      ? ((await db.from("tracker_lives").select("id, title, live_date").eq("owner_id", ownerId).in("id", liveIds)).data ?? [])
      : [];

    // Cards a payment was ticked against (table added later - tolerate it being absent).
    const allocationsByPayment = new Map<string, { saleId: string; amount: number }[]>();
    if (payments.length > 0) {
      const { data: allocRows, error: allocError } = await db
        .from("tracker_payment_allocations")
        .select("payment_id, sale_id, amount")
        .in("payment_id", payments.map((p) => p.id as string));
      if (allocError && !/tracker_payment_allocations/i.test(allocError.message) && !MISSING.test(allocError.message)) throw new Error(allocError.message);
      for (const r of allocRows ?? []) {
        const list = allocationsByPayment.get(r.payment_id as string) ?? [];
        list.push({ saleId: r.sale_id as string, amount: Number(r.amount) });
        allocationsByPayment.set(r.payment_id as string, list);
      }
    }

    // The customer's proofs of payment (tables arrive with migration_live_tracker_claims.sql).
    let claims: NonNullable<Parameters<typeof buildPortalView>[0]["claims"]> = [];
    const { data: claimRows, error: claimError } = await db
      .from("tracker_payment_claims")
      .select("id, status, cards_amount, sf_amount, created_at, reject_reason")
      .eq("customer_id", customerId)
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (claimError && !/tracker_payment_claims/i.test(claimError.message) && !MISSING.test(claimError.message)) throw new Error(claimError.message);
    if ((claimRows ?? []).length > 0) {
      const { data: cardRows, error: cardError } = await db
        .from("tracker_claim_cards")
        .select("claim_id, sale_id")
        .in("claim_id", (claimRows ?? []).map((r) => r.id as string));
      if (cardError) throw new Error(cardError.message);
      claims = (claimRows ?? []).map((r) => ({
        id: r.id as string,
        status: r.status as PortalClaimStatus,
        cardsAmount: Number(r.cards_amount),
        sfAmount: Number(r.sf_amount),
        createdAt: r.created_at as string,
        rejectReason: (r.reject_reason as string | null) ?? null,
        saleIds: (cardRows ?? []).filter((x) => x.claim_id === r.id).map((x) => x.sale_id as string),
      }));
    }

    // This customer's installment plans (tables arrive with migration_live_tracker_installments.sql).
    // Per card: the open plan (requested / approved) if there is one, else the latest declined request so they can see why.
    const plans: NonNullable<Parameters<typeof buildPortalView>[0]["plans"]> = [];
    const { data: planRows, error: planError } = await db
      .from("tracker_installment_plans")
      .select("id, sale_id, status, decline_reason, created_at")
      .eq("customer_id", customerId)
      .eq("owner_id", ownerId)
      .in("status", ["REQUESTED", "ACTIVE", "DECLINED"])
      .order("created_at", { ascending: false });
    if (planError && !/tracker_installment_plans/i.test(planError.message) && !MISSING.test(planError.message)) throw new Error(planError.message);
    if ((planRows ?? []).length > 0) {
      const { data: instRows, error: instError } = await db
        .from("tracker_plan_installments")
        .select("plan_id, seq, due_date, amount")
        .in("plan_id", (planRows ?? []).map((r) => r.id as string));
      if (instError) throw new Error(instError.message);
      const taken = new Set<string>();
      const ordered = [...(planRows ?? [])].sort((a, b) => (a.status === "DECLINED" ? 1 : 0) - (b.status === "DECLINED" ? 1 : 0));
      for (const r of ordered) {
        const saleId = r.sale_id as string;
        if (taken.has(saleId)) continue;
        taken.add(saleId);
        plans.push({
          saleId,
          status: r.status as "REQUESTED" | "ACTIVE" | "DECLINED",
          declineReason: (r.decline_reason as string | null) ?? null,
          installments: (instRows ?? [])
            .filter((i) => i.plan_id === r.id)
            .map((i) => ({ seq: Number(i.seq), dueDate: i.due_date as string, amount: Number(i.amount) }))
            .sort((a, b) => a.seq - b.seq),
        });
      }
    }

    const view = buildPortalView({
      sales: sales.map((r) => ({
        id: r.id as string,
        customerId,
        liveId: r.live_id as string,
        cardName: r.card_name as string,
        amount: Number(r.amount),
        forShipping: r.for_shipping as boolean,
        shipmentId: (r.shipment_id as string | null) ?? null,
        distributedAt: (r.distributed_at as string | null | undefined) ?? null,
        createdAt: r.created_at as string,
      })),
      lives: lives.map((l) => ({ id: l.id as string, title: l.title as string, liveDate: l.live_date as string })),
      payments: payments.map((r) => ({
        customerId,
        amount: Number(r.amount),
        purpose: r.purpose as "CARDS" | "SHIPPING",
        liveId: (r.live_id as string | null | undefined) ?? null,
        allocations: allocationsByPayment.get(r.id as string) ?? [],
      })),
      shipments: shipments.map((r) => ({ id: r.id as string, fee: Number(r.fee), shippedOn: r.shipped_on as string })),
      claims,
      plans,
    });

    const settings = settingsRes.data;
    const group = islandGroupForRegion(c.region as string | null);
    const fee = shippingFeeFor(group, {
      luzonFee: Number(settings?.luzon_fee ?? 64),
      visayasMindanaoFee: Number(settings?.visayas_mindanao_fee ?? 94),
    });
    out.push({
      ownerId,
      customerId,
      customerName: c.name as string,
      view,
      paymentInstructions: (settings?.payment_instructions as string | undefined) ?? "",
      qr: [
        { label: "GCash", url: (settings?.gcash_qr_url as string | null | undefined) ?? "" },
        { label: "Maribank", url: (settings?.maribank_qr_url as string | null | undefined) ?? "" },
      ].filter((q) => q.url),
      shippingFee: fee,
      shippingGroup: group ? ISLAND_GROUP_LABELS[group] : null,
    });
  }
  return out;
}

/** What the browser is allowed to receive: the same data without the seller's id. */
export async function loadPortalForBuyer(buyerId: string): Promise<PortalCustomer[]> {
  return (await loadPortalInternal(buyerId)).map(({ ownerId: _ownerId, ...rest }) => {
    void _ownerId;
    return rest;
  });
}
