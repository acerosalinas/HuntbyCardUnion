"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTrackerAdmin } from "@/lib/tracker/auth";
import { islandGroupForRegion, REGIONS } from "@/lib/tracker/regions";
import { normalizeOwnerTag } from "@/lib/tracker/split";
import { validateImageFile } from "@/lib/imageValidation";
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

/** Deletes a live together with every card entered in it. Customers and payments are untouched (balances simply drop by the removed cards). Blocked while any of its cards has shipped. */
export async function deleteLive(liveId: string) {
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
  if (shipped) {
    throw new Error(
      shipped + " card" + (shipped === 1 ? " in this live is" : "s in this live are") + " already marked shipped. Undo those shipments first (open the customer and press Undo under Parcels shipped).",
    );
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

export async function updateSale(id: string, input: { cardName: string; amount: number; forShipping: boolean }) {
  const admin = await requireTrackerAdmin();
  const v = parse(
    z.object({ cardName: text(200).min(1, "Enter the card name."), amount: money, forShipping: z.boolean() }),
    input,
  );
  const db = createAdminClient();
  const { data: sale, error: findError } = await db
    .from("tracker_sales")
    .select("shipment_id, for_shipping")
    .eq("id", id)
    .eq("owner_id", admin.id)
    .maybeSingle();
  if (findError) throw new Error(findError.message);
  if (!sale) throw new Error("Card not found.");
  if (sale.shipment_id && v.forShipping !== sale.for_shipping) {
    throw new Error("This card is already shipped - undo the shipment before changing its shipping flag.");
  }
  const { error } = await db
    .from("tracker_sales")
    .update({ card_name: v.cardName, amount: v.amount, for_shipping: v.forShipping })
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
    .update({ for_shipping: v.forShipping })
    .in("id", v.ids)
    .eq("owner_id", admin.id)
    .is("shipment_id", null);
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

export async function deleteCustomer(id: string) {
  const admin = await requireTrackerAdmin();
  const db = createAdminClient();
  await assertOwned(db, "tracker_customers", id, admin.id, "Customer");
  for (const table of ["tracker_sales", "tracker_payments", "tracker_shipments"]) {
    const { count, error } = await db.from(table).select("id", { count: "exact", head: true }).eq("customer_id", id).eq("owner_id", admin.id);
    if (error) throw new Error(error.message);
    if (count) throw new Error("This customer has cards or payments recorded, so they can't be deleted.");
  }
  const { error } = await db.from("tracker_customers").delete().eq("id", id).eq("owner_id", admin.id);
  if (error) throw new Error(error.message);
  refresh();
}

export async function recordPayment(input: {
  customerId: string;
  amount: number;
  method: "GCASH" | "MARIBANK";
  purpose: "CARDS" | "SHIPPING";
  paidOn: string;
  note: string;
}) {
  const admin = await requireTrackerAdmin();
  const v = parse(
    z.object({
      customerId: z.string().uuid(),
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
  const { error } = await db.from("tracker_payments").insert({
    owner_id: admin.id,
    customer_id: v.customerId,
    amount: v.amount,
    method: v.method,
    purpose: v.purpose,
    paid_on: v.paidOn,
    note: v.note || null,
  });
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
  ownerLabels: { code: string; name: string }[];
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
        .array(z.object({ code: text(8).min(1, "Each owner needs a short code."), name: text(40).min(1, "Each owner needs a name.") }))
        .min(1, "Keep at least one owner.")
        .max(6),
    }),
    input,
  );
  const ownerLabels = v.ownerLabels.map((l) => ({ code: normalizeOwnerTag(l.code) as string, name: l.name }));
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
