"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAuthServerClient } from "@/lib/supabase/authServer";
import { assertOwnsOrSuper, requireAdmin, roleFromMetadata, AdminRole } from "@/lib/adminAuth";
import { sendOrderConfirmedEmail } from "@/lib/email";
import { validateImageFile } from "@/lib/imageValidation";
import { uploadToR2 } from "@/lib/r2";
import { canTransitionDispute } from "@/lib/disputeStatus";
import { canTransitionCardStatus } from "@/lib/cardStatus";
import { notifyUser } from "@/lib/notify";
import { formatCurrency } from "@/lib/utils";
import { FRANCHISES } from "@/lib/franchises";
import {
  AppNotification,
  CardItem,
  CardRow,
  DisputeStatus,
  NotificationRow,
  SellerProfile,
  SellerProfileRow,
  WantedCardStatus,
  cardFromRow,
  notificationFromRow,
  sellerProfileFromRow,
} from "@/types/marketplace";

function revalidateAdmin() {
  revalidatePath("/admin");
  revalidatePath("/admin/offers");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/manage");
  revalidatePath("/admin/logs");
  revalidatePath("/admin/live-sales");
  revalidatePath("/admin/disputes");
  revalidatePath("/admin/profile");
  revalidatePath("/");
  revalidatePath("/sellers");
}

async function getCardOwner(supabase: ReturnType<typeof createAdminClient>, cardId: string) {
  const { data, error } = await supabase.from("cards").select("admin_id").eq("id", cardId).single();
  if (error || !data) throw new Error(error?.message ?? "Card not found");
  return data.admin_id as string | null;
}

interface ClaimWithCard {
  card_id: string;
  buyer_id: string | null;
  buyer_handle: string;
  quantity: number;
  unit_price: number;
  order_id: string | null;
  status: string;
  is_live_sale: boolean;
  cards: { admin_id: string | null; title: string; list_price: number; quantity_available: number } | null;
}

