import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertOwnsOrSuper, requireAdmin } from "@/lib/adminAuth";
import { DisputeStatusBadge } from "@/components/DisputeStatusBadge";
import { DISPUTE_REASON_LABELS } from "@/lib/disputeLabels";
import { DisputeEvidenceRow, DisputeRow, disputeEvidenceFromRow, disputeFromRow } from "@/types/marketplace";
import { DisputeActionsPanel } from "./DisputeActionsPanel";

export const dynamic = "force-dynamic";

export default async function AdminDisputeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { data: disputeRow } = await supabase.from("disputes").select("*").eq("id", id).maybeSingle<DisputeRow>();
  if (!disputeRow) notFound();

  assertOwnsOrSuper(admin, disputeRow.seller_admin_id);

  const dispute = disputeFromRow(disputeRow);
  const { data: card } = await supabase.from("cards").select("title").eq("id", dispute.cardId).maybeSingle();
  // Drives the "restock decision needed" prompt below - only relevant once
  // resolved as a refund, and only until the seller has actually decided
  // (see resolveDisputeRestock in app/admin/actions.ts).
  const claimStatus = dispute.claimId
    ? (await supabase.from("card_claims").select("status").eq("id", dispute.claimId).maybeSingle()).data?.status ?? null
    : null;
  const { data: buyerProfile } = await supabase
    .from("profiles")
    .select("handle, full_name")
    .eq("id", dispute.buyerId)
    .maybeSingle();

  const { data: evidenceRows } = await supabase
    .from("dispute_evidence")
    .select("*")
    .eq("dispute_id", id)
    .order("created_at", { ascending: true })
    .returns<DisputeEvidenceRow[]>();

  const evidence = await Promise.all(
    (evidenceRows ?? []).map(async (row) => {
      const item = disputeEvidenceFromRow(row);
      if (item.storagePath) {
        const { data: signed } = await supabase.storage
          .from("dispute-evidence")
          .createSignedUrl(item.storagePath, 300);
        item.signedUrl = signed?.signedUrl ?? null;
      }
      return item;
    }),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">{card?.title ?? "Unknown item"}</h1>
          <p className="text-sm text-foreground-muted">
            {DISPUTE_REASON_LABELS[dispute.reason]} &middot; {buyerProfile?.handle ?? "Unknown buyer"} (
            {buyerProfile?.full_name ?? "—"})
          </p>
        </div>
        <DisputeStatusBadge status={dispute.status} />
      </div>
      <p className="rounded-xl border border-card-border bg-card p-4 text-sm text-foreground">
        {dispute.description}
      </p>
      <DisputeActionsPanel dispute={dispute} evidence={evidence} claimStatus={claimStatus} />
    </div>
  );
}
