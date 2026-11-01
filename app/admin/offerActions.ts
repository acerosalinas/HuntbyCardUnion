"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { assertOwnsOrSuper, requireAdmin } from "@/lib/adminAuth";
import { notifyUser } from "@/lib/notify";
import { formatCurrency } from "@/lib/utils";
import { revalidateAdmin, getCardOwner } from "./actionHelpers";

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

  // No claim is created here, and no stock is touched - accepting just
  // unlocks the negotiated price and keeps the card on hold (see
  // migration_offer_hold.sql). The buyer still goes through a normal Add
  // to Cart -> Place Order like any other purchase (choosing Ship/Stash,
  // Pay Now/COD) - see place_order's offer_id handling in
  // supabase/schema.sql. accept_offer_admin locks the offer row and
  // re-checks status = PENDING inside one transaction (same pattern as
  // confirm_paid_claim etc.), so it can't race with a second admin action
  // or an in-flight buyer response on the same offer.
  const { error: rpcError } = await supabase.rpc("accept_offer_admin", { p_offer_id: offerId });
  if (rpcError) throw new Error(rpcError.message);

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

  assertOwnsOrSuper(admin, await getCardOwner(supabase, offer.card_id));

  const { error: rpcError } = await supabase.rpc("counter_offer_admin", {
    p_offer_id: offerId,
    p_counter_amount: counterAmount,
  });
  if (rpcError) throw new Error(rpcError.message);
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

  assertOwnsOrSuper(admin, await getCardOwner(supabase, offer.card_id));

  // Also usable on an already-ACCEPTED offer - the seller retracting a
  // price they agreed to but the buyer hasn't spent yet (no card_claims
  // row exists until place_order's own offer_id handling creates one, so
  // there's nothing to unwind on the claim side either way). Frees the
  // card's hold either way.
  const { error: rpcError } = await supabase.rpc("decline_offer_admin", { p_offer_id: offerId });
  if (rpcError) throw new Error(rpcError.message);
  revalidateAdmin();

  await notifyUser(supabase, {
    recipientId: offer.buyer_id,
    type: "offer_declined",
    title: "Your offer was declined",
    link: `/card/${offer.card_id}`,
  });
}
