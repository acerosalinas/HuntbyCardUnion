"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAuthServerClient } from "@/lib/supabase/authServer";
import { assertOwnsOrSuper, requireAdmin, AdminRole } from "@/lib/adminAuth";
import { sendOrderConfirmedEmail } from "@/lib/email";
import { validateImageFile } from "@/lib/imageValidation";
import { canTransitionDispute } from "@/lib/disputeStatus";
import { DisputeStatus, SellerProfile, SellerProfileRow, sellerProfileFromRow } from "@/types/marketplace";

function revalidateAdmin() {
  revalidatePath("/admin");
  revalidatePath("/admin/offers");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/manage");
  revalidatePath("/admin/logs");
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

/** Marks any remaining WAITING queue entries for a card as CANCELLED - used whenever the card's PENDING chain ends (sold or released). */
async function cancelQueue(supabase: ReturnType<typeof createAdminClient>, cardId: string) {
  await supabase
    .from("dibs_queue")
    .update({ status: "CANCELLED" })
    .eq("card_id", cardId)
    .eq("status", "WAITING");
}

/**
 * Emails the buyer once payment is confirmed. Fires once per card, but a
 * cart checkout groups multiple cards into one `orders` row - to avoid
 * spamming one email per card, this only actually sends once every card in
 * the order is accounted for (try_claim_order_confirmation is an atomic
 * single-row claim in Postgres, so concurrent per-card confirmations can't
 * both win and send duplicate emails - see schema.sql for why a plain
 * count-remaining-unconfirmed check from Node would be racy). Cards with no
 * order_id (a single claim or accepted offer, not a cart checkout) email
 * immediately. Never throws - a failed lookup/send must not surface as a
 * failure of the actual payment confirmation.
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

      const { data: orderCards } = await supabase
        .from("cards")
        .select("title, price")
        .eq("order_id", orderId)
        .eq("status", "SOLD");
      if (orderCards && orderCards.length > 0) {
        items = orderCards;
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

export async function confirmPaid(cardId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  assertOwnsOrSuper(admin, await getCardOwner(supabase, cardId));

  const { data: card, error: fetchError } = await supabase
    .from("cards")
    .select("title, price, claimant_id, order_id")
    .eq("id", cardId)
    .single();
  if (fetchError || !card) throw new Error(fetchError?.message ?? "Card not found");

  const { error } = await supabase
    .from("cards")
    .update({ status: "SOLD", sold_at: new Date().toISOString() })
    .eq("id", cardId);
  if (error) throw new Error(error.message);

  await cancelQueue(supabase, cardId);
  revalidateAdmin();

  if (card.claimant_id) {
    await notifyBuyerPaymentConfirmed(supabase, card.claimant_id, card.order_id, {
      title: card.title,
      price: card.price,
    });
  }
}

export async function cancelRelist(cardId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { data: card, error: cardFetchError } = await supabase
    .from("cards")
    .select("admin_id, list_price")
    .eq("id", cardId)
    .single();
  if (cardFetchError || !card) throw new Error(cardFetchError?.message ?? "Card not found");
  assertOwnsOrSuper(admin, card.admin_id);

  const { count } = await supabase
    .from("disputes")
    .select("id", { count: "exact", head: true })
    .eq("card_id", cardId)
    .not("status", "in", "(RESOLVED_REFUND,RESOLVED_DISMISSED)");
  if (count && count > 0) {
    throw new Error("This card has an open dispute - resolve it before relisting.");
  }

  // Restore the real listed price - if this claim came from an accepted
  // offer, `price` was overwritten with the negotiated amount, and that
  // discount shouldn't stick around for whoever claims it next.
  const { error } = await supabase
    .from("cards")
    .update({
      status: "AVAILABLE",
      current_claimant: null,
      claimant_id: null,
      claimed_at: null,
      order_id: null,
      price: card.list_price,
    })
    .eq("id", cardId);
  if (error) throw new Error(error.message);

  await cancelQueue(supabase, cardId);
  revalidateAdmin();
}

/**
 * Promotes the earliest WAITING queue entry to be the card's new claimant
 * (the admin then reaches out to that buyer manually, since the app has no
 * way to message them directly). Falls back to releasing the card to
 * AVAILABLE if the queue is empty.
 */
export async function promoteNextInQueue(cardId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { data: card, error: cardFetchError } = await supabase
    .from("cards")
    .select("admin_id, list_price")
    .eq("id", cardId)
    .single();
  if (cardFetchError || !card) throw new Error(cardFetchError?.message ?? "Card not found");
  assertOwnsOrSuper(admin, card.admin_id);

  const { data: next, error: fetchError } = await supabase
    .from("dibs_queue")
    .select("*")
    .eq("card_id", cardId)
    .eq("status", "WAITING")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);

  if (!next) {
    const { error } = await supabase
      .from("cards")
      .update({
        status: "AVAILABLE",
        current_claimant: null,
        claimant_id: null,
        claimed_at: null,
        order_id: null,
        price: card.list_price,
      })
      .eq("id", cardId);
    if (error) throw new Error(error.message);
    revalidateAdmin();
    return { promoted: false as const };
  }

  // The buyer being promoted never negotiated the previous claimant's
  // offer-discounted price, so this resets to the real listed price too.
  const { error: cardError } = await supabase
    .from("cards")
    .update({
      current_claimant: next.buyer_handle,
      claimant_id: next.buyer_id,
      status: "PENDING",
      claimed_at: new Date().toISOString(),
      price: card.list_price,
    })
    .eq("id", cardId);
  if (cardError) throw new Error(cardError.message);

  const { error: queueError } = await supabase
    .from("dibs_queue")
    .update({ status: "PROMOTED" })
    .eq("id", next.id);
  if (queueError) throw new Error(queueError.message);

  revalidateAdmin();
  return { promoted: true as const, buyerHandle: next.buyer_handle as string };
}