/** Fetches a claim joined to its card - the common lookup every per-claim admin action (confirmPaid, cancelRelist, setShipped) starts with. */
async function getClaimWithCard(supabase: ReturnType<typeof createAdminClient>, claimId: string): Promise<ClaimWithCard> {
  const { data, error } = await supabase
    .from("card_claims")
    .select(
      "card_id, buyer_id, buyer_handle, quantity, unit_price, order_id, status, is_live_sale, cards(admin_id, title, list_price, quantity_available)",
    )
    .eq("id", claimId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Claim not found");
  return data as unknown as ClaimWithCard;
}

/** Marks any remaining WAITING queue entries for a card as CANCELLED - used whenever the card's PENDING chain ends (sold or released). */
async function cancelQueue(supabase: ReturnType<typeof createAdminClient>, cardId: string) {
  await supabase
    .from("dibs_queue")
    .update({ status: "CANCELLED" })
    .eq("card_id", cardId)
    .eq("status", "WAITING");
}

/**
 * Admin's most recent notifications, polled client-side (AdminNotificationBell)
 * rather than pushed via Realtime - see lib/notify.ts / supabase/schema.sql
 * for how rows get created. Scoped to `.eq("recipient_id", admin.id)` even
 * though the service-role client could read any row, so one admin can never
 * see another's notifications.
 */
export async function getMyNotifications(): Promise<AppNotification[]> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("recipient_id", admin.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return ((data as NotificationRow[] | null) ?? []).map(notificationFromRow);
}

export async function markNotificationRead(notificationId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("recipient_id", admin.id);
  if (error) throw new Error(error.message);
}

export async function markAllNotificationsRead() {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", admin.id)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}

/**
 * Emails the buyer once payment is confirmed. Fires once per claim, but a
 * cart checkout groups multiple claims into one `orders` row - to avoid
 * spamming one email per claim, this only actually sends once every claim in
 * the order is accounted for (try_claim_order_confirmation is an atomic
 * single-row claim in Postgres, so concurrent per-claim confirmations can't
 * both win and send duplicate emails - see schema.sql for why a plain
 * count-remaining-unconfirmed check from Node would be racy). Claims with no
 * order_id (an accepted offer, not a cart checkout) email immediately.
 * Never throws - a failed lookup/send must not surface as a failure of the
 * actual payment confirmation.
 */
async function notifyBuyerPaymentConfirmed(
  supabase: ReturnType<typeof createAdminClient>,
  buyerId: string,
  orderId: string | null,
  fallbackItem: { title: string; price: number },
) {
  try {
    let items = [fallbackItem];

    if (orderId) {
      const { data: claimed } = await supabase.rpc("try_claim_order_confirmation", { p_order_id: orderId });
      if (!claimed) return;

      const { data: orderClaims } = await supabase
        .from("card_claims")
        .select("quantity, unit_price, cards(title)")
        .eq("order_id", orderId)
        .eq("status", "SOLD");
      if (orderClaims && orderClaims.length > 0) {
        items = (orderClaims as unknown as { quantity: number; unit_price: number; cards: { title: string } | null }[]).map(
          (c) => ({ title: c.cards?.title ?? "Card", price: c.unit_price * c.quantity }),
        );
      }
    }

    const { data: userRes } = await supabase.auth.admin.getUserById(buyerId);
    const email = userRes?.user?.email;
    if (!email) return;

    const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", buyerId).maybeSingle();

    await sendOrderConfirmedEmail({
      to: email,
      buyerName: profile?.full_name ?? "there",
      items,
      total: items.reduce((sum, i) => sum + i.price, 0),
      orderId,
    });
  } catch (err) {
    console.error("Failed to send payment-confirmation email:", err);
  }
}

export async function confirmPaid(claimId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const claim = await getClaimWithCard(supabase, claimId);
  assertOwnsOrSuper(admin, claim.cards?.admin_id ?? null);

  // confirm_paid_claim (supabase/schema.sql) locks the claim row and
  // re-checks status = PENDING inside one transaction, so a concurrent
  // cancelRelist on the same claim can't race past this check - see the
  // "atomic admin claim/stock mutations" migration for why that matters.
  const { data: updated, error } = await supabase.rpc("confirm_paid_claim", { p_claim_id: claimId });
  if (error) throw new Error(error.message);

  revalidateAdmin();

  const buyerId = updated?.buyer_id as string | null;
  if (buyerId) {
    const title = claim.cards?.title ?? "Card";
    await notifyBuyerPaymentConfirmed(supabase, buyerId, updated.order_id as string | null, {
      title,
      price: (updated.unit_price as number) * (updated.quantity as number),
    });
    await notifyUser(supabase, {
      recipientId: buyerId,
      type: "payment_confirmed",
      title: "Payment confirmed",
      body: `Your payment for "${title}" has been confirmed.`,
      link: "/account/dibs",
    });
  }
}

export async function cancelRelist(claimId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const claim = await getClaimWithCard(supabase, claimId);
  const card = claim.cards;
  if (!card) throw new Error("Card not found");
  assertOwnsOrSuper(admin, card.admin_id);

  // cancel_relist_claim locks the claim then the card row and re-checks
  // status/open-disputes inside that lock, closing the same race window
  // confirmPaid above does.
  const { data: rpcData, error } = await supabase.rpc("cancel_relist_claim", { p_claim_id: claimId }).single();
  if (error) throw new Error(error.message);
  const data = rpcData as { out_card_id: string; out_buyer_id: string | null };

  await cancelQueue(supabase, data.out_card_id);
  revalidateAdmin();

  await notifyUser(supabase, {
    recipientId: data.out_buyer_id,
    type: "listing_cancelled",
    title: "Listing cancelled",
    body: `"${card.title}" was cancelled and re-listed by the seller.`,
    link: "/marketplace",
  });
}

/**
 * Promotes the earliest WAITING queue entry whose requested_quantity fits
 * into the card's current quantity_available, turning it into a new
 * card_claims row (the admin then reaches out to that buyer manually, since
 * the app has no way to message them directly). No-ops if nothing in the
 * queue currently fits - unlike the old single-claimant model, there's no
 * "release the card" fallback needed here anymore: quantity_available
 * already reflects what's genuinely open, with no separate manual reset.
 */
export async function promoteNextInQueue(cardId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { data: card, error: cardFetchError } = await supabase.from("cards").select("admin_id").eq("id", cardId).single();
  if (cardFetchError || !card) throw new Error(cardFetchError?.message ?? "Card not found");
  assertOwnsOrSuper(admin, card.admin_id);

  // promote_next_in_queue locks the card row (and the picked queue entry)
  // for the whole find-eligible-entry -> insert-claim -> decrement-stock
  // sequence, so this can't double-promote the same stock unit against a
  // concurrent call (e.g. two admins hitting "Promote" on the same card).
  const { data: rpcData, error } = await supabase.rpc("promote_next_in_queue", { p_card_id: cardId }).single();
  if (error) throw new Error(error.message);
  const data = rpcData as { out_promoted: boolean; out_buyer_id: string; out_buyer_handle: string; out_unit_price: number };

  if (!data.out_promoted) {
    return { promoted: false as const };
  }

  revalidateAdmin();

  await notifyUser(supabase, {
    recipientId: data.out_buyer_id,
    type: "queue_promoted",
    title: "You're up next",
    body: `A card you were waiting on is now yours to pay for at ${formatCurrency(data.out_unit_price)} - the seller will message you.`,
    link: "/account/dibs",
  });

  return { promoted: true as const, buyerHandle: data.out_buyer_handle };
}

export async function setShipped(claimId: string, shipped: boolean) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const claim = await getClaimWithCard(supabase, claimId);
  assertOwnsOrSuper(admin, claim.cards?.admin_id ?? null);

  const { error } = await supabase.from("card_claims").update({ shipped }).eq("id", claimId);
  if (error) throw new Error(error.message);
  revalidateAdmin();

  if (shipped && claim.buyer_id) {
    const title = claim.cards?.title ?? "Card";
    await notifyUser(supabase, {
      recipientId: claim.buyer_id,
      type: "claim_shipped",
      title: "Your order is on the way",
      body: `"${title}" has been marked as shipped/stashed.`,
      link: "/account/dibs",
    });
  }
}

// ---------------------------------------------------------------------------
// Live Sales - a super admin running a Facebook Live stream assigns a card
// straight to the winning buyer's account instead of checking it out under
// their own (which is what prompted this: a real sale ended up attributed
// to the admin, not the buyer). There's no way to write into a buyer's
// cart - it's client-side localStorage, not server state - so this creates
// the PENDING claim directly instead, which lands in their My Dibs exactly
// like a normal checkout would, just skipping the buyer clicking anything.
// Restricted to a super admin's own store: each store owner runs their own
// lives, this was never meant to let one super admin assign cards out of a
// different seller's inventory.
// ---------------------------------------------------------------------------

/** Handle search for the assign-a-buyer autocomplete - super admin only, same gate as the rest of this section. */
export async function findBuyerByHandle(query: string): Promise<{ id: string; handle: string; fullName: string }[]> {
  await requireSuperAdmin();
  const q = query.trim().replace(/^@/, "");
  if (q.length < 2) return [];

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, handle, full_name")
    .ilike("handle", `%${q}%`)
    .limit(8);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: r.id as string, handle: r.handle as string, fullName: r.full_name as string }));
}

