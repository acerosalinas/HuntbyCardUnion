import { createAdminClient } from "@/lib/supabase/admin";
import { requireTrackerAdminOrRedirect } from "@/lib/tracker/auth";
import { loadTrackerData } from "@/lib/tracker/data";
import { buildStash, StashClaimInput } from "@/lib/tracker/stash";
import { StashView } from "@/components/tracker/StashView";

export const dynamic = "force-dynamic";

interface ClaimCard {
  title: string;
  set_name: string | null;
  images: string[] | null;
  seller_handle: string;
}

interface ClaimRow {
  id: string;
  buyer_id: string | null;
  buyer_handle: string;
  quantity: number;
  unit_price: number | string;
  status: "PENDING" | "SOLD";
  claimed_at: string;
  confirmed_at: string | null;
  cards: ClaimCard | ClaimCard[] | null;
}

export default async function TrackerStashPage() {
  const admin = await requireTrackerAdminOrRedirect();
  const data = await loadTrackerData(admin.id);
  const db = createAdminClient();

  // Marketplace orders the buyer chose "Stash With Us" for and that are still with us (not yet received).
  const { data: rows, error } = await db
    .from("card_claims")
    .select("id, buyer_id, buyer_handle, quantity, unit_price, status, claimed_at, confirmed_at, cards(title, set_name, images, seller_handle)")
    .eq("fulfillment_method", "STASH")
    .in("status", ["PENDING", "SOLD"])
    .is("received_at", null)
    .limit(2000);
  if (error) throw new Error(error.message);
  const claimRows = (rows ?? []) as unknown as ClaimRow[];

  const buyerIds = [...new Set(claimRows.map((r) => r.buyer_id).filter((id): id is string => Boolean(id)))];
  const { data: profiles } = buyerIds.length ? await db.from("profiles").select("id, full_name").in("id", buyerIds) : { data: [] as { id: string; full_name: string | null }[] };
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  const claims: StashClaimInput[] = claimRows.map((r) => {
    const card = Array.isArray(r.cards) ? r.cards[0] : r.cards;
    return {
      id: r.id,
      buyerId: r.buyer_id,
      buyerHandle: r.buyer_handle,
      buyerName: r.buyer_id ? (nameOf.get(r.buyer_id) ?? null) : null,
      title: card?.title ?? "Card",
      setName: card?.set_name ?? null,
      image: card?.images?.[0] ?? null,
      sellerHandle: card?.seller_handle ?? "",
      quantity: r.quantity,
      unitPrice: Number(r.unit_price),
      status: r.status,
      heldSince: r.confirmed_at ?? r.claimed_at,
    };
  });

  const groups = buildStash({
    customers: data.customers,
    lives: data.lives,
    sales: data.sales,
    paidBySale: data.paidBySale,
    claims,
    nowMs: new Date().getTime(),
  });

  return <StashView groups={groups} />;
}
