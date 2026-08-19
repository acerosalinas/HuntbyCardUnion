import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createAuthServerClient } from "@/lib/supabase/authServer";
import { createAdminClient } from "@/lib/supabase/admin";
import { DisputeStatusBadge } from "@/components/DisputeStatusBadge";
import { DISPUTE_REASON_LABELS } from "@/lib/disputeLabels";
import { DisputeEvidenceRow, DisputeRow, disputeEvidenceFromRow, disputeFromRow } from "@/types/marketplace";
import { EvidenceTimeline } from "./EvidenceTimeline";

export const dynamic = "force-dynamic";

export default async function DisputeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createAuthServerClient("buyer");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/account/login?from=${encodeURIComponent(`/account/disputes/${id}`)}`);
  }

  // RLS-scoped: only returns a row if this buyer owns the dispute. This is
  // the ownership check the rest of the page relies on before generating
  // signed URLs below.
  const { data: disputeRow } = await supabase
    .from("disputes")
    .select("*")
    .eq("id", id)
    .maybeSingle<DisputeRow>();
  if (!disputeRow) notFound();

  const dispute = disputeFromRow(disputeRow);
  const { data: card } = await supabase.from("cards").select("title").eq("id", dispute.cardId).maybeSingle();

  const admin = createAdminClient();
  const { data: evidenceRows } = await admin
    .from("dispute_evidence")
    .select("*")
    .eq("dispute_id", id)
    .order("created_at", { ascending: true })
    .returns<DisputeEvidenceRow[]>();

  const evidence = await Promise.all(
    (evidenceRows ?? []).map(async (row) => {
      const item = disputeEvidenceFromRow(row);
      if (item.storagePath) {
        const { data: signed } = await admin.storage.from("dispute-evidence").createSignedUrl(item.storagePath, 300);
        item.signedUrl = signed?.signedUrl ?? null;
      }
      return item;
    }),
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <Link href="/account/disputes" className="mb-4 inline-block text-sm text-foreground-muted hover:text-foreground">
        &larr; My Disputes
      </Link>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">{card?.title ?? "Unknown item"}</h1>
          <p className="text-sm text-foreground-muted">{DISPUTE_REASON_LABELS[dispute.reason]}</p>
        </div>
        <DisputeStatusBadge status={dispute.status} />
      </div>
      <p className="mb-6 rounded-xl border border-card-border bg-card p-4 text-sm text-foreground">
        {dispute.description}
      </p>
      <EvidenceTimeline dispute={dispute} evidence={evidence} />
    </div>
  );
}