export interface AssignLiveSaleInput {
  cardId: string;
  buyerId: string;
  fulfillmentMethod: "SHIP" | "STASH";
  paymentMethod: "PREPAID" | "COD";
}

export async function assignLiveSale(input: AssignLiveSaleInput) {
  const admin = await requireSuperAdmin();
  const supabase = createAdminClient();

  const { data: card, error: cardError } = await supabase.from("cards").select("admin_id").eq("id", input.cardId).single();
  if (cardError || !card) throw new Error(cardError?.message ?? "Card not found");
  if (card.admin_id !== admin.id) throw new Error("You can only assign live sales for your own store.");

  const { data: buyer, error: buyerError } = await supabase
    .from("profiles")
    .select("id, handle")
    .eq("id", input.buyerId)
    .single();
  if (buyerError || !buyer) throw new Error("Buyer not found.");

  // assign_live_sale locks the card row for the stock-check -> insert-claim
  // -> decrement sequence, so two fast clicks against the last unit can't
  // both succeed.
  const { data: rpcData, error: rpcError } = await supabase
    .rpc("assign_live_sale", {
      p_card_id: input.cardId,
      p_buyer_id: buyer.id,
      p_buyer_handle: buyer.handle,
      p_fulfillment_method: input.fulfillmentMethod,
      p_payment_method: input.paymentMethod,
    })
    .single();
  if (rpcError) throw new Error(rpcError.message);
  const data = rpcData as { out_unit_price: number; out_card_title: string };

  revalidateAdmin();

  const unitPrice = data.out_unit_price;
  await notifyUser(supabase, {
    recipientId: buyer.id,
    type: "live_sale_assigned",
    title: "You claimed a card during a live stream!",
    body: `"${data.out_card_title}" is waiting for you in My Dibs at ${formatCurrency(unitPrice)} - complete payment to secure it.`,
    link: "/account/dibs",
  });
}

/** Deletes a live-assigned sale and restocks the card - the "I checked it out under the wrong account" undo button. Only ever touches is_live_sale rows; a regular sale still has no undo (see the Sales Log's lack of one). */
export async function removeLiveSale(claimId: string) {
  const admin = await requireSuperAdmin();
  const supabase = createAdminClient();

  const claim = await getClaimWithCard(supabase, claimId);
  const card = claim.cards;
  if (!card) throw new Error("Card not found");
  if (card.admin_id !== admin.id) throw new Error("You can only remove sales from your own store.");

  // remove_live_sale_claim locks the claim then the card row and re-checks
  // is_live_sale/status/open-disputes inside that lock.
  const { error } = await supabase.rpc("remove_live_sale_claim", { p_claim_id: claimId });
  if (error) throw new Error(error.message);

  revalidateAdmin();
}

export async function deleteCard(cardId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  assertOwnsOrSuper(admin, await getCardOwner(supabase, cardId));

  const { error } = await supabase.from("cards").delete().eq("id", cardId);
  if (error) throw new Error(error.message);
  revalidateAdmin();
}

export async function acceptOffer(offerId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { data: offer, error: fetchError } = await supabase
    .from("offers")
    .select("*")
    .eq("id", offerId)
    .single();
  if (fetchError || !offer) throw new Error(fetchError?.message ?? "Offer not found");
  if (offer.status !== "PENDING") throw new Error("This offer has already been responded to.");

  assertOwnsOrSuper(admin, await getCardOwner(supabase, offer.card_id));

  // No claim is created here anymore, and no stock is touched - accepting
  // just unlocks the negotiated price. The buyer still goes through a
  // normal Add to Cart -> Place Order like any other purchase (choosing
  // Ship/Stash, Pay Now/COD) - see place_order's offer_id handling in
  // supabase/schema.sql (MIGRATION 14). This replaces the old behavior of
  // inserting a Pending Payment card_claims row the instant Accept was
  // clicked, before the buyer had done anything.
  const { error: offerError } = await supabase
    .from("offers")
    .update({ status: "ACCEPTED", agreed_amount: offer.offered_amount })
    .eq("id", offerId);
  if (offerError) throw new Error(offerError.message);

  revalidateAdmin();

  await notifyUser(supabase, {
    recipientId: offer.buyer_id,
    type: "offer_accepted",
    title: "Your offer was accepted",
    body: `Add it to your cart at ${formatCurrency(offer.offered_amount)} to finish checkout.`,
    link: `/card/${offer.card_id}`,
  });
}

