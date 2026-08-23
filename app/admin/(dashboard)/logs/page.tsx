import { SalesLogTable, SoldClaimView } from "@/components/admin/SalesLogTable";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";

interface ClaimJoinRow {
  id: string;
  card_id: string;
  buyer_handle: string;
  order_id: string | null;
  quantity: number;
  unit_price: number;
  confirmed_at: string | null;
  shipped: boolean;
  cards: { title: string; admin_id: string | null } | null;
}

export default async function AdminLogsPage() {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  let query = supabase
    .from("card_claims")
    .select("id, card_id, buyer_handle, order_id, quantity, unit_price, confirmed_at, shipped, cards!inner(title, admin_id)")
    .eq("status", "SOLD")
    .order("confirmed_at", { ascending: false });

  if (admin.role !== "SUPER_ADMIN") {
    query = query.eq("cards.admin_id", admin.id);
  }

  const { data } = await query;
  const claims: SoldClaimView[] = ((data as unknown as ClaimJoinRow[] | null) ?? []).map((row) => ({
    id: row.id,
    cardId: row.card_id,
    cardTitle: row.cards?.title ?? "Card",
    buyerHandle: row.buyer_handle,
    orderId: row.order_id,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).getTime() : null,
    shipped: row.shipped,
  }));

  return <SalesLogTable claims={claims} />;
}
