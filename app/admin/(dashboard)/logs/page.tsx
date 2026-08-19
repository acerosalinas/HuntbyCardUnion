import { SalesLogTable } from "@/components/admin/SalesLogTable";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";
import { CardRow, cardFromRow } from "@/types/marketplace";

export default async function AdminLogsPage() {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  let query = supabase
    .from("cards")
    .select("*")
    .eq("status", "SOLD")
    .order("sold_at", { ascending: false });

  if (admin.role !== "SUPER_ADMIN") {
    query = query.eq("admin_id", admin.id);
  }

  const { data } = await query;
  const cards = ((data as CardRow[] | null) ?? []).map(cardFromRow);

  return <SalesLogTable cards={cards} />;
}