export async function counterOffer(offerId: string, counterAmount: number) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { data: offer, error: fetchError } = await supabase
    .from("offers")
    .select("card_id, buyer_id, status")
    .eq("id", offerId)
    .single();
  if (fetchError || !offer) throw new Error(fetchError?.message ?? "Offer not found");
  if (offer.status !== "PENDING") throw new Error("This offer has already been responded to.");

  assertOwnsOrSuper(admin, await getCardOwner(supabase, offer.card_id));

  const { error } = await supabase
    .from("offers")
    .update({ status: "COUNTERED", counter_amount: counterAmount })
    .eq("id", offerId);
  if (error) throw new Error(error.message);
  revalidateAdmin();

  await notifyUser(supabase, {
    recipientId: offer.buyer_id,
    type: "offer_countered",
    title: "Seller countered your offer",
    body: `New offer: ${formatCurrency(counterAmount)} - accept or decline it on the card page.`,
    link: `/card/${offer.card_id}`,
  });
}

export async function declineOffer(offerId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { data: offer, error: fetchError } = await supabase
    .from("offers")
    .select("card_id, buyer_id, status")
    .eq("id", offerId)
    .single();
  if (fetchError || !offer) throw new Error(fetchError?.message ?? "Offer not found");
  // Also usable on an already-ACCEPTED offer - the seller retracting a
  // price they agreed to but the buyer hasn't spent yet (no card_claims
  // row exists until place_order's own offer_id handling creates one, so
  // there's nothing to unwind on the claim side either way).
  if (!["PENDING", "ACCEPTED"].includes(offer.status)) {
    throw new Error("This offer can no longer be declined.");
  }

  assertOwnsOrSuper(admin, await getCardOwner(supabase, offer.card_id));

  const { error } = await supabase.from("offers").update({ status: "DECLINED" }).eq("id", offerId);
  if (error) throw new Error(error.message);
  revalidateAdmin();

  await notifyUser(supabase, {
    recipientId: offer.buyer_id,
    type: "offer_declined",
    title: "Your offer was declined",
    link: `/card/${offer.card_id}`,
  });
}

// ---------------------------------------------------------------------------
// Disputes. "Seller" in this app has no account of its own - the admin who
// owns the card (disputes.seller_admin_id, snapshotted from cards.admin_id
// at open_dispute() time) handles the seller side. All writes here use the
// service-role client, same as every other admin action in this file - the
// only RLS-scoped writes anywhere in the dispute feature are the buyer-side
// open_dispute/withdraw_dispute RPCs in supabase/schema.sql.
// ---------------------------------------------------------------------------

async function getDisputeOwner(supabase: ReturnType<typeof createAdminClient>, disputeId: string) {
  const { data, error } = await supabase
    .from("disputes")
    .select("seller_admin_id, status, buyer_id, claim_id")
    .eq("id", disputeId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Dispute not found");
  return data as { seller_admin_id: string | null; status: DisputeStatus; buyer_id: string; claim_id: string | null };
}

/**
 * Admin's evidence/response upload. Shares the exact validate-then-upload
 * shape as the buyer's uploadDisputeEvidence (app/account/disputes/actions.ts)
 * but gated by requireAdmin()/assertOwnsOrSuper instead of a buyer session -
 * intentionally not unified into one function, since the two need different
 * auth checks and this keeps each one simple to read in isolation.
 */
export async function respondToDispute(disputeId: string, note: string, file?: File | null) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const dispute = await getDisputeOwner(supabase, disputeId);
  assertOwnsOrSuper(admin, dispute.seller_admin_id);

  if (!note.trim() && !file) {
    throw new Error("Add a note or a photo to respond.");
  }

  let storagePath: string | null = null;
  let contentType: string | null = null;
  let fileName: string | null = null;

  if (file) {
    const validated = await validateImageFile(file);
    const ext = file.name.split(".").pop() || "jpg";
    storagePath = `${disputeId}/${crypto.randomUUID()}.${ext}`;
    contentType = validated.contentType;
    fileName = file.name;

    const { error: uploadError } = await supabase.storage
      .from("dispute-evidence")
      .upload(storagePath, validated.bytes, { contentType, upsert: false });
    if (uploadError) throw new Error(uploadError.message);
  }

  const { error: insertError } = await supabase.from("dispute_evidence").insert({
    dispute_id: disputeId,
    uploaded_by: admin.id,
    uploader_role: "ADMIN",
    storage_path: storagePath,
    file_name: fileName,
    content_type: contentType,
    note: note.trim() || null,
  });
  if (insertError) throw new Error(insertError.message);

  if (dispute.status === "OPEN" && canTransitionDispute(dispute.status, "SELLER_RESPONDED")) {
    await supabase.from("disputes").update({ status: "SELLER_RESPONDED" }).eq("id", disputeId);
    await notifyUser(supabase, {
      recipientId: dispute.buyer_id,
      type: "dispute_response",
      title: "Seller responded to your dispute",
      body: note.trim() || "The seller added a photo response.",
      link: `/account/disputes/${disputeId}`,
    });
  }

  revalidateAdmin();
}

