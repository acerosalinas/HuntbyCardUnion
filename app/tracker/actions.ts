"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTrackerAdmin } from "@/lib/tracker/auth";
import { islandGroupForRegion, REGIONS } from "@/lib/tracker/regions";
import { normalizeOwnerTag } from "@/lib/tracker/split";
import { sum } from "@/lib/tracker/money";
import { attributeCardPayments } from "@/lib/tracker/split";
import { fetchAll, loadTrackerData } from "@/lib/tracker/data";
import { invoiceReadyText, NoticeCandidate, planNotices } from "@/lib/tracker/notice";
import { sendInvoiceReadyEmails } from "@/lib/email";
import { validateSchedule } from "@/lib/tracker/installments";
import { validateImageFile } from "@/lib/imageValidation";
import { notifyUser } from "@/lib/notify";
import { formatCurrency } from "@/lib/utils";
import { uploadToR2 } from "@/lib/r2";

// Every action here derives the owner from the signed-in admin's session and
// filters every query by it. The service-role client bypasses RLS, so these
// owner_id filters are the only thing keeping one admin out of another's
// ledger - never take an owner id from the client.

function refresh() {
  revalidatePath("/tracker", "layout");
}

type Db = ReturnType<typeof createAdminClient>;

const money = z.number().finite().min(0).max(10_000_000);
const text = (max: number) => z.string().trim().max(max);

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error(result.error.issues[0]?.message ?? "Invalid input.");
  return result.data;
}

