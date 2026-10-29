"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAuthServerClient } from "@/lib/supabase/authServer";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBuyer } from "@/lib/buyerAuth";
import { HANDLE_REGEX, normalizeHandle } from "@/lib/handleFormat";
import { validateImageFile } from "@/lib/imageValidation";
import { uploadToR2 } from "@/lib/r2";
import { notifyUser } from "@/lib/notify";
import { sendWishlistAdminEmail } from "@/lib/email";
import { wishlistRecipients } from "@/lib/wishlistNotify";
import { adminAlertText, MAX_WISHLIST_ALERTS_PER_HOUR, WishlistKind } from "@/lib/wishlistText";

export async function logout() {
  const supabase = await createAuthServerClient("buyer");
  await supabase.auth.signOut();
  // Not "/" - the whole site requires a session (see proxy.ts), so that would
  // just bounce straight back through middleware to this same destination
  // one extra hop later.
  redirect("/account/login");
}

export interface UpdateBuyerProfileInput {
  fullName: string;
  handle: string;
  email: string;
  /** Empty string means "leave unchanged" - not every save is a password change. */
  newPassword: string;
  /** Saved shipping default - checkout (CartContents) pre-fills from these instead of asking every order. */
  shipName: string;
  shipPhone: string;
  shipAddress: string;
  shipZip: string;
}

/**
 * A buyer editing their own profile. Uses the service-role client for the
 * `profiles` row (same as signup's handle-uniqueness check in
 * app/account/signup/actions.ts - profiles RLS is owner-select-only, no
 * update policy, and this is a trusted Server Action, so there's no need to
 * add one) but the buyer's own session client for the Auth-level fields
 * (email, password), since those act on "the current session's user", not
 * an arbitrary id.
 */
export async function updateBuyerProfile(input: UpdateBuyerProfileInput): Promise<{ emailChangePending: boolean }> {
  const buyer = await getCurrentBuyer();
  if (!buyer) throw new Error("Not signed in.");

  const fullName = input.fullName.trim();
  const handle = normalizeHandle(input.handle);
  const email = input.email.trim();

  if (!fullName) throw new Error("Full name is required.");
  if (!HANDLE_REGEX.test(handle)) throw new Error("Handle must be 3-20 letters, numbers, or underscores.");
  if (!email) throw new Error("Email is required.");

  const adminClient = createAdminClient();

  if (handle !== buyer.handle) {
    const escapedHandle = handle.replace(/[%_]/g, (m) => `\\${m}`);
    const { data: existing } = await adminClient
      .from("profiles")
      .select("id")
      .ilike("handle", escapedHandle)
      .neq("id", buyer.id)
      .maybeSingle();
    if (existing) throw new Error("That handle is already taken.");
  }

  const { error: profileError } = await adminClient
    .from("profiles")
    .update({
      handle,
      full_name: fullName,
      ship_name: input.shipName.trim() || null,
      ship_phone: input.shipPhone.trim() || null,
      ship_address: input.shipAddress.trim() || null,
      ship_zip: input.shipZip.trim() || null,
    })
    .eq("id", buyer.id);
  if (profileError) throw new Error(profileError.message);

  const supabase = await createAuthServerClient("buyer");
  let emailChangePending = false;

  if (email !== buyer.email) {
    const { error } = await supabase.auth.updateUser({ email });
    if (error) throw new Error(error.message);
    // Supabase emails the NEW address for confirmation - the old email
    // stays active until that's clicked, so nothing switches over yet.
    emailChangePending = true;
  }

  if (input.newPassword) {
    if (input.newPassword.length < 8) throw new Error("New password must be at least 8 characters.");
    const { error } = await supabase.auth.updateUser({ password: input.newPassword });
    if (error) throw new Error(error.message);
  }

  revalidatePath("/account");
  return { emailChangePending };
}

/**
 * Uploads a buyer's reference photo for a Wanted Card request (see
 * WantedCardForm). Buyer-gated (getCurrentBuyer, not requireAdmin) since
 * this is the one upload path in the app that isn't admin-only - reuses the
 * same magic-byte validation and the public card-images bucket as every
 * other upload, just under its own "wanted/" prefix.
 */
export async function uploadWantedCardPhoto(formData: FormData): Promise<string> {
  const buyer = await getCurrentBuyer();
  if (!buyer) throw new Error("Not signed in.");

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file provided.");

  const { bytes, contentType } = await validateImageFile(file);

  const ext = file.name.split(".").pop() || "jpg";
  const path = `wanted/${crypto.randomUUID()}.${ext}`;

  return uploadToR2(path, bytes, contentType);
}

