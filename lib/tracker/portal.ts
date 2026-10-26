import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "./data";
import { buildPortalView, PortalView } from "./portalView";

export interface PortalCustomer {
  customerId: string;
  customerName: string;
  view: PortalView;
  /** Seller's payment instructions and QR images, shown so the customer knows how to pay. */
  paymentInstructions: string;
  qr: { label: string; url: string }[];
}

type Row = Record<string, unknown>;

/**
 * Everything a signed-in buyer may see: the tracker customers LINKED to their
 * account (buyer_id = their id), and nothing else. The buyer id must come from
 * the verified session (getCurrentBuyer), never from the request. Reads only
 * that customer's rows - the rest of the seller's ledger is never loaded.
 */
export async function loadPortalForBuyer(buyerId: string): Promise<PortalCustomer[]> {
  const db = createAdminClient();
  const { data: linked, error } = await db.from("tracker_customers").select("id, name, owner_id").eq("buyer_id", buyerId);
  if (error) {
    // The column arrives with migration_live_tracker_portal.sql; until it's run nobody is linked.
    if (/buyer_id|schema cache|does not exist/i.test(error.message)) return [];
    throw new Error(error.message);
  }

  const out: PortalCustomer[] = [];
  for (const c of linked ?? []) {
    const customerId = c.id as string;
    const ownerId = c.owner_id as string;

    const [sales, payments, shipments, settingsRes] = await Promise.all([
      fetchAll<Row>((f, t) => db.from("tracker_sales").select("*").eq("customer_id", customerId).eq("owner_id", ownerId).order("created_at").range(f, t)),
      fetchAll<Row>((f, t) => db.from("tracker_payments").select("*").eq("customer_id", customerId).eq("owner_id", ownerId).range(f, t)),
      fetchAll<Row>((f, t) => db.from("tracker_shipments").select("*").eq("customer_id", customerId).eq("owner_id", ownerId).range(f, t)),
      db.from("tracker_settings").select("payment_instructions, gcash_qr_url, maribank_qr_url").eq("owner_id", ownerId).maybeSingle(),
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
      if (allocError && !/tracker_payment_allocations|schema cache|does not exist/i.test(allocError.message)) throw new Error(allocError.message);
      for (const r of allocRows ?? []) {
        const list = allocationsByPayment.get(r.payment_id as string) ?? [];
        list.push({ saleId: r.sale_id as string, amount: Number(r.amount) });
        allocationsByPayment.set(r.payment_id as string, list);
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
    });

    const settings = settingsRes.data;
    out.push({
      customerId,
      customerName: c.name as string,
      view,
      paymentInstructions: (settings?.payment_instructions as string | undefined) ?? "",
      qr: [
        { label: "GCash", url: (settings?.gcash_qr_url as string | null | undefined) ?? "" },
        { label: "Maribank", url: (settings?.maribank_qr_url as string | null | undefined) ?? "" },
      ].filter((q) => q.url),
    });
  }
  return out;
}
