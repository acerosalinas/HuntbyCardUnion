import { InventoryForm } from "@/components/admin/InventoryForm";
import { InventoryList } from "@/components/admin/InventoryList";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";
import { CardRow, cardFromRow } from "@/types/marketplace";

export default async function AdminInventoryPage() {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  let query = supabase.from("cards").select("*").order("created_at", { ascending: false });
  if (admin.role !== "SUPER_ADMIN") {
    query = query.eq("admin_id", admin.id);
  }

  const { data } = await query;
  const cards = ((data as CardRow[] | null) ?? []).map(cardFromRow);

  return (
    <div className="space-y-6">
      <InventoryForm />
      <InventoryList cards={cards} />
    </div>
  );
}