/**
 * A buyer flagging a paid, stashed claim as "please ship this now" -
 * previously there was no way to ask for that once a card was stashed with
 * the seller. One-time per claim (ship_requested_at is set, not toggled),
 * notifies the owning admin, who marks it shipped the same way as any
 * other order (setShipped in app/admin/actions.ts, from the Sales Log).
 */
export async function requestShipping(claimId: string): Promise<void> {
  const buyer = await getCurrentBuyer();
  if (!buyer) throw new Error("Not signed in.");

  const supabase = createAdminClient();
  const { data: claim, error: fetchError } = await supabase
    .from("card_claims")
    .select("buyer_id, fulfillment_method, status, shipped, ship_requested_at, cards(admin_id, title)")
    .eq("id", claimId)
    .single();
  if (fetchError || !claim) throw new Error("Claim not found.");
  if (claim.buyer_id !== buyer.id) throw new Error("Claim not found.");
  if (claim.fulfillment_method !== "STASH") throw new Error("This item isn't stashed.");
  if (claim.status !== "SOLD") throw new Error("This item hasn't been paid for yet.");
  if (claim.shipped) throw new Error("This item has already been shipped.");
  if (claim.ship_requested_at) throw new Error("You've already requested shipping for this item.");

  const { error: updateError } = await supabase
    .from("card_claims")
    .update({ ship_requested_at: new Date().toISOString() })
    .eq("id", claimId);
  if (updateError) throw new Error(updateError.message);

  revalidatePath("/account/dibs");

  const card = claim.cards as unknown as { admin_id: string | null; title: string } | null;
  if (card?.admin_id) {
    await notifyUser(supabase, {
      recipientId: card.admin_id,
      type: "ship_requested",
      title: "Buyer wants their stashed card shipped",
      body: `${buyer.handle} wants "${card.title}" shipped now.`,
      link: "/admin/logs",
    });
  }
}

/**
 * Tells the admin (bell + email) that this buyer just added something to their wishlist:
 * a hearted listing ("wishlist", ref = card id) or a "can't find it" request ("wanted", ref = request id).
 * Called by the buyer's browser right after its own insert. The entry must belong to the signed-in buyer and
 * can alert only once (notified_at is claimed atomically), and one buyer is capped per hour, so it can't be
 * used to spam. It never throws: a failed alert must not make the buyer's wishlist action look broken.
 */
export async function announceWishlistAdded(kind: WishlistKind, ref: string): Promise<void> {
  try {
    const buyer = await getCurrentBuyer();
    if (!buyer) return;
    const db = createAdminClient();

    let table: "wishlists" | "wanted_cards";
    let rowId: string;
    let cardName: string;
    if (kind === "wanted") {
      const { data } = await db.from("wanted_cards").select("id, card_name, notified_at").eq("id", ref).eq("buyer_id", buyer.id).maybeSingle();
      if (!data || data.notified_at) return;
      table = "wanted_cards";
      rowId = data.id as string;
      cardName = data.card_name as string;
    } else {
      const { data } = await db.from("wishlists").select("id, notified_at, cards(title)").eq("card_id", ref).eq("buyer_id", buyer.id).maybeSingle();
      if (!data || data.notified_at) return;
      table = "wishlists";
      rowId = data.id as string;
      const card = data.cards as unknown as { title: string } | { title: string }[] | null;
      cardName = (Array.isArray(card) ? card[0]?.title : card?.title) ?? "a card";
    }

    // Claim the alert first: only one caller can flip notified_at from null, so a double-click can't double-send.
    const { data: claimed } = await db.from(table).update({ notified_at: new Date().toISOString() }).eq("id", rowId).is("notified_at", null).select("id").maybeSingle();
    if (!claimed) return;

    const { emails, adminIds } = await wishlistRecipients(db);
    const { title, body } = adminAlertText(kind, buyer.handle, cardName);

    // Rate limit per buyer: skip the alert (the entry itself is still saved) if they've already triggered plenty this hour.
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("type", "wishlist_added")
      .ilike("title", `%@${buyer.handle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
      .gte("created_at", since);
    if ((count ?? 0) >= MAX_WISHLIST_ALERTS_PER_HOUR * Math.max(1, adminIds.length)) return;

    for (const adminId of adminIds) {
      await notifyUser(db, { recipientId: adminId, type: "wishlist_added", title, body, link: "/admin/wanted" });
    }
    await sendWishlistAdminEmail({ to: emails, title, body, link: "/admin/wanted" });
  } catch (err) {
    console.error("Failed to announce wishlist entry:", err);
  }
}
