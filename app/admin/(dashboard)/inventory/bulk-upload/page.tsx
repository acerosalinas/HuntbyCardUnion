import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BulkUploadWorkspace } from "@/components/admin/BulkUploadWorkspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";
import { CardRow, cardFromRow } from "@/types/marketplace";

export default async function BulkUploadPage() {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  // Always the acting admin's own drafts, regardless of role - a bulk
  // upload batch is inherently personal to whoever is doing the uploading,
  // same as createCard always stamping admin_id: admin.id. Resumable: shows
  // any drafts left over from a previous visit, not just this session's.
  const { data } = await supabase
    .from("cards")
    .select("*")
    .eq("admin_id", admin.id)
    .eq("status", "DRAFT")
    .order("created_at", { ascending: true });

  const drafts = ((data as CardRow[] | null) ?? []).map(cardFromRow);

  return (
    <div className="space-y-4">
      <Link
        href="/admin/inventory"
        className="inline-flex items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft size={16} />
        Back to Inventory
      </Link>
      <div>
        <h1 className="text-xl font-bold text-foreground">Bulk Upload &amp; Rapid Fill</h1>
        <p className="text-sm text-foreground-muted">
          Drop in your card photos, then fill in each one&apos;s details - press Enter to save and jump to the next.
        </p>
      </div>
      <BulkUploadWorkspace initialDrafts={drafts} />
    </div>
  );
}
