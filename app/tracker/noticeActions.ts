"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTrackerAdmin } from "@/lib/tracker/auth";
import { sum } from "@/lib/tracker/money";
import { loadTrackerData } from "@/lib/tracker/data";
import { invoiceReadyText, NoticeCandidate, planNotices } from "@/lib/tracker/notice";
import { sendInvoiceReadyEmails } from "@/lib/email";
import { catalogImageUrl } from "@/lib/pokemonCatalog";
import { notifyUser } from "@/lib/notify";
import { refresh, parse } from "./trackerHelpers";

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

  // Pictures for cards that were picked from the catalog, so the email shows them (none if the column is missing).
  const pictureBySale = new Map<string, string>();
  const { data: pickedRows } = await db.from("tracker_sales").select("id, catalog_card_id").in("id", liveSales.map((s) => s.id)).not("catalog_card_id", "is", null);
  const pickedIds = [...new Set((pickedRows ?? []).map((r) => r.catalog_card_id as string))];
  if (pickedIds.length > 0) {
    const { data: pics } = await db.from("pokemon_catalog_cards").select("id, image_url").in("id", pickedIds);
    const imageByCard = new Map((pics ?? []).filter((p) => p.image_url).map((p) => [p.id as string, catalogImageUrl(p.image_url as string)]));
    for (const r of pickedRows ?? []) {
      const url = imageByCard.get(r.catalog_card_id as string);
      if (url) pictureBySale.set(r.id as string, url);
    }
  }

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
        cards: liveSales.filter((s) => s.customerId === c.customerId).map((s) => ({ name: s.cardName, amount: s.amount, image: pictureBySale.get(s.id) ?? null })),
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

/**
 * Tells a buyer that a card they requested came up in a live (they should message to claim it if you have more).
 * Once per request and card. Refusals come back as { error }.
 */
export async function notifyWantedBuyer(input: { wantedId: string; saleId: string }): Promise<{ error?: string }> {
  const admin = await requireTrackerAdmin();
  const v = parse(z.object({ wantedId: z.string().uuid(), saleId: z.string().uuid() }), input);
  const db = createAdminClient();

  const { data: sale } = await db.from("tracker_sales").select("card_name").eq("id", v.saleId).eq("owner_id", admin.id).maybeSingle();
  if (!sale) return { error: "Card not found." };
  const { data: wanted } = await db.from("wanted_cards").select("buyer_id, card_name, status").eq("id", v.wantedId).maybeSingle();
  if (!wanted || wanted.status !== "OPEN") return { error: "That request is no longer open." };
  if (!wanted.buyer_id) return { error: "That buyer has no account to notify." };

  const { error: noticeError } = await db.from("tracker_wanted_notices").insert({ owner_id: admin.id, wanted_id: v.wantedId, sale_id: v.saleId });
  if (noticeError) {
    if (noticeError.code === "23505") return { error: "They were already told about this card." };
    return { error: /tracker_wanted_notices|schema cache|does not exist/i.test(noticeError.message) ? "Run supabase/migration_pokemon_catalog_alerts.sql in the Supabase SQL editor first." : noticeError.message };
  }
  await notifyUser(db, {
    recipientId: wanted.buyer_id as string,
    type: "wanted_card_fulfilled",
    title: "A card you asked for came up",
    body: `"${wanted.card_name}" came up in our live selling. Message us right away if you still want it.`,
    link: "/marketplace",
  });
  refresh();
  return {};
}

/** The buyer who requested a card bought it in a live: close their request as fulfilled (no notification - the invoice covers it). */
export async function fulfillWantedFromSale(input: { wantedId: string; saleId: string }): Promise<{ error?: string }> {
  const admin = await requireTrackerAdmin();
  const v = parse(z.object({ wantedId: z.string().uuid(), saleId: z.string().uuid() }), input);
  const db = createAdminClient();

  const { data: sale } = await db.from("tracker_sales").select("customer_id").eq("id", v.saleId).eq("owner_id", admin.id).maybeSingle();
  if (!sale) return { error: "Card not found." };
  const { data: customer } = await db.from("tracker_customers").select("buyer_id").eq("id", sale.customer_id).eq("owner_id", admin.id).maybeSingle();
  const { data: wanted } = await db.from("wanted_cards").select("buyer_id, status").eq("id", v.wantedId).maybeSingle();
  if (!wanted || wanted.status !== "OPEN") return { error: "That request is no longer open." };
  if (!customer?.buyer_id || customer.buyer_id !== wanted.buyer_id) return { error: "This card wasn't bought by the buyer who requested it." };

  const { error } = await db.from("wanted_cards").update({ status: "FULFILLED" }).eq("id", v.wantedId);
  if (error) return { error: error.message };
  revalidatePath("/admin/wanted");
  refresh();
  return {};
}
