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
  cards: { title: string; price: number; admin_id: string | null; images: string[]; held_until: string | null } | null;
}

export default async function AdminOffersPage() {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  // ACCEPTED alongside PENDING - an admin can still retract an offer
  // they already accepted, as long as the buyer hasn't spent it via
  // place_order yet (see declineOffer's guard in app/admin/actions.ts).
  let query = supabase
    .from("offers")
    // cards!offers_card_id_fkey, not plain cards!inner - cards.holding_offer_id
    // (added by migration_offer_hold.sql) is a second FK between these two
    // tables, so PostgREST can no longer infer which relationship to embed
    // without this hint. Without it, every query on this page errored
    // "more than one relationship was found" and silently came back empty
    // (the error wasn't checked), which is why incoming offers stopped
    // showing up here the moment that migration went live, even though
    // submit_offer itself kept working and notifying the admin correctly.
    .select(
      "id, card_id, buyer_handle, offered_amount, agreed_amount, note, status, created_at, cards!offers_card_id_fkey!inner(title, price, admin_id, images, held_until)",
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
    heldUntil: row.cards?.held_until ? new Date(row.cards.held_until).getTime() : null,
  }));

  return <OffersTable offers={offers} />;
}
