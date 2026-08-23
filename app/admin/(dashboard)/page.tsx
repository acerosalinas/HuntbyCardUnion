import { PendingPaymentsTable, PendingClaimView } from "@/components/admin/PendingPaymentsTable";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";

interface ClaimJoinRow {
  id: string;
  card_id: string;
  buyer_handle: string;
  order_id: string | null;
  quantity: number;
  unit_price: number;
  claimed_at: string;
  cards: { title: string; admin_id: string | null } | null;
}

export default async function AdminPendingPaymentsPage() {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  let query = supabase
    .from("card_claims")
    .select("id, card_id, buyer_handle, order_id, quantity, unit_price, claimed_at, cards!inner(title, admin_id)")
    .eq("status", "PENDING")
    .order("order_id", { ascending: true, nullsFirst: true })
    .order("claimed_at", { ascending: true });

  if (admin.role !== "SUPER_ADMIN") {
    query = query.eq("cards.admin_id", admin.id);
  }

  const { data } = await query;
  const claims: PendingClaimView[] = ((data as unknown as ClaimJoinRow[] | null) ?? []).map((row) => ({
    id: row.id,
    cardId: row.card_id,
    cardTitle: row.cards?.title ?? "Card",
    buyerHandle: row.buyer_handle,
    orderId: row.order_id,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    claimedAt: new Date(row.claimed_at).getTime(),
  }));

  const queueCounts: Record<string, number> = {};
  const cardIds = [...new Set(claims.map((c) => c.cardId))];
  if (cardIds.length > 0) {
    const { data: queueRows } = await supabase
      .from("dibs_queue")
      .select("card_id")
      .in("card_id", cardIds)
      .eq("status", "WAITING");
    for (const row of queueRows ?? []) {
      queueCounts[row.card_id] = (queueCounts[row.card_id] ?? 0) + 1;
    }
  }

  return <PendingPaymentsTable claims={claims} queueCounts={queueCounts} />;
}
