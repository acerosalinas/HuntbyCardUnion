import Link from "next/link";
import { UploadCloud } from "lucide-react";
import { InventoryForm } from "@/components/admin/InventoryForm";
import { InventoryView } from "@/components/admin/InventoryView";
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
      <div className="flex justify-end">
        <Link
          href="/admin/inventory/bulk-upload"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gold/40 bg-navy-950 px-3 py-1.5 text-sm font-medium text-gold transition-colors hover:bg-gold/10"
        >
          <UploadCloud size={14} />
          Bulk Upload
        </Link>
      </div>
      <InventoryForm />
      <InventoryView cards={cards} />
    </div>
  );
}