export async function markDisputeUnderReview(disputeId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const dispute = await getDisputeOwner(supabase, disputeId);
  assertOwnsOrSuper(admin, dispute.seller_admin_id);

  if (!canTransitionDispute(dispute.status, "UNDER_REVIEW")) {
    throw new Error(`Can't move a ${dispute.status} dispute to Under Review.`);
  }

  const { error } = await supabase.from("disputes").update({ status: "UNDER_REVIEW" }).eq("id", disputeId);
  if (error) throw new Error(error.message);
  revalidateAdmin();

  await notifyUser(supabase, {
    recipientId: dispute.buyer_id,
    type: "dispute_under_review",
    title: "Your dispute is under review",
    link: `/account/disputes/${disputeId}`,
  });
}

/**
 * Resolves a dispute as either refunded or dismissed. This is bookkeeping
 * only - there's no payment integration anywhere in this app (buyers pay
 * sellers off-platform, same as how confirmPaid just records that payment
 * happened rather than moving money). Marking RESOLVED_REFUND does not
 * touch the underlying card/order state; admin still issues any actual
 * refund themselves outside the app. Resolutions are terminal - there is no
 * reopen path (see lib/disputeStatus.ts).
 */
export async function resolveDispute(disputeId: string, resolution: "REFUND" | "DISMISSED", resolutionNote: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const dispute = await getDisputeOwner(supabase, disputeId);
  assertOwnsOrSuper(admin, dispute.seller_admin_id);

  const targetStatus: DisputeStatus = resolution === "REFUND" ? "RESOLVED_REFUND" : "RESOLVED_DISMISSED";
  if (!canTransitionDispute(dispute.status, targetStatus)) {
    throw new Error(`Can't resolve a ${dispute.status} dispute this way.`);
  }

  const { error } = await supabase
    .from("disputes")
    .update({
      status: targetStatus,
      resolution_note: resolutionNote.trim() || null,
      resolved_by: admin.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", disputeId);
  if (error) throw new Error(error.message);
  revalidateAdmin();

  await notifyUser(supabase, {
    recipientId: dispute.buyer_id,
    type: "dispute_resolved",
    title: resolution === "REFUND" ? "Dispute resolved - refund" : "Dispute resolved",
    body: resolutionNote.trim() || undefined,
    link: `/account/disputes/${disputeId}`,
  });

  // A refund doesn't move the physical unit by itself (see the comment on
  // this function) - the seller still has to decide whether it's sellable
  // again or a write-off, via resolveDisputeRestock below. Without this
  // notification that decision had no prompt at all: the claim just sat
  // SOLD forever with the unit permanently unavailable.
  if (resolution === "REFUND" && dispute.seller_admin_id) {
    await notifyUser(supabase, {
      recipientId: dispute.seller_admin_id,
      type: "dispute_resolved",
      title: "Refund issued - restock decision needed",
      body: "Decide whether to re-list this card or write it off.",
      link: `/admin/disputes/${disputeId}`,
    });
  }
}

/**
 * Follow-up to a REFUND resolution: the seller decides whether the unit
 * goes back on sale (relist = true, mirrors cancelRelist's stock-restore
 * logic) or is written off (relist = false - claim just goes CANCELLED,
 * stock untouched, for a lost/damaged item that can't actually be resold).
 * Guarded by claim.status = 'SOLD' so this can only run once per dispute.
 */
export async function resolveDisputeRestock(disputeId: string, relist: boolean) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const dispute = await getDisputeOwner(supabase, disputeId);
  assertOwnsOrSuper(admin, dispute.seller_admin_id);

  // resolve_dispute_restock locks the dispute, then its claim, then the
  // card, re-checking status at each step inside that lock before writing.
  const { data: cardId, error } = await supabase.rpc("resolve_dispute_restock", {
    p_dispute_id: disputeId,
    p_relist: relist,
  });
  if (error) throw new Error(error.message);

  if (relist) {
    await cancelQueue(supabase, cardId as string);
  }

  revalidateAdmin();
}

export async function logout() {
  const supabase = await createAuthServerClient("admin");
  await supabase.auth.signOut();
  // Not "/admin/login" - that's just a thin redirect stub now; go straight
  // to the one shared sign-in page (see app/account/login/actions.ts).
  redirect("/account/login");
}

export async function uploadCardImages(formData: FormData): Promise<string[]> {
  await requireAdmin();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return [];

  const urls: string[] = [];

  for (const file of files) {
    const { bytes, contentType } = await validateImageFile(file);

    const ext = file.name.split(".").pop() || "jpg";
    const path = `${crypto.randomUUID()}.${ext}`;

    const url = await uploadToR2(path, bytes, contentType);
    urls.push(url);
  }

  return urls;
}

/** Uploads a seller's avatar image, reusing the same public R2 bucket as card photos. */
export async function uploadAvatarImage(formData: FormData): Promise<string> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file provided.");

  const { bytes, contentType } = await validateImageFile(file);

  const ext = file.name.split(".").pop() || "jpg";
  const path = `avatars/${crypto.randomUUID()}.${ext}`;

  return uploadToR2(path, bytes, contentType);
}

