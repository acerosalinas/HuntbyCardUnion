import { OffersTable, OfferRowView } from "@/components/admin/OffersTable";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";

interface OfferJoinRow {
  id: string;
  card_id: string;
  buyer_handle: string;
  offered_amount: number;
  agreed_amount: number | null;
  note: string | null;
  status: "PENDING" | "ACCEPTED";
  created_at: string;
  cards: { title: string; price: number; admin_id: string | null; images: string[] } | null;
}

export default async function AdminOffersPage() {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  // ACCEPTED alongside PENDING - an admin can still retract an offer
  // they already accepted, as long as the buyer hasn't spent it via
  // place_order yet (see declineOffer's guard in app/admin/actions.ts).
  let query = supabase
    .from("offers")
    .select(
      "id, card_id, buyer_handle, offered_amount, agreed_amount, note, status, created_at, cards!inner(title, price, admin_id, images)",
    )
    .in("status", ["PENDING", "ACCEPTED"])
    .order("created_at", { ascending: false });

  if (admin.role !== "SUPER_ADMIN") {
    query = query.eq("cards.admin_id", admin.id);
  }

  const { data } = await query.returns<OfferJoinRow[]>();

  const offers: OfferRowView[] = (data ?? []).map((row) => ({
    id: row.id,
    cardId: row.card_id,
    cardTitle: row.cards?.title ?? "Unknown card",
    cardImage: row.cards?.images?.[0] ?? null,
    listedPrice: row.cards?.price ?? 0,
    offeredAmount: row.offered_amount,
    agreedAmount: row.agreed_amount,
    buyerHandle: row.buyer_handle,
    note: row.note,
    status: row.status,
    createdAt: new Date(row.created_at).getTime(),
  }));

  return <OffersTable offers={offers} />;
}