export async function setShipped(cardId: string, shipped: boolean) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  assertOwnsOrSuper(admin, await getCardOwner(supabase, cardId));

  const { error } = await supabase.from("cards").update({ shipped }).eq("id", cardId);
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

  assertOwnsOrSuper(admin, await getCardOwner(supabase, offer.card_id));

  const { error: cardError } = await supabase
    .from("cards")
    .update({
      status: "PENDING",
      price: offer.offered_amount,
      current_claimant: offer.buyer_handle,
      claimant_id: offer.buyer_id,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", offer.card_id);
  if (cardError) throw new Error(cardError.message);

  const { error: offerError } = await supabase
    .from("offers")
    .update({ status: "ACCEPTED" })
    .eq("id", offerId);
  if (offerError) throw new Error(offerError.message);

  await supabase
    .from("offers")
    .update({ status: "SUPERSEDED" })
    .eq("card_id", offer.card_id)
    .eq("status", "PENDING");

  await cancelQueue(supabase, offer.card_id);
  revalidateAdmin();
}

export async function counterOffer(offerId: string, counterAmount: number) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { data: offer, error: fetchError } = await supabase
    .from("offers")
    .select("card_id")
    .eq("id", offerId)
    .single();
  if (fetchError || !offer) throw new Error(fetchError?.message ?? "Offer not found");

  assertOwnsOrSuper(admin, await getCardOwner(supabase, offer.card_id));

  const { error } = await supabase
    .from("offers")
    .update({
      offered_amount: counterAmount,
      note: `Countered by admin: ${counterAmount}`,
    })
    .eq("id", offerId);
  if (error) throw new Error(error.message);
  revalidateAdmin();
}

