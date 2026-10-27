import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeCustomerTotals, CustomerTotals } from "./money";
import { IslandGroup, islandGroupForRegion } from "./regions";
import { DEFAULT_OWNER_LABELS, OwnerLabel, allocateCardPayments, liveBalances, normalizeOwnerTag } from "./split";
import type { Installment } from "./installments";

export interface TrackerSettings {
  luzonFee: number;
  visayasMindanaoFee: number;
  paymentInstructions: string;
  showAddressOnInvoice: boolean;
  /** Owner tags for cards, e.g. A = AC, S = Shane. */
  ownerLabels: OwnerLabel[];
  /** Public URLs of the uploaded payment QR images, or null. */
  gcashQrUrl: string | null;
  maribankQrUrl: string | null;
}

export const DEFAULT_SETTINGS: TrackerSettings = {
  luzonFee: 64,
  visayasMindanaoFee: 94,
  paymentInstructions: "",
  showAddressOnInvoice: true,
  ownerLabels: DEFAULT_OWNER_LABELS,
  gcashQrUrl: null,
  maribankQrUrl: null,
};

export interface TrackerCustomer {
  id: string;
  name: string;
  region: string | null;
  provinceCity: string | null;
  barangay: string | null;
  zip: string | null;
  street: string | null;
  /** Derived from the region on every read, so it can't go stale. */
  islandGroup: IslandGroup | null;
  address: string | null;
  /** Marketplace buyer account this customer is linked to (they can sign in and see their own orders), or null. */
  buyerId: string | null;
}
export interface TrackerLive {
  id: string;
  title: string;
  liveDate: string;
}
export interface TrackerSale {
  id: string;
  customerId: string;
  liveId: string;
  cardName: string;
  amount: number;
  forShipping: boolean;
  /** Owner code ("A", "S", ...) or null when untagged. */
  ownerTag: string | null;
  shipmentId: string | null;
  /** When a not-for-shipping card was handed over, or null. */
  distributedAt: string | null;
  createdAt: string;
}
export interface TrackerPayment {
  id: string;
  customerId: string;
  amount: number;
  method: "GCASH" | "MARIBANK";
  purpose: "CARDS" | "SHIPPING";
  /** The live this payment was made for, or null = general (settles the oldest cards first). */
  liveId: string | null;
  /** Cards this payment was ticked against when it was recorded (empty = applied automatically). */
  allocations: { saleId: string; amount: number }[];
  paidOn: string;
  note: string | null;
}
export interface TrackerShipment {
  id: string;
  customerId: string;
  shippedOn: string;
  fee: number;
  prepaidApplied: number;
  islandGroup: IslandGroup | null;
  note: string | null;
}

export interface TrackerPlan {
  id: string;
  customerId: string;
  saleId: string;
  status: "REQUESTED" | "ACTIVE" | "DECLINED" | "CANCELLED";
  requestedBy: "CUSTOMER" | "ADMIN";
  note: string | null;
  declineReason: string | null;
  createdAt: string;
  installments: Installment[];
}

export interface TrackerPayout {
  id: string;
  liveId: string;
  /** Card owner code the money went to; null = cards with no owner tag. */
  recipientTag: string | null;
  amount: number;
  paidOn: string;
  note: string | null;
}

export interface TrackerData {
  settings: TrackerSettings;
  customers: TrackerCustomer[];
  lives: TrackerLive[];
  sales: TrackerSale[];
  payments: TrackerPayment[];
  shipments: TrackerShipment[];
  totalsByCustomer: Record<string, CustomerTotals>;
  /** Per customer, per live: what that live's order is worth and how much of it is paid (payments made for a live count there first). */
  liveBreakdown: Record<string, Record<string, { cards: number; paid: number }>>;
  /** How much of each card is paid (payments made for a live settle that live first). */
  paidBySale: Record<string, number>;
  payouts: TrackerPayout[];
  /** Open installment plans (requested or active), one per card at most. */
  plans: TrackerPlan[];
  /** For cards on an ACTIVE plan that still owe money: how much. Shipping such a card early gets a warning. */
  planUnpaidBySale: Record<string, number>;
}

/** owner_labels is jsonb; fall back to the defaults if it's missing (migration not run yet) or malformed. */
function parseOwnerLabels(raw: unknown): OwnerLabel[] {
  if (!Array.isArray(raw)) return DEFAULT_OWNER_LABELS;
  const labels = raw
    .map((x) => ({
      code: normalizeOwnerTag((x as { code?: string })?.code) ?? "",
      name: String((x as { name?: string })?.name ?? "").trim(),
      active: (x as { active?: boolean })?.active !== false,
    }))
    .filter((l) => l.code !== "" && l.name !== "");
  return labels.length > 0 ? labels : DEFAULT_OWNER_LABELS;
}