/** Uploads a seller's GCash/bank payment QR code, reusing the same public R2 bucket as avatars. */
export async function uploadPaymentQrImage(formData: FormData): Promise<string> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file provided.");

  const { bytes, contentType } = await validateImageFile(file);

  const ext = file.name.split(".").pop() || "jpg";
  const path = `payment-qr/${crypto.randomUUID()}.${ext}`;

  return uploadToR2(path, bytes, contentType);
}

export interface CreateCardInput {
  title: string;
  setName: string;
  price: number;
  conditionGrade: string;
  rarity: string;
  /** Pokemon TCG energy type (see lib/pokemonType.ts) - null for every non-Pokemon card. */
  pokemonType: string | null;
  /** 'CARD' (default) or 'SEALED' - see lib/sealedType.ts. The form is responsible for setting conditionGrade/rarity to the fixed placeholder values for a sealed item; this action just persists whatever it's given. */
  productType: "CARD" | "SEALED";
  sealedType: string | null;
  images: string[];
  sellerHandle: string;
  sellerMessenger: string;
  isFlashSale: boolean;
  /** Whether buyers can Make Offer on this listing - see cards.is_negotiable. */
  isNegotiable: boolean;
  franchise: string;
  quantity: number;
}

export async function createCard(input: CreateCardInput) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const quantity = Math.max(1, Math.round(input.quantity) || 1);
  const { error } = await supabase.from("cards").insert({
    title: input.title,
    set_name: input.setName,
    price: input.price,
    list_price: input.price,
    condition_grade: input.conditionGrade,
    rarity: input.rarity,
    pokemon_type: input.pokemonType,
    product_type: input.productType,
    sealed_type: input.sealedType,
    images: input.images,
    seller_handle: input.sellerHandle,
    seller_messenger: input.sellerMessenger,
    is_flash_sale: input.isFlashSale,
    is_negotiable: input.isNegotiable,
    franchise: input.franchise,
    admin_id: admin.id,
    quantity,
    quantity_available: quantity,
  });
  if (error) throw new Error(error.message);
  revalidateAdmin();
}

export async function updateCard(cardId: string, input: CreateCardInput) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  assertOwnsOrSuper(admin, await getCardOwner(supabase, cardId));

  const { data: existing, error: existingError } = await supabase
    .from("cards")
    .select("status, quantity, quantity_available")
    .eq("id", cardId)
    .single();
  if (existingError || !existing) throw new Error(existingError?.message ?? "Card not found");

  const quantity = Math.max(1, Math.round(input.quantity) || 1);
  const claimed = existing.quantity - existing.quantity_available;
  if (quantity < claimed) {
    throw new Error(`Quantity can't be less than ${claimed} - that many units are already claimed.`);
  }
  const quantityAvailable = quantity - claimed;
  const status = existing.status === "DRAFT" ? "DRAFT" : quantityAvailable > 0 ? "AVAILABLE" : "SOLD";

  const { error } = await supabase
    .from("cards")
    .update({
      title: input.title,
      set_name: input.setName,
      price: input.price,
      // Editing a listing resets the baseline too - whatever price admin
      // explicitly saves here is the new "real" listed price, same as at
      // creation. Only acceptOffer is meant to create a temporary gap
      // between price and list_price.
      list_price: input.price,
      condition_grade: input.conditionGrade,
      rarity: input.rarity,
      pokemon_type: input.pokemonType,
      product_type: input.productType,
      sealed_type: input.sealedType,
      images: input.images,
      seller_handle: input.sellerHandle,
      seller_messenger: input.sellerMessenger,
      is_flash_sale: input.isFlashSale,
      is_negotiable: input.isNegotiable,
      franchise: input.franchise,
      quantity,
      quantity_available: quantityAvailable,
      status,
    })
    .eq("id", cardId);
  if (error) throw new Error(error.message);
  revalidateAdmin();
}

// ---------------------------------------------------------------------------
// Bulk Upload / Rapid Fill (app/admin/(dashboard)/inventory/bulk-upload).
// Uploading photos happens through the existing uploadCardImages() above;
// filling in a card's real details during Rapid Fill happens through the
// existing updateCard() above (it never touches status, so a draft stays a
// draft while its fields get overwritten) - these two actions only cover
// creating the placeholder rows and publishing them once ready.
// ---------------------------------------------------------------------------

const DRAFT_PLACEHOLDER_PRICE = 0.01;

