import { createAdminClient } from "@/lib/supabase/admin";
import { requireTrackerAdminOrRedirect } from "@/lib/tracker/auth";
import { ProofsView, ProofItem } from "@/components/tracker/ProofsView";

export const dynamic = "force-dynamic";

const MISSING = /tracker_payment_claims|tracker_claim_cards|schema cache|does not exist/i;

export default async function TrackerProofsPage() {
  const admin = await requireTrackerAdminOrRedirect();
  const db = createAdminClient();

  // Newest first; every PENDING one plus the recent history.
  const { data: claims, error } = await db
    .from("tracker_payment_claims")
    .select("*")
    .eq("owner_id", admin.id)
    .order("created_at", { ascending: false })
    .limit(150);
  if (error) {
    if (MISSING.test(error.message)) {
      return (
        <p className="rounded-2xl border border-dashed border-card-border p-8 text-center text-sm text-foreground-muted">
          Payment proofs aren&apos;t set up yet. Run <span className="font-mono">supabase/migration_live_tracker_claims.sql</span> in the Supabase SQL editor.
        </p>
      );
    }
    throw new Error(error.message);
  }
  const rows = claims ?? [];

  const claimIds = rows.map((c) => c.id as string);
  const customerIds = [...new Set(rows.map((c) => c.customer_id as string))];
  const buyerIds = [...new Set(rows.map((c) => c.buyer_id as string))];

  const [cardRes, customerRes, buyerRes, urlRes] = await Promise.all([
    claimIds.length ? db.from("tracker_claim_cards").select("claim_id, sale_id, amount").in("claim_id", claimIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    customerIds.length ? db.from("tracker_customers").select("id, name").eq("owner_id", admin.id).in("id", customerIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    buyerIds.length ? db.from("profiles").select("id, handle").in("id", buyerIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    rows.length ? db.storage.from("tracker-proofs").createSignedUrls(rows.map((c) => c.proof_path as string), 3600) : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
  ]);

  const saleIds = [...new Set((cardRes.data ?? []).map((r) => r.sale_id as string))];
  const { data: sales } = saleIds.length
    ? await db.from("tracker_sales").select("id, card_name, amount, live_id").eq("owner_id", admin.id).in("id", saleIds)
    : { data: [] as Record<string, unknown>[] };
  const liveIds = [...new Set((sales ?? []).map((s) => s.live_id as string))];
  const { data: lives } = liveIds.length ? await db.from("tracker_lives").select("id, title").eq("owner_id", admin.id).in("id", liveIds) : { data: [] as Record<string, unknown>[] };

  const nameOf = new Map((customerRes.data ?? []).map((c) => [c.id as string, c.name as string]));
  const handleOf = new Map((buyerRes.data ?? []).map((b) => [b.id as string, b.handle as string]));
  const urlOf = new Map(((urlRes.data ?? []) as { path: string | null; signedUrl: string }[]).map((u) => [u.path ?? "", u.signedUrl]));
  const liveTitle = new Map((lives ?? []).map((l) => [l.id as string, l.title as string]));
  const saleById = new Map((sales ?? []).map((s) => [s.id as string, s]));

  const items: ProofItem[] = rows.map((c) => ({
    id: c.id as string,
    status: c.status as ProofItem["status"],
    customerId: c.customer_id as string,
    customerName: nameOf.get(c.customer_id as string) ?? "Customer",
    buyerHandle: handleOf.get(c.buyer_id as string) ?? "",
    method: c.method as "GCASH" | "MARIBANK",
    cardsAmount: Number(c.cards_amount),
    sfAmount: Number(c.sf_amount),
    note: (c.note as string | null) ?? null,
    rejectReason: (c.reject_reason as string | null) ?? null,
    createdAt: c.created_at as string,
    reviewedAt: (c.reviewed_at as string | null) ?? null,
    proofUrl: urlOf.get(c.proof_path as string) ?? null,
    cards: (cardRes.data ?? [])
      .filter((r) => r.claim_id === c.id)
      .map((r) => {
        const sale = saleById.get(r.sale_id as string);
        return { name: (sale?.card_name as string) ?? "Card", amount: Number(r.amount), liveTitle: liveTitle.get((sale?.live_id as string) ?? "") ?? "" };
      }),
  }));

  return <ProofsView items={items} />;
}