const PAGE = 1000;

/** PostgREST caps a single response at 1000 rows - page through so a long-running ledger never silently truncates (and under-reports a balance). */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

function addressLine(c: { street: string | null; barangay: string | null; province_city: string | null; zip: string | null }): string | null {
  const parts = [c.street, c.barangay ? `Brgy. ${c.barangay.replace(/^brgy\.?\s*/i, "")}` : null, c.province_city, c.zip]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(", ") : null;
}

/** Loads one admin's whole ledger. Always scoped by owner_id - the service-role client bypasses RLS, so this filter IS the access control. */
export async function loadTrackerData(ownerId: string): Promise<TrackerData> {
  const supabase = createAdminClient();

  const [settingsRes, customerRows, liveRows, saleRows, paymentRows, shipmentRows] = await Promise.all([
    supabase.from("tracker_settings").select("*").eq("owner_id", ownerId).maybeSingle(),
    fetchAll<Record<string, string | null>>((f, t) =>
      supabase.from("tracker_customers").select("*").eq("owner_id", ownerId).order("name").range(f, t),
    ),
    fetchAll<Record<string, string>>((f, t) =>
      supabase
        .from("tracker_lives")
        .select("*")
        .eq("owner_id", ownerId)
        .order("live_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(f, t),
    ),
    fetchAll<Record<string, unknown>>((f, t) =>
      supabase.from("tracker_sales").select("*").eq("owner_id", ownerId).order("created_at").range(f, t),
    ),
    fetchAll<Record<string, unknown>>((f, t) =>
      supabase.from("tracker_payments").select("*").eq("owner_id", ownerId).order("paid_on", { ascending: false }).order("created_at", { ascending: false }).range(f, t),
    ),
    fetchAll<Record<string, unknown>>((f, t) =>
      supabase.from("tracker_shipments").select("*").eq("owner_id", ownerId).order("shipped_on", { ascending: false }).range(f, t),
    ),
  ]);
  if (settingsRes.error) throw new Error(settingsRes.error.message);

  const s = settingsRes.data;
  const settings: TrackerSettings = s
    ? {
        luzonFee: Number(s.luzon_fee),
        visayasMindanaoFee: Number(s.visayas_mindanao_fee),
        paymentInstructions: s.payment_instructions ?? "",
        showAddressOnInvoice: s.show_address_on_invoice,
        ownerLabels: parseOwnerLabels(s.owner_labels),
        gcashQrUrl: s.gcash_qr_url ?? null,
        maribankQrUrl: s.maribank_qr_url ?? null,
      }
    : DEFAULT_SETTINGS;

  const customers: TrackerCustomer[] = customerRows.map((c) => ({
    id: c.id as string,
    name: c.name as string,
    region: c.region,
    provinceCity: c.province_city,
    barangay: c.barangay,
    zip: c.zip,
    street: c.street,
    islandGroup: islandGroupForRegion(c.region),
    buyerId: (c.buyer_id as string | null | undefined) ?? null,
    address: addressLine(c as { street: string | null; barangay: string | null; province_city: string | null; zip: string | null }),
  }));
  const lives: TrackerLive[] = liveRows.map((l) => ({ id: l.id, title: l.title, liveDate: l.live_date }));
  const sales: TrackerSale[] = saleRows.map((r) => ({
    id: r.id as string,
    customerId: r.customer_id as string,
    liveId: r.live_id as string,
    cardName: r.card_name as string,
    amount: Number(r.amount),
    forShipping: r.for_shipping as boolean,
    ownerTag: normalizeOwnerTag(r.owner_tag as string | null | undefined),
    shipmentId: (r.shipment_id as string | null) ?? null,
    distributedAt: (r.distributed_at as string | null | undefined) ?? null,
    createdAt: r.created_at as string,
  }));
  const payments: TrackerPayment[] = paymentRows.map((r) => ({
    id: r.id as string,
    customerId: r.customer_id as string,
    amount: Number(r.amount),
    method: r.method as TrackerPayment["method"],
    purpose: r.purpose as TrackerPayment["purpose"],
    liveId: (r.live_id as string | null | undefined) ?? null,
    allocations: [],
    paidOn: r.paid_on as string,
    note: (r.note as string | null) ?? null,
  }));
  const shipments: TrackerShipment[] = shipmentRows.map((r) => ({
    id: r.id as string,
    customerId: r.customer_id as string,
    shippedOn: r.shipped_on as string,
    fee: Number(r.fee),
    prepaidApplied: Number(r.prepaid_applied),
    islandGroup: (r.island_group as IslandGroup | null) ?? null,
    note: (r.note as string | null) ?? null,
  }));

  const totalsByCustomer: Record<string, CustomerTotals> = {};
  for (const c of customers) {
    totalsByCustomer[c.id] = computeCustomerTotals(
      sales.filter((x) => x.customerId === c.id).map((x) => ({ amount: x.amount, liveId: x.liveId, forShipping: x.forShipping, shipped: x.shipmentId !== null, distributed: x.distributedAt !== null })),
      payments.filter((x) => x.customerId === c.id),
      shipments.filter((x) => x.customerId === c.id),
    );
  }

  const liveDateById = new Map(lives.map((l) => [l.id, l.liveDate]));
  const splitSales = sales.map((x) => ({
    id: x.id,
    customerId: x.customerId,
    liveId: x.liveId,
    amount: x.amount,
    ownerTag: x.ownerTag,
    order: `${liveDateById.get(x.liveId) ?? ""}|${x.createdAt}`,
  }));
  // Cards a payment was ticked against. The table was added later; without its migration payments simply apply automatically.
  try {
    const allocationRows = await fetchAll<Record<string, unknown>>((f, t) =>
      supabase.from("tracker_payment_allocations").select("payment_id, sale_id, amount").eq("owner_id", ownerId).range(f, t),
    );
    const byPayment = new Map<string, { saleId: string; amount: number }[]>();
    for (const r of allocationRows) {
      const list = byPayment.get(r.payment_id as string) ?? [];
      list.push({ saleId: r.sale_id as string, amount: Number(r.amount) });
      byPayment.set(r.payment_id as string, list);
    }
    for (const p of payments) p.allocations = byPayment.get(p.id) ?? [];
  } catch (err) {
    if (!/tracker_payment_allocations|schema cache|does not exist/i.test(err instanceof Error ? err.message : "")) throw err;
  }

  const paidMap = allocateCardPayments(splitSales, payments);
  const liveBreakdown = liveBalances(splitSales, paidMap);
  const paidBySale = Object.fromEntries(paidMap);

  // Installment plans (tables arrive with migration_live_tracker_installments.sql; the rest of the tracker works without them).
  const plans: TrackerPlan[] = [];
  try {
    const planRows = await fetchAll<Record<string, unknown>>((f, t) =>
      supabase.from("tracker_installment_plans").select("*").eq("owner_id", ownerId).in("status", ["REQUESTED", "ACTIVE"]).range(f, t),
    );
    const planIds = planRows.map((r) => r.id as string);
    const installmentRows = planIds.length
      ? await fetchAll<Record<string, unknown>>((f, t) => supabase.from("tracker_plan_installments").select("*").in("plan_id", planIds).range(f, t))
      : [];
    for (const r of planRows) {
      plans.push({
        id: r.id as string,
        customerId: r.customer_id as string,
        saleId: r.sale_id as string,
        status: r.status as TrackerPlan["status"],
        requestedBy: r.requested_by as TrackerPlan["requestedBy"],
        note: (r.note as string | null) ?? null,
        declineReason: (r.decline_reason as string | null) ?? null,
        createdAt: r.created_at as string,
        installments: installmentRows
          .filter((i) => i.plan_id === r.id)
          .map((i) => ({ seq: Number(i.seq), dueDate: i.due_date as string, amount: Number(i.amount) }))
          .sort((a, b) => a.seq - b.seq),
      });
    }
  } catch (err) {
    if (!/tracker_installment_plans|tracker_plan_installments|schema cache|does not exist/i.test(err instanceof Error ? err.message : "")) throw err;
  }
  const planUnpaidBySale: Record<string, number> = {};
  for (const plan of plans) {
    if (plan.status !== "ACTIVE") continue;
    const sale = sales.find((x) => x.id === plan.saleId);
    if (!sale) continue;
    const left = Math.round((sale.amount - (paidBySale[sale.id] ?? 0)) * 100) / 100;
    if (left > 0) planUnpaidBySale[sale.id] = left;
  }

  // Payouts live in a table added later; if its migration hasn't run yet the rest of the tracker must still work.
  let payouts: TrackerPayout[] = [];
  try {
    const rows = await fetchAll<Record<string, unknown>>((f, t) =>
      supabase.from("tracker_payouts").select("*").eq("owner_id", ownerId).order("paid_on", { ascending: false }).range(f, t),
    );
    payouts = rows.map((r) => ({
      id: r.id as string,
      liveId: r.live_id as string,
      recipientTag: normalizeOwnerTag(r.recipient_tag as string | null),
      amount: Number(r.amount),
      paidOn: r.paid_on as string,
      note: (r.note as string | null) ?? null,
    }));
  } catch (err) {
    if (!/tracker_payouts|schema cache|does not exist/i.test(err instanceof Error ? err.message : "")) throw err;
  }

  return { settings, customers, lives, sales, payments, shipments, totalsByCustomer, liveBreakdown, paidBySale, payouts, plans, planUnpaidBySale };
}
