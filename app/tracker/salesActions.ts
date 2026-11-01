"use server";

import type { CatalogCard } from "@/lib/pokemonCatalog";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTrackerAdmin } from "@/lib/tracker/auth";
import { normalizeOwnerTag } from "@/lib/tracker/split";
import { queryCatalog } from "@/lib/pokemonCatalogQuery";
import { CardInsight, summarizeHistory } from "@/lib/tracker/wanted";
import { refresh, money, text, parse, assertOwned, findOrCreateCustomer } from "./trackerHelpers";

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
  /** The catalog card the name was picked from, if it was. */
  catalogCardId?: string | null;
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
      catalogCardId: z.string().trim().max(60).nullish(),
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
    // Only sent when a catalog card was picked, so typed names keep working before the catalog migration is run.
    ...(v.catalogCardId ? { catalog_card_id: v.catalogCardId } : {}),
  });
  if (error) throw new Error(error.message);
  refresh();
  return { customerId: customer.id, newCustomer: customer.created };
}

/** Pokemon cards matching what's typed in the card box (name, set or number), best matches first. Never throws. */
export async function searchCatalog(query: string): Promise<{ cards: CatalogCard[]; error?: string }> {
  await requireTrackerAdmin();
  return queryCatalog(query);
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

/**
 * What a catalog card has sold for across this owner's lives, and what it is listed for on the marketplace.
 * Null when there is neither (or the columns are not there yet).
 */
export async function cardHistory(catalogCardId: string): Promise<CardInsight | null> {
  const admin = await requireTrackerAdmin();
  const id = parse(z.string().trim().min(1).max(60), catalogCardId);
  const db = createAdminClient();
  const [sold, listings] = await Promise.all([
    db.from("tracker_sales").select("amount, created_at").eq("owner_id", admin.id).eq("catalog_card_id", id).order("created_at", { ascending: false }).limit(200),
    db.from("cards").select("price").eq("catalog_card_id", id).eq("status", "AVAILABLE").gt("quantity_available", 0).limit(200),
  ]);
  const sales = !sold.error && sold.data ? summarizeHistory(sold.data.map((r) => ({ amount: Number(r.amount), date: r.created_at as string }))) : null;
  const prices = !listings.error && listings.data ? listings.data.map((r) => Number(r.price)).filter((n) => n > 0) : [];
  const listed = prices.length > 0 ? { count: prices.length, lowest: Math.min(...prices) } : null;
  return sales || listed ? { sales, listed } : null;
}