/** One placeholder DRAFT row per uploaded image URL, owned by the calling admin. Never visible to buyers - see the "cards are publicly readable" RLS policy in supabase/schema.sql. */
export async function createDraftCards(imageUrls: string[]): Promise<CardItem[]> {
  const admin = await requireAdmin();
  if (imageUrls.length === 0) return [];

  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from("seller_profiles")
    .select("handle, messenger_username, tags")
    .eq("admin_id", admin.id)
    .maybeSingle();

  const rows = imageUrls.map((url) => ({
    title: "Untitled card",
    set_name: "Unknown Set",
    price: DRAFT_PLACEHOLDER_PRICE,
    list_price: DRAFT_PLACEHOLDER_PRICE,
    condition_grade: "Raw NM",
    images: [url],
    seller_handle: profile?.handle ? `@${profile.handle}` : admin.email,
    seller_messenger: profile?.messenger_username ?? "",
    franchise: profile?.tags?.[0] ?? FRANCHISES[0].slug,
    is_flash_sale: false,
    status: "DRAFT" as const,
    admin_id: admin.id,
  }));

  const { data, error } = await supabase.from("cards").insert(rows).select("*");
  if (error) throw new Error(error.message);
  revalidateAdmin();
  return ((data as CardRow[] | null) ?? []).map(cardFromRow);
}

/** Publishes DRAFT -> AVAILABLE for the given card ids. Ignores any id that isn't actually a DRAFT the caller owns (or any draft, for a super admin) - see lib/cardStatus.ts. */
export async function publishDrafts(cardIds: string[]): Promise<{ published: number }> {
  const admin = await requireAdmin();
  if (cardIds.length === 0) return { published: 0 };

  const supabase = createAdminClient();
  const { data, error: fetchError } = await supabase
    .from("cards")
    .select("id, status, admin_id")
    .in("id", cardIds);
  if (fetchError) throw new Error(fetchError.message);

  const publishableIds = ((data ?? []) as { id: string; status: string; admin_id: string | null }[])
    .filter((row) => admin.role === "SUPER_ADMIN" || row.admin_id === admin.id)
    .filter((row) => canTransitionCardStatus(row.status as CardItem["status"], "AVAILABLE"))
    .map((row) => row.id);

  if (publishableIds.length === 0) return { published: 0 };

  const { error } = await supabase.from("cards").update({ status: "AVAILABLE" }).in("id", publishableIds);
  if (error) throw new Error(error.message);
  revalidateAdmin();
  return { published: publishableIds.length };
}

// ---------------------------------------------------------------------------
// Admin account management (super admin only).
// ---------------------------------------------------------------------------

export interface AdminAccount {
  id: string;
  email: string;
  role: AdminRole;
  /** This admin's public storefront handle (seller_profiles.handle), or null if they haven't set one up. */
  handle: string | null;
  active: boolean;
  createdAt: number;
}

export interface BuyerAccountSummary {
  id: string;
  email: string;
  /** profiles.handle, already "@"-prefixed - null only if signup was interrupted before the profile row was created. */
  handle: string | null;
  /** profiles.full_name - null only if signup was interrupted before the profile row was created. */
  fullName: string | null;
  createdAt: number;
}

async function requireSuperAdmin() {
  const admin = await requireAdmin();
  if (admin.role !== "SUPER_ADMIN") throw new Error("Only super admins can manage admin accounts.");
  return admin;
}

/**
 * supabase.auth.admin.listUsers() returns every account this project has
 * ever authenticated - buyers and admins alike, since both sign in through
 * the same Supabase Auth users table (see BUYER_AUTH_COOKIE_NAME vs
 * ADMIN_AUTH_COOKIE_NAME - two separate sessions, one underlying user
 * table). listAdmins()/listBuyers() partition that single list by
 * roleFromMetadata() rather than each paying for their own full scan.
 * perPage defaults to 50 - bumped to Supabase's max so a growing user base
 * doesn't silently drop off the end of either list.
 */
async function listAllAuthUsers() {
  const supabase = createAdminClient();
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  return data.users;
}

