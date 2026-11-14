import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadClaimPlans } from "@/lib/claimInstallmentsData";
import type { MarketClaim } from "./marketplaceLink";

type Db = ReturnType<typeof createAdminClient>;

interface Row {
  id: string;
  buyer_id: string;
  order_id: string | null;
  quantity: number;
  unit_price: number | string;
  status: "PENDING" | "SOLD";
  claimed_at: string;
  shipped: boolean;
  fulfillment_method: "SHIP" | "STASH";
  payment_method: "PREPAID" | "COD";
  ship_requested_at: string | null;
  pack_number: number | null;
  proof_path: string | null;
  proof_note: string | null;
  proof_uploaded_at: string | null;
  cards: { title: string; images: string[] | null } | { title: string; images: string[] | null }[] | null;
}

/**
 * Marketplace orders (not yet received) on THIS seller's cards, for the given buyer accounts - or for every buyer when `buyerIds` is null.
 * Scoped by cards.admin_id: the service-role client bypasses RLS, so that filter is what keeps another seller's orders out.
 */
export async function loadMarketplaceClaims(db: Db, ownerId: string, buyerIds: string[] | null): Promise<MarketClaim[]> {
  if (buyerIds && buyerIds.length === 0) return [];
  let query = db
    .from("card_claims")
    .select(
      "id, buyer_id, order_id, quantity, unit_price, status, claimed_at, shipped, fulfillment_method, payment_method, ship_requested_at, pack_number, proof_path, proof_note, proof_uploaded_at, cards!inner(title, images)",
    )
    .eq("cards.admin_id", ownerId)
    .in("status", ["PENDING", "SOLD"])
    .is("received_at", null)
    .not("buyer_id", "is", null)
    .order("claimed_at", { ascending: false })
    .limit(2000);
  if (buyerIds) query = query.in("buyer_id", buyerIds);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  // Orders being paid in installments owe less than their price: the installments the seller has confirmed so far come off it.
  const plans = await loadClaimPlans(db, ((data ?? []) as unknown as Row[]).filter((r) => r.status === "PENDING").map((r) => r.id));
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const card = Array.isArray(r.cards) ? r.cards[0] : r.cards;
    return {
      id: r.id,
      buyerId: r.buyer_id,
      orderId: r.order_id,
      title: card?.title ?? "Card",
      packNumber: r.pack_number,
      image: card?.images?.[0] ?? null,
      amount: Math.round(Number(r.unit_price) * r.quantity * 100) / 100,
      paid: plans.get(r.id)?.status === "ACTIVE" ? plans.get(r.id)?.confirmed : undefined,
      status: r.status,
      paymentMethod: r.payment_method,
      fulfillment: r.fulfillment_method,
      shipped: r.shipped,
      shipRequestedAt: r.ship_requested_at,
      claimedAt: r.claimed_at,
      proofPath: r.proof_path,
      proofNote: r.proof_note,
      proofUploadedAt: r.proof_uploaded_at,
    };
  });
}
