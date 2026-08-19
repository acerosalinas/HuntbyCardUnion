import { PendingPaymentsTable } from "@/components/admin/PendingPaymentsTable";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";
import { CardRow, cardFromRow } from "@/types/marketplace";

export default async function AdminPendingPaymentsPage() {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  let query = supabase
    .from("cards")
    .select("*")
    .eq("status", "PENDING")
    .order("order_id", { ascending: true, nullsFirst: true })
    .order("claimed_at", { ascending: true });

  if (admin.role !== "SUPER_ADMIN") {
    query = query.eq("admin_id", admin.id);
  }

  const { data } = await query;
  const cards = ((data as CardRow[] | null) ?? []).map(cardFromRow);

  const queueCounts: Record<string, number> = {};
  const cardIds = cards.map((c) => c.id);
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

  return <PendingPaymentsTable cards={cards} queueCounts={queueCounts} />;
}
