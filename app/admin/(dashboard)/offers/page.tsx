import { OffersTable, OfferRowView } from "@/components/admin/OffersTable";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";

interface OfferJoinRow {
  id: string;
  card_id: string;
  buyer_handle: string;
  offered_amount: number;
  note: string | null;
  created_at: string;
  cards: { title: string; price: number; admin_id: string | null } | null;
}

export default async function AdminOffersPage() {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  let query = supabase
    .from("offers")
    .select("id, card_id, buyer_handle, offered_amount, note, created_at, cards!inner(title, price, admin_id)")
    .eq("status", "PENDING")
    .order("created_at", { ascending: false });

  if (admin.role !== "SUPER_ADMIN") {
    query = query.eq("cards.admin_id", admin.id);
  }

  const { data } = await query.returns<OfferJoinRow[]>();

  const offers: OfferRowView[] = (data ?? []).map((row) => ({
    id: row.id,
    cardId: row.card_id,
    cardTitle: row.cards?.title ?? "Unknown card",
    listedPrice: row.cards?.price ?? 0,
    offeredAmount: row.offered_amount,
    buyerHandle: row.buyer_handle,
    note: row.note,
    createdAt: new Date(row.created_at).getTime(),
  }));

  return <OffersTable offers={offers} />;
}