async function assertOwned(db: Db, table: string, id: string, ownerId: string, label: string) {
  const { data, error } = await db.from(table).select("id").eq("id", id).eq("owner_id", ownerId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`${label} not found.`);
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Finds the owner's customer by name (case-insensitive) or creates it. */
async function findOrCreateCustomer(db: Db, ownerId: string, rawName: string): Promise<{ id: string; created: boolean }> {
  const name = parse(text(120).min(1, "Enter the customer's name."), rawName);
  const find = async () => {
    const { data, error } = await db
      .from("tracker_customers")
      .select("id")
      .eq("owner_id", ownerId)
      .ilike("name", escapeLike(name))
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.id as string | undefined;
  };
  const existing = await find();
  if (existing) return { id: existing, created: false };

  const { data, error } = await db.from("tracker_customers").insert({ owner_id: ownerId, name }).select("id").single();
  if (error) {
    // Two quick adds of the same new name: the unique index rejects the second.
    if (error.code === "23505") {
      const raced = await find();
      if (raced) return { id: raced, created: false };
    }
    throw new Error(error.message);
  }
  return { id: data.id as string, created: true };
}

export async function createLive(title: string, liveDate: string): Promise<string> {
  const admin = await requireTrackerAdmin();
  const input = parse(
    z.object({ title: text(120).min(1, "Enter a title for the live."), liveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.") }),
    { title, liveDate },
  );
  const { data, error } = await createAdminClient()
    .from("tracker_lives")
    .insert({ owner_id: admin.id, title: input.title, live_date: input.liveDate })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  refresh();
  return data.id as string;
}

export async function updateLive(liveId: string, title: string, liveDate: string) {
  const admin = await requireTrackerAdmin();
  const v = parse(
    z.object({ id: z.string().uuid(), title: text(120).min(1, "Enter a title for the live."), liveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.") }),
    { id: liveId, title, liveDate },
  );
  const { error } = await createAdminClient()
    .from("tracker_lives")
    .update({ title: v.title, live_date: v.liveDate })
    .eq("id", v.id)
    .eq("owner_id", admin.id);
  if (error) throw new Error(error.message);
  refresh();
}

/** Deletes a live together with every card entered in it. Customers and payments are untouched (balances simply drop by the removed cards). Blocked while any of its cards has shipped. */
export async function deleteLive(liveId: string): Promise<{ error: string } | void> {
  const admin = await requireTrackerAdmin();
  const id = parse(z.string().uuid(), liveId);
  const db = createAdminClient();
  await assertOwned(db, "tracker_lives", id, admin.id, "Live");

  const { count: shipped, error: shippedError } = await db
    .from("tracker_sales")
    .select("id", { count: "exact", head: true })
    .eq("live_id", id)
    .eq("owner_id", admin.id)
    .not("shipment_id", "is", null);
  if (shippedError) throw new Error(shippedError.message);
  const { count: payoutCount, error: payoutError } = await db
    .from("tracker_payouts")
    .select("id", { count: "exact", head: true })
    .eq("live_id", id)
    .eq("owner_id", admin.id);
  if (payoutError && !/tracker_payouts|schema cache|does not exist/i.test(payoutError.message)) throw new Error(payoutError.message);
  if (payoutCount) {
    return { error: "Payments were already distributed to owners for this live. Undo those on the Dashboard first." };
  }
  if (shipped) {
    return {
      error:
      shipped + " card" + (shipped === 1 ? " in this live is" : "s in this live are") + " already marked shipped. Undo those shipments first (open the customer and press Undo under Parcels shipped).",
    };
  }

  const { error: salesError } = await db.from("tracker_sales").delete().eq("live_id", id).eq("owner_id", admin.id);
  if (salesError) throw new Error(salesError.message);
  const { error } = await db.from("tracker_lives").delete().eq("id", id).eq("owner_id", admin.id);
  if (error) throw new Error(error.message);
  refresh();
}

export async function addSale(input: {
  liveId: string;
  customerName: string;
  cardName: string;
  amount: number;
  forShipping: boolean;
  ownerTag?: string | null;
}): Promise<{ customerId: string; newCustomer: boolean }> {
  const admin = await requireTrackerAdmin();
  const v = parse(
    z.object({
      liveId: z.string().uuid("Pick a live first."),
      customerName: text(120).min(1, "Enter the customer's name."),
      cardName: text(200).min(1, "Enter the card name."),
      amount: money,
      forShipping: z.boolean(),
      ownerTag: z.string().trim().max(8).nullish(),
    }),
    input,
  );
  const db = createAdminClient();
  await assertOwned(db, "tracker_lives", v.liveId, admin.id, "Live");

  // A switched-off owner can't be given new cards (the screen doesn't offer them; this is the backstop).
  const tag = normalizeOwnerTag(v.ownerTag);
  if (tag) {
    const { data: st } = await db.from("tracker_settings").select("owner_labels").eq("owner_id", admin.id).maybeSingle();
    const labels = (Array.isArray(st?.owner_labels) ? st.owner_labels : []) as { code?: string; active?: boolean }[];
    if (labels.find((l) => normalizeOwnerTag(l.code) === tag)?.active === false) throw new Error("That owner is switched off in Settings.");
  }

  const customer = await findOrCreateCustomer(db, admin.id, v.customerName);

  const { error } = await db.from("tracker_sales").insert({
    owner_id: admin.id,
    customer_id: customer.id,
    live_id: v.liveId,
    card_name: v.cardName,
    amount: v.amount,
    for_shipping: v.forShipping,
    owner_tag: normalizeOwnerTag(v.ownerTag),
  });
  if (error) throw new Error(error.message);
  refresh();
  return { customerId: customer.id, newCustomer: customer.created };
}

export async function updateSale(id: string, input: { cardName: string; amount: number; forShipping: boolean; customerName?: string }) {
  const admin = await requireTrackerAdmin();
  const v = parse(
    z.object({ cardName: text(200).min(1, "Enter the card name."), amount: money, forShipping: z.boolean(), customerName: text(120).min(1, "Enter the customer's name.").optional() }),
    input,
  );
  const db = createAdminClient();
  const { data: sale, error: findError } = await db
    .from("tracker_sales")
    .select("shipment_id, for_shipping, customer_id")
    .eq("id", id)
    .eq("owner_id", admin.id)
    .maybeSingle();
  if (findError) throw new Error(findError.message);
  if (!sale) throw new Error("Card not found.");
  if (sale.shipment_id && v.forShipping !== sale.for_shipping) {
    throw new Error("This card is already shipped - undo the shipment before changing its shipping flag.");
  }
  // Moving a card to a different customer (a typo in the name): allowed only before it has shipped, since a parcel belongs to one customer.
  let customerId = sale.customer_id as string;
  if (v.customerName) {
    const target = await findOrCreateCustomer(db, admin.id, v.customerName);
    if (target.id !== customerId) {
      if (sale.shipment_id) throw new Error("This card is already shipped - undo the shipment before moving it to another customer.");
      customerId = target.id;
    }
  }
  const { error } = await db
    .from("tracker_sales")
    .update({ card_name: v.cardName, amount: v.amount, for_shipping: v.forShipping, customer_id: customerId })
    .eq("id", id)
    .eq("owner_id", admin.id);
  if (error) throw new Error(error.message);
  refresh();
}

export async function setSalesForShipping(ids: string[], forShipping: boolean) {
  const admin = await requireTrackerAdmin();
  const v = parse(z.object({ ids: z.array(z.string().uuid()).min(1).max(500), forShipping: z.boolean() }), { ids, forShipping });
  const { error } = await createAdminClient()
    .from("tracker_sales")
    // A card that is going to be shipped can't also be "distributed", so flagging it for shipping clears that.
    .update(v.forShipping ? { for_shipping: true, distributed_at: null } : { for_shipping: false })
    .in("id", v.ids)
    .eq("owner_id", admin.id)
    .is("shipment_id", null);
  if (error) throw new Error(error.message);
  refresh();
}

/** Marks cards handed over (or undoes it). Only for cards NOT flagged for shipping - those are completed by a shipment instead. */
export async function setSalesDistributed(ids: string[], distributed: boolean) {
  const admin = await requireTrackerAdmin();
  const v = parse(z.object({ ids: z.array(z.string().uuid()).min(1).max(500), distributed: z.boolean() }), { ids, distributed });
  const { error } = await createAdminClient()
    .from("tracker_sales")
    .update({ distributed_at: v.distributed ? new Date().toISOString() : null })
    .in("id", v.ids)
    .eq("owner_id", admin.id)
    .eq("for_shipping", false);
  if (error) throw new Error(error.message);
  refresh();
}

export async function setSalesOwner(ids: string[], ownerTag: string | null) {
  const admin = await requireTrackerAdmin();
  const v = parse(z.object({ ids: z.array(z.string().uuid()).min(1).max(500), ownerTag: z.string().trim().max(8).nullable() }), { ids, ownerTag });
  const { error } = await createAdminClient()
    .from("tracker_sales")
    .update({ owner_tag: normalizeOwnerTag(v.ownerTag) })
    .in("id", v.ids)
    .eq("owner_id", admin.id);
  if (error) throw new Error(error.message);
  refresh();
}

export async function deleteSale(id: string) {
  const admin = await requireTrackerAdmin();
  const db = createAdminClient();
  const { data: sale } = await db.from("tracker_sales").select("shipment_id").eq("id", id).eq("owner_id", admin.id).maybeSingle();
  if (!sale) throw new Error("Card not found.");
  if (sale.shipment_id) throw new Error("This card is already shipped - undo the shipment first.");
  const { error } = await db.from("tracker_sales").delete().eq("id", id).eq("owner_id", admin.id);
  if (error) throw new Error(error.message);
  refresh();
}

export interface CustomerInput {
  name: string;
  region: string;
  provinceCity: string;
  barangay: string;
  zip: string;
  street: string;
}

export async function saveCustomer(id: string, input: CustomerInput) {
  const admin = await requireTrackerAdmin();
  const v = parse(
    z.object({
      name: text(120).min(1, "Enter the customer's name."),
      region: z.string().refine((r) => r === "" || REGIONS.some((x) => x.value === r), "Pick a valid region."),
      provinceCity: text(120),
      barangay: text(120),
      zip: text(10).refine((z) => z === "" || /^\d{4}$/.test(z), "ZIP code must be 4 digits."),
      street: text(200),
    }),
    input,
  );
  const blank = (s: string) => (s === "" ? null : s);
  const { error } = await createAdminClient()
    .from("tracker_customers")
    .update({
      name: v.name,
      region: blank(v.region),
      province_city: blank(v.provinceCity),
      barangay: blank(v.barangay),
      zip: blank(v.zip),
      street: blank(v.street),
      island_group: islandGroupForRegion(v.region),
    })
    .eq("id", id)
    .eq("owner_id", admin.id);
  if (error) throw new Error(error.code === "23505" ? "You already have a customer with that name." : error.message);
  refresh();
}

/** Handle search for the "link this customer to an account" box. */
export async function findBuyers(query: string): Promise<{ id: string; handle: string; fullName: string }[]> {
  await requireTrackerAdmin();
  const q = query.trim().replace(/^@/, "");
  if (q.length < 2) return [];
  const { data, error } = await createAdminClient().from("profiles").select("id, handle, full_name").ilike("handle", `%${escapeLike(q)}%`).limit(8);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: r.id as string, handle: r.handle as string, fullName: r.full_name as string }));
}

/** Links a tracker customer to a marketplace account (or unlinks with null). One account can be linked to one customer. */
export async function linkCustomerBuyer(customerId: string, buyerId: string | null) {
  const admin = await requireTrackerAdmin();
  const v = parse(z.object({ customerId: z.string().uuid(), buyerId: z.string().uuid().nullable() }), { customerId, buyerId });
  const db = createAdminClient();
  await assertOwned(db, "tracker_customers", v.customerId, admin.id, "Customer");

  if (v.buyerId) {
    const { data: profile, error: profileError } = await db.from("profiles").select("id").eq("id", v.buyerId).maybeSingle();
    if (profileError) throw new Error(profileError.message);
    if (!profile) throw new Error("That account doesn't exist.");
  }

  const { error } = await db.from("tracker_customers").update({ buyer_id: v.buyerId }).eq("id", v.customerId).eq("owner_id", admin.id);
  if (error) {
    if (error.code === "23505") {
      const { data: other } = await db.from("tracker_customers").select("name").eq("owner_id", admin.id).eq("buyer_id", v.buyerId as string).maybeSingle();
      throw new Error(`That account is already linked to ${other?.name ?? "another customer"}. Unlink it there first.`);
    }
    throw new Error(error.message);
  }
  refresh();
}

/** Returns { error } when it can't be deleted - a thrown message is hidden in production (React #441), so expected refusals come back as a value. */
export async function deleteCustomer(id: string): Promise<{ error: string } | void> {
  const admin = await requireTrackerAdmin();
  const db = createAdminClient();
  await assertOwned(db, "tracker_customers", id, admin.id, "Customer");
  for (const table of ["tracker_sales", "tracker_payments", "tracker_shipments"]) {
    const { count, error } = await db.from(table).select("id", { count: "exact", head: true }).eq("customer_id", id).eq("owner_id", admin.id);
    if (error) throw new Error(error.message);
    if (count) return { error: "This customer has cards or payments recorded, so they can't be deleted. Remove their cards and payments first." };
  }
  const { error } = await db.from("tracker_customers").delete().eq("id", id).eq("owner_id", admin.id);
  if (error) throw new Error(error.message);
  refresh();
  // Leave from the server: the page the user is on (this customer's) no longer exists, so letting the
  // revalidation rebuild it fails ("An error occurred in the Server Components render", React #441).
  redirect("/tracker/customers");
}

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
export async function recordPayout(input: { liveId: string; recipientTag: string | null; amount: number; paidOn: string; note: string }) {
  const admin = await requireTrackerAdmin();
  const v = parse(
    z.object({
      liveId: z.string().uuid(),
      recipientTag: z.string().trim().max(8).nullable(),
      amount: money.refine((n) => n > 0, "Amount must be more than zero."),
      paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date."),
      note: text(300),
    }),
    input,
  );
  const db = createAdminClient();
  await assertOwned(db, "tracker_lives", v.liveId, admin.id, "Live");
  const { error } = await db.from("tracker_payouts").insert({
    owner_id: admin.id,
    live_id: v.liveId,
    recipient_tag: normalizeOwnerTag(v.recipientTag),
    amount: v.amount,
    paid_on: v.paidOn,
    note: v.note || null,
  });
  if (error) throw new Error(error.message);
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

/** One parcel = one shipping fee, however many cards go in it. The fee is computed by the caller from the customer's island group and may be overridden/waived (0). */
export async function markShipped(input: { customerId: string; saleIds: string[]; fee: number; note: string }) {
  const admin = await requireTrackerAdmin();
  const v = parse(
    z.object({ customerId: z.string().uuid(), saleIds: z.array(z.string().uuid()).min(1, "Select at least one card.").max(500), fee: money, note: text(300) }),
    input,
  );
  const db = createAdminClient();
  const { data: customer, error: cErr } = await db
    .from("tracker_customers")
    .select("region")
    .eq("id", v.customerId)
    .eq("owner_id", admin.id)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!customer) throw new Error("Customer not found.");

  const { error } = await db.rpc("tracker_mark_shipped", {
    p_owner: admin.id,
    p_customer: v.customerId,
    p_sale_ids: v.saleIds,
    p_fee: v.fee,
    p_island_group: islandGroupForRegion(customer.region),
    p_note: v.note || null,
  });
  if (error) throw new Error(error.message);
  refresh();
}

export async function undoShipment(shipmentId: string) {
  const admin = await requireTrackerAdmin();
  const { error } = await createAdminClient().rpc("tracker_undo_shipment", { p_owner: admin.id, p_shipment: shipmentId });
  if (error) throw new Error(error.message);
  refresh();
}

/** Uploads a payment QR image to the public bucket and returns its URL. Nothing is saved on the settings row until saveSettings runs. */
export async function uploadTrackerQr(formData: FormData): Promise<string> {
  await requireTrackerAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file provided.");
  const { bytes, contentType } = await validateImageFile(file);
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
  return uploadToR2(`tracker-qr/${crypto.randomUUID()}.${ext}`, bytes, contentType);
}

/** Only our own public bucket may be linked from invoices - never an arbitrary URL. */
function ownQrUrl(url: string | null): string | null {
  if (!url) return null;
  const base = process.env.R2_PUBLIC_URL;
  if (!base || !url.startsWith(base)) throw new Error("That QR image didn't come from the tracker upload - please upload it again.");
  return url;
}

export async function saveSettings(input: {
  luzonFee: number;
  visayasMindanaoFee: number;
  paymentInstructions: string;
  showAddressOnInvoice: boolean;
  ownerLabels: { code: string; name: string; active?: boolean }[];
  gcashQrUrl: string | null;
  maribankQrUrl: string | null;
}) {
  const admin = await requireTrackerAdmin();
  const v = parse(
    z.object({
      luzonFee: money,
      visayasMindanaoFee: money,
      paymentInstructions: text(1000),
      showAddressOnInvoice: z.boolean(),
      gcashQrUrl: z.string().max(500).nullable(),
      maribankQrUrl: z.string().max(500).nullable(),
      ownerLabels: z
        .array(z.object({ code: text(8).min(1, "Each owner needs a short code."), name: text(40).min(1, "Each owner needs a name."), active: z.boolean().optional() }))
        .min(1, "Keep at least one owner.")
        .max(6),
    }),
    input,
  );
  const ownerLabels = v.ownerLabels.map((l) => ({ code: normalizeOwnerTag(l.code) as string, name: l.name, active: l.active !== false }));
  if (new Set(ownerLabels.map((l) => l.code)).size !== ownerLabels.length) throw new Error("Owner codes must be different from each other.");
  const { error } = await createAdminClient()
    .from("tracker_settings")
    .upsert({
      owner_id: admin.id,
      luzon_fee: v.luzonFee,
      visayas_mindanao_fee: v.visayasMindanaoFee,
      payment_instructions: v.paymentInstructions,
      show_address_on_invoice: v.showAddressOnInvoice,
      owner_labels: ownerLabels,
      gcash_qr_url: ownQrUrl(v.gcashQrUrl),
      maribank_qr_url: ownQrUrl(v.maribankQrUrl),
      updated_at: new Date().toISOString(),
    });
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

const scheduleSchema = z
  .array(z.object({ dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date for every payment."), amount: money.refine((n) => n > 0, "Every payment must be more than zero.") }))
  .min(2, "An installment plan needs at least 2 payments.")
  .max(12);

/** Enter a card's installment plan yourself (it starts approved), or change the schedule of its existing plan / pending request. */
export async function savePlan(input: { saleId: string; installments: { dueDate: string; amount: number }[]; note: string }) {
  const admin = await requireTrackerAdmin();
  const v = parse(z.object({ saleId: z.string().uuid(), installments: scheduleSchema, note: text(300) }), input);
  const db = createAdminClient();

  const { data: sale, error: saleError } = await db.from("tracker_sales").select("amount, card_name, customer_id").eq("id", v.saleId).eq("owner_id", admin.id).maybeSingle();
  if (saleError) throw new Error(saleError.message);
  if (!sale) throw new Error("Card not found.");
  const problem = validateSchedule(v.installments, Number(sale.amount));
  if (problem) throw new Error(problem);

  // If this approves a customer's request, remember who asked so we can tell them.
  const { data: open } = await db
    .from("tracker_installment_plans")
    .select("status, requested_by, buyer_id")
    .eq("sale_id", v.saleId)
    .in("status", ["REQUESTED", "ACTIVE"])
    .maybeSingle();

  const { error } = await db.rpc("tracker_set_plan", {
    p_owner: admin.id,
    p_sale: v.saleId,
    p_installments: v.installments.map((i) => ({ due_date: i.dueDate, amount: i.amount })),
    p_status: "ACTIVE",
    p_requested_by: "ADMIN",
    p_buyer: null,
    p_note: v.note || null,
  });
  if (error) throw new Error(error.message);

  if (open?.status === "REQUESTED" && open.requested_by === "CUSTOMER") {
    await notifyUser(db, {
      recipientId: open.buyer_id as string | null,
      type: "tracker_proof_confirmed",
      title: "Installment plan approved",
      body: `Your installment plan for ${sale.card_name} was approved.`,
      link: "/account/orders",
    });
  }
  refresh();
  revalidatePath("/account/orders");
}

export async function declinePlan(planId: string, reason: string) {
  const admin = await requireTrackerAdmin();
  const v = parse(z.object({ planId: z.string().uuid(), reason: text(300).min(3, "Tell the customer why (a few words).") }), { planId, reason });
  const db = createAdminClient();
  const { data: updated, error } = await db
    .from("tracker_installment_plans")
    .update({ status: "DECLINED", decline_reason: v.reason, decided_at: new Date().toISOString() })
    .eq("id", v.planId)
    .eq("owner_id", admin.id)
    .eq("status", "REQUESTED")
    .select("buyer_id, sale_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) throw new Error("This request was already handled.");

  await notifyUser(db, {
    recipientId: updated.buyer_id as string | null,
    type: "tracker_proof_rejected",
    title: "Installment request not approved",
    body: v.reason,
    link: "/account/orders",
  });
  refresh();
  revalidatePath("/account/orders");
}

/** Ends an approved plan (the card goes back to being owed in full, minus anything already paid). */
export async function cancelPlan(planId: string) {
  const admin = await requireTrackerAdmin();
  const id = parse(z.string().uuid(), planId);
  const { error } = await createAdminClient()
    .from("tracker_installment_plans")
    .update({ status: "CANCELLED", decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", admin.id)
    .in("status", ["REQUESTED", "ACTIVE"]);
  if (error) throw new Error(error.message);
  refresh();
  revalidatePath("/account/orders");
}

export interface NoticeResult {
  error?: string;
  dryRun: boolean;
  /** Customers who were (or, in a dry run, would be) sent a bell notification. */
  notified: number;
  /** Of those, how many also got an email. */
  emailed: number;
  /** Told before and nothing changed since. */
  unchanged: number;
  /** Nothing left to pay on this live. */
  paidUp: number;
  /** Not linked to an account: their invoice has to be copied and sent by hand. */
  unlinked: string[];
}

/**
 * "Your invoice is ready" - tells the LINKED customers of a live (or just one) in the app and by email.
 * A customer already told about the same invoice isn't told again unless it changed; asking for one specific
 * customer always sends. With dryRun it only reports who would be told, so the screen can confirm first.
 * Refusals come back as { error } (production hides the text of thrown action errors).
 */
export async function notifyLiveCustomers(input: { liveId: string; customerId?: string; dryRun?: boolean }): Promise<NoticeResult> {
  const admin = await requireTrackerAdmin();
  const v = parse(z.object({ liveId: z.string().uuid(), customerId: z.string().uuid().optional(), dryRun: z.boolean().optional() }), input);
  const dryRun = Boolean(v.dryRun);
  const empty: NoticeResult = { dryRun, notified: 0, emailed: 0, unchanged: 0, paidUp: 0, unlinked: [] };

  const db = createAdminClient();
  const data = await loadTrackerData(admin.id);
  const live = data.lives.find((l) => l.id === v.liveId);
  if (!live) return { ...empty, error: "Live not found." };

  const liveSales = data.sales.filter((s) => s.liveId === v.liveId && (!v.customerId || s.customerId === v.customerId));
  const customerIds = [...new Set(liveSales.map((s) => s.customerId))];
  if (customerIds.length === 0) return { ...empty, error: "There are no cards to invoice yet." };

  const candidates: NoticeCandidate[] = customerIds.map((id) => {
    const customer = data.customers.find((c) => c.id === id);
    const cards = liveSales.filter((s) => s.customerId === id);
    return {
      customerId: id,
      name: customer?.name ?? "Customer",
      buyerId: customer?.buyerId ?? null,
      cardCount: cards.length,
      total: sum(cards.map((c) => c.amount)),
      paid: data.liveBreakdown[id]?.[v.liveId]?.paid ?? 0,
    };
  });

  const { data: priorRows, error: priorError } = await db
    .from("tracker_invoice_notices")
    .select("customer_id, notified_total, notified_cards")
    .eq("owner_id", admin.id)
    .eq("live_id", v.liveId);
  if (priorError) {
    return { ...empty, error: /tracker_invoice_notices|schema cache|does not exist/i.test(priorError.message) ? "Run supabase/migration_live_tracker_invoice_notice.sql in the Supabase SQL editor first." : priorError.message };
  }
  const prior = new Map((priorRows ?? []).map((r) => [r.customer_id as string, { total: Number(r.notified_total), cardCount: Number(r.notified_cards) }]));

  const plan = planNotices(candidates, prior, Boolean(v.customerId));
  const result: NoticeResult = {
    dryRun,
    notified: plan.toNotify.length,
    emailed: 0,
    unchanged: plan.unchanged.length,
    paidUp: plan.paidUp.length,
    unlinked: plan.unlinked.map((c) => c.name),
  };
  if (dryRun || plan.toNotify.length === 0) return result;

  // Bell notification for each, and gather who can also be emailed.
  const emails: Parameters<typeof sendInvoiceReadyEmails>[0] = [];
  for (const c of plan.toNotify) {
    const text = invoiceReadyText(live.title, c);
    await notifyUser(db, { recipientId: c.buyerId, type: "tracker_invoice_ready", title: text.title, body: text.body, link: "/account/orders" });

    const { data: userData } = await db.auth.admin.getUserById(c.buyerId as string);
    const email = userData?.user?.email;
    if (email) {
      emails.push({
        to: email,
        name: c.name,
        liveTitle: live.title,
        cards: liveSales.filter((s) => s.customerId === c.customerId).map((s) => ({ name: s.cardName, amount: s.amount })),
        total: c.total,
        paid: c.paid,
      });
    }
  }
  result.emailed = await sendInvoiceReadyEmails(emails);

  // Remember what each customer was told, so pressing the button again only reaches changed invoices.
  const { error: saveError } = await db.from("tracker_invoice_notices").upsert(
    plan.toNotify.map((c) => ({ owner_id: admin.id, live_id: v.liveId, customer_id: c.customerId, notified_total: c.total, notified_cards: c.cardCount, notified_at: new Date().toISOString() })),
    { onConflict: "live_id,customer_id" },
  );
  if (saveError) console.error("Couldn't record invoice notices:", saveError.message);
  return result;
}