export async function declineOffer(offerId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { data: offer, error: fetchError } = await supabase
    .from("offers")
    .select("card_id")
    .eq("id", offerId)
    .single();
  if (fetchError || !offer) throw new Error(fetchError?.message ?? "Offer not found");

  assertOwnsOrSuper(admin, await getCardOwner(supabase, offer.card_id));

  const { error } = await supabase.from("offers").update({ status: "DECLINED" }).eq("id", offerId);
  if (error) throw new Error(error.message);
  revalidateAdmin();
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
    .select("seller_admin_id, status")
    .eq("id", disputeId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Dispute not found");
  return data as { seller_admin_id: string | null; status: DisputeStatus };
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
}

export async function logout() {
  const supabase = await createAuthServerClient("admin");
  await supabase.auth.signOut();
  redirect("/admin/login");
}

export async function uploadCardImages(formData: FormData): Promise<string[]> {
  await requireAdmin();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return [];

  const supabase = createAdminClient();
  const urls: string[] = [];

  for (const file of files) {
    const { bytes, contentType } = await validateImageFile(file);

    const ext = file.name.split(".").pop() || "jpg";
    const path = `${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage.from("card-images").upload(path, bytes, {
      contentType,
      upsert: false,
    });
    if (error) throw new Error(`${file.name}: ${error.message}`);

    const { data } = supabase.storage.from("card-images").getPublicUrl(path);
    urls.push(data.publicUrl);
  }

  return urls;
}

/** Uploads a seller's avatar image, reusing the public card-images bucket (same upload path/policy). */
export async function uploadAvatarImage(formData: FormData): Promise<string> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file provided.");

  const { bytes, contentType } = await validateImageFile(file);

  const ext = file.name.split(".").pop() || "jpg";
  const path = `avatars/${crypto.randomUUID()}.${ext}`;

  const supabase = createAdminClient();
  const { error } = await supabase.storage.from("card-images").upload(path, bytes, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from("card-images").getPublicUrl(path);
  return data.publicUrl;
}

export interface CreateCardInput {
  title: string;
  setName: string;
  price: number;
  conditionGrade: string;
  images: string[];
  sellerHandle: string;
  sellerMessenger: string;
  isFlashSale: boolean;
  franchise: string;
}

export async function createCard(input: CreateCardInput) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.from("cards").insert({
    title: input.title,
    set_name: input.setName,
    price: input.price,
    list_price: input.price,
    condition_grade: input.conditionGrade,
    images: input.images,
    seller_handle: input.sellerHandle,
    seller_messenger: input.sellerMessenger,
    is_flash_sale: input.isFlashSale,
    franchise: input.franchise,
    admin_id: admin.id,
  });
  if (error) throw new Error(error.message);
  revalidateAdmin();
}

export async function updateCard(cardId: string, input: CreateCardInput) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  assertOwnsOrSuper(admin, await getCardOwner(supabase, cardId));

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
      images: input.images,
      seller_handle: input.sellerHandle,
      seller_messenger: input.sellerMessenger,
      is_flash_sale: input.isFlashSale,
      franchise: input.franchise,
    })
    .eq("id", cardId);
  if (error) throw new Error(error.message);
  revalidateAdmin();
}

// ---------------------------------------------------------------------------
// Admin account management (super admin only).
// ---------------------------------------------------------------------------

export interface AdminAccount {
  id: string;
  email: string;
  role: AdminRole;
  active: boolean;
  createdAt: number;
}

async function requireSuperAdmin() {
  const admin = await requireAdmin();
  if (admin.role !== "SUPER_ADMIN") throw new Error("Only super admins can manage admin accounts.");
  return admin;
}

export async function listAdmins(): Promise<AdminAccount[]> {
  await requireSuperAdmin();
  const supabase = createAdminClient();
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw new Error(error.message);

  return data.users
    .map((u) => ({
      id: u.id,
      email: u.email ?? "(no email)",
      role: (u.app_metadata?.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN") as AdminRole,
      active: !u.banned_until || new Date(u.banned_until) <= new Date(),
      createdAt: new Date(u.created_at).getTime(),
    }))
    .sort((a, b) => a.createdAt - b.createdAt);
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
