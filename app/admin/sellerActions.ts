"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertOwnsOrSuper, requireAdmin } from "@/lib/adminAuth";
import { notifyUser } from "@/lib/notify";
import { buyerResultText } from "@/lib/wishlistText";
import { SellerProfile, SellerProfileRow, WantedCardStatus, sellerProfileFromRow } from "@/types/marketplace";
import { revalidateAdmin } from "./actionHelpers";

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
  offerHoldHours: number;
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
  const offerHoldHours = Math.min(168, Math.max(1, Math.round(input.offerHoldHours) || 24));
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
      offer_hold_hours: offerHoldHours,
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

  if (!wanted?.buyer_id) return;

  if (status === "FULFILLED" || status === "CLOSED") {
    const text = buyerResultText(status, wanted.card_name);
    after(() =>
      notifyUser(supabase, {
        recipientId: wanted.buyer_id,
        type: status === "FULFILLED" ? "wanted_card_fulfilled" : "wanted_card_closed",
        title: text.title,
        body: text.body,
        link: "/marketplace",
      }),
    );
  }
}

/**
 * A buyer's hearted listing, answered the same way as a request: Fulfilled ("it's available - message us
 * to claim it") or Not fulfilled. Admins can answer hearts on their own listings; a super admin, any.
 */
export async function updateWishlistStatus(id: string, status: "OPEN" | "FULFILLED" | "CLOSED") {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { data: entry, error: findError } = await supabase
    .from("wishlists")
    .select("buyer_id, card_id, cards(title, admin_id)")
    .eq("id", id)
    .maybeSingle();
  if (findError) throw new Error(findError.message);
  if (!entry) throw new Error("Wishlist entry not found.");
  const card = entry.cards as unknown as { title: string; admin_id: string | null } | { title: string; admin_id: string | null }[] | null;
  const cardRow = Array.isArray(card) ? card[0] : card;
  assertOwnsOrSuper(admin, cardRow?.admin_id ?? null);

  const { error } = await supabase.from("wishlists").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/wanted");

  if (status === "FULFILLED" || status === "CLOSED") {
    const text = buyerResultText(status, cardRow?.title ?? "your card");
    after(() =>
      notifyUser(supabase, {
        recipientId: entry.buyer_id as string,
        type: status === "FULFILLED" ? "wanted_card_fulfilled" : "wanted_card_closed",
        title: text.title,
        body: text.body,
        link: status === "FULFILLED" ? `/card/${entry.card_id}` : "/marketplace",
      }),
    );
  }
}