export async function listAdmins(): Promise<AdminAccount[]> {
  await requireSuperAdmin();
  const users = await listAllAuthUsers();
  const adminUsers = users.filter((u) => roleFromMetadata(u.app_metadata) !== null);

  const supabase = createAdminClient();
  const { data: profileRows } = await supabase
    .from("seller_profiles")
    .select("admin_id, handle")
    .in("admin_id", adminUsers.map((u) => u.id));
  const handleByAdminId = new Map((profileRows ?? []).map((r) => [r.admin_id as string, r.handle as string]));

  return adminUsers
    .map((u) => ({
      id: u.id,
      email: u.email ?? "(no email)",
      role: roleFromMetadata(u.app_metadata) as AdminRole,
      handle: handleByAdminId.has(u.id) ? `@${handleByAdminId.get(u.id)}` : null,
      active: !u.banned_until || new Date(u.banned_until) <= new Date(),
      createdAt: new Date(u.created_at).getTime(),
    }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Read-only roster for the Manage Admins page - buyers have no account-management actions here (banning/password-reset is scoped to admin accounts only). */
export async function listBuyers(): Promise<BuyerAccountSummary[]> {
  await requireSuperAdmin();
  const users = await listAllAuthUsers();
  const buyerUsers = users.filter((u) => roleFromMetadata(u.app_metadata) === null);

  const supabase = createAdminClient();
  const { data: profileRows } = await supabase
    .from("profiles")
    .select("id, handle, full_name")
    .in("id", buyerUsers.map((u) => u.id));
  const profileById = new Map(
    (profileRows ?? []).map((r) => [r.id as string, { handle: r.handle as string, fullName: r.full_name as string }]),
  );

  return buyerUsers
    .map((u) => ({
      id: u.id,
      email: u.email ?? "(no email)",
      handle: profileById.get(u.id)?.handle ?? null,
      fullName: profileById.get(u.id)?.fullName ?? null,
      createdAt: new Date(u.created_at).getTime(),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function createAdminAccount(email: string, password: string, role: AdminRole) {
  await requireSuperAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role },
  });
  if (error) throw new Error(error.message);
  revalidateAdmin();
}

export async function setAdminActive(adminId: string, active: boolean) {
  const current = await requireSuperAdmin();
  if (current.id === adminId && !active) {
    throw new Error("You can't deactivate your own account.");
  }

  const supabase = createAdminClient();
  const { error } = await supabase.auth.admin.updateUserById(adminId, {
    // "876000h" (100 years) is Supabase's documented way to ban indefinitely; "none" lifts it.
    ban_duration: active ? "none" : "876000h",
  });
  if (error) throw new Error(error.message);
  revalidateAdmin();
}

export async function resetAdminPassword(adminId: string, newPassword: string) {
  await requireSuperAdmin();
  if (newPassword.length < 6) throw new Error("Password must be at least 6 characters.");

  const supabase = createAdminClient();
  const { error } = await supabase.auth.admin.updateUserById(adminId, { password: newPassword });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Seller profiles. Every seller is an admin account (see above) - this just
// adds a public-facing profile (bio, tags, socials) on top of one. Reads are
// public (seller_profiles has a public select RLS policy, see schema.sql),
// so pages that only need to *display* a profile query it directly via
// createServerReadClient()/the browser client, same as cards - these actions
// are only for the seller's own writes.
// ---------------------------------------------------------------------------

export interface SellerProfileInput {
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  tags: string[];
  facebookUrl: string;
  instagramUrl: string;
  messengerUsername: string;
  paymentQrUrl: string;
  codEnabled: boolean;
  codWeekday: number | null;
  liveModeSeconds: number;
}

const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export async function getMySellerProfile(): Promise<SellerProfile | null> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("seller_profiles")
    .select("*")
    .eq("admin_id", admin.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? sellerProfileFromRow(data as SellerProfileRow) : null;
}

export async function updateSellerProfile(input: SellerProfileInput) {
  const admin = await requireAdmin();

  const handle = input.handle.trim().toLowerCase();
  if (!HANDLE_PATTERN.test(handle)) {
    throw new Error("Handle must be 2-40 characters: lowercase letters, numbers, and hyphens only.");
  }
  if (!input.displayName.trim()) {
    throw new Error("Display name is required.");
  }
  const liveModeSeconds = Math.min(30, Math.max(1, Math.round(input.liveModeSeconds) || 4));
  if (input.codEnabled && (input.codWeekday === null || input.codWeekday < 0 || input.codWeekday > 6)) {
    throw new Error("Pick a weekday for Cash on Delivery shipping.");
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("seller_profiles").upsert(
    {
      admin_id: admin.id,
      handle,
      display_name: input.displayName.trim(),
      bio: input.bio.trim() || null,
      avatar_url: input.avatarUrl.trim() || null,
      tags: input.tags.map((t) => t.trim()).filter(Boolean),
      facebook_url: input.facebookUrl.trim() || null,
      instagram_url: input.instagramUrl.trim() || null,
      messenger_username: input.messengerUsername.trim() || null,
      payment_qr_url: input.paymentQrUrl.trim() || null,
      cod_enabled: input.codEnabled,
      cod_weekday: input.codEnabled ? input.codWeekday : null,
      live_mode_seconds: liveModeSeconds,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "admin_id" },
  );
  if (error) {
    if (error.code === "23505") throw new Error("That handle is already taken - pick another.");
    throw new Error(error.message);
  }
  revalidateAdmin();
}

export async function markPricesReviewed() {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("seller_profiles")
    .update({ price_reviewed_at: new Date().toISOString() })
    .eq("admin_id", admin.id);
  if (error) throw new Error(error.message);
  revalidateAdmin();
}

// ---------------------------------------------------------------------------
// Wanted Cards - a buyer's "can't find it" request (name + reference photo),
// shared across every admin (not scoped per-admin, since demand isn't owned
// by any one seller). Buyer writes go through RLS directly (see
// components/WantedCardForm.tsx); this is just the admin-side status update.
// ---------------------------------------------------------------------------

export async function updateWantedCardStatus(id: string, status: WantedCardStatus) {
  await requireAdmin();
  const supabase = createAdminClient();

  const { data: wanted } = await supabase
    .from("wanted_cards")
    .select("buyer_id, card_name")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("wanted_cards").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/wanted");

  if (status === "FULFILLED" && wanted?.buyer_id) {
    await notifyUser(supabase, {
      recipientId: wanted.buyer_id,
      type: "wanted_card_fulfilled",
      title: "Someone's got what you were looking for",
      body: `"${wanted.card_name}" is now listed - check the marketplace.`,
      link: "/marketplace",
    });
  }
}
