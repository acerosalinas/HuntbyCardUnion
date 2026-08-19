import Link from "next/link";
import { redirect } from "next/navigation";
import { createAuthServerClient } from "@/lib/supabase/authServer";
import { DisputeStatusBadge } from "@/components/DisputeStatusBadge";
import { DISPUTE_REASON_LABELS } from "@/lib/disputeLabels";
import { DisputeRow, disputeFromRow } from "@/types/marketplace";

export const dynamic = "force-dynamic";

export default async function MyDisputesPage() {
  const supabase = await createAuthServerClient("buyer");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/account/login?from=%2Faccount%2Fdisputes");
  }

  const { data } = await supabase
    .from("disputes")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<DisputeRow[]>();
  const disputes = (data ?? []).map(disputeFromRow);

  const cardIds = disputes.map((d) => d.cardId);
  const { data: cardsData } =
    cardIds.length > 0
      ? await supabase.from("cards").select("id, title").in("id", cardIds)
      : { data: [] as { id: string; title: string }[] };
  const titleById = new Map((cardsData ?? []).map((c) => [c.id, c.title]));

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="mb-6 text-2xl font-bold text-foreground">My Disputes</h1>

      {disputes.length === 0 && (
        <p className="py-10 text-center text-sm text-foreground-muted">You haven&apos;t opened any disputes.</p>
      )}

      <div className="space-y-2">
        {disputes.map((d) => (
          <Link
            key={d.id}
            href={`/account/disputes/${d.id}`}
            className="flex items-center justify-between gap-3 rounded-2xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40"
          >
            <div>
              <p className="font-semibold text-foreground">{titleById.get(d.cardId) ?? "Unknown item"}</p>
              <p className="text-sm text-foreground-muted">{DISPUTE_REASON_LABELS[d.reason]}</p>
            </div>
            <DisputeStatusBadge status={d.status} />
          </Link>
        ))}
      </div>
    </div>
  );
}
