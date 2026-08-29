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
  ship_requested_at: string | null;
  cards: { title: string; admin_id: string | null } | null;
}

export default async function AdminLogsPage() {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const isSuperAdmin = admin.role === "SUPER_ADMIN";

  let query = supabase
    .from("card_claims")
    .select(
      "id, card_id, buyer_handle, order_id, quantity, unit_price, confirmed_at, shipped, ship_requested_at, cards!inner(title, admin_id)",
    )
    .eq("status", "SOLD")
    .order("confirmed_at", { ascending: false });

  if (!isSuperAdmin) {
    query = query.eq("cards.admin_id", admin.id);
  }

  const { data } = await query;
  const rows = (data as unknown as ClaimJoinRow[] | null) ?? [];

  // A super admin sees every seller's sales in one list - without knowing
  // whose is whose, that's just noise (see the "who sold what" problem this
  // was flagged for). No FK exists PostgREST can auto-embed from cards to
  // seller_profiles (both independently reference auth.users, not each
  // other), so this is a second lookup, only needed for the super admin case.
  let sellerNameByAdminId = new Map<string, string>();
  if (isSuperAdmin) {
    const adminIds = [...new Set(rows.map((r) => r.cards?.admin_id).filter((id): id is string => Boolean(id)))];
    if (adminIds.length > 0) {
      const { data: profiles } = await supabase
        .from("seller_profiles")
        .select("admin_id, display_name")
        .in("admin_id", adminIds);
      sellerNameByAdminId = new Map(
        ((profiles ?? []) as { admin_id: string; display_name: string }[]).map((p) => [p.admin_id, p.display_name]),
      );
    }
  }

  const claims: SoldClaimView[] = rows.map((row) => ({
    id: row.id,
    cardId: row.card_id,
    cardTitle: row.cards?.title ?? "Card",
    buyerHandle: row.buyer_handle,
    orderId: row.order_id,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).getTime() : null,
    shipped: row.shipped,
    shipRequestedAt: row.ship_requested_at ? new Date(row.ship_requested_at).getTime() : null,
    sellerAdminId: row.cards?.admin_id ?? null,
    sellerName: row.cards?.admin_id ? (sellerNameByAdminId.get(row.cards.admin_id) ?? "Unnamed seller") : null,
  }));

  return <SalesLogTable claims={claims} isSuperAdmin={isSuperAdmin} currentAdminId={admin.id} />;
}
