import { createAdminClient } from "@/lib/supabase/admin";
import { requireTrackerAdminOrRedirect } from "@/lib/tracker/auth";
import { ProofsView, ProofItem } from "@/components/tracker/ProofsView";
import type { MarketProofItem } from "@/components/tracker/MarketProofCard";
import { loadMarketplaceClaims } from "@/lib/tracker/marketplaceData";
import { parseOwnerLabels } from "@/lib/tracker/data";
import { normalizeOwnerTag } from "@/lib/tracker/split";
import { manilaDay } from "@/lib/tracker/proofDays";

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

  const [settingsRes, cardRes, customerRes, buyerRes, urlRes] = await Promise.all([
    db.from("tracker_settings").select("owner_labels").eq("owner_id", admin.id).maybeSingle(),
    claimIds.length ? db.from("tracker_claim_cards").select("claim_id, sale_id, amount").in("claim_id", claimIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    customerIds.length ? db.from("tracker_customers").select("id, name").eq("owner_id", admin.id).in("id", customerIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    buyerIds.length ? db.from("profiles").select("id, handle").in("id", buyerIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    rows.length ? db.storage.from("tracker-proofs").createSignedUrls(rows.map((c) => c.proof_path as string), 3600) : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
  ]);

  const saleIds = [...new Set((cardRes.data ?? []).map((r) => r.sale_id as string))];
  const { data: sales } = saleIds.length
    ? await db.from("tracker_sales").select("id, card_name, amount, live_id, owner_tag").eq("owner_id", admin.id).in("id", saleIds)
    : { data: [] as Record<string, unknown>[] };
  const liveIds = [...new Set((sales ?? []).map((s) => s.live_id as string))];
  const { data: lives } = liveIds.length ? await db.from("tracker_lives").select("id, title").eq("owner_id", admin.id).in("id", liveIds) : { data: [] as Record<string, unknown>[] };

  // The day each confirmed proof was paid (the payment date picked when confirming it).
  const paymentIds = [...new Set(rows.map((c) => c.payment_id as string | null).filter((id): id is string => Boolean(id)))];
  const { data: paymentRows } = paymentIds.length ? await db.from("tracker_payments").select("id, paid_on").eq("owner_id", admin.id).in("id", paymentIds) : { data: [] as Record<string, unknown>[] };
  const paidOnOf = new Map((paymentRows ?? []).map((p) => [p.id as string, p.paid_on as string]));

  const nameOf = new Map((customerRes.data ?? []).map((c) => [c.id as string, c.name as string]));
  const handleOf = new Map((buyerRes.data ?? []).map((b) => [b.id as string, b.handle as string]));
  const urlOf = new Map(((urlRes.data ?? []) as { path: string | null; signedUrl: string }[]).map((u) => [u.path ?? "", u.signedUrl]));
  const liveTitle = new Map((lives ?? []).map((l) => [l.id as string, l.title as string]));
  const saleById = new Map((sales ?? []).map((s) => [s.id as string, s]));
  const ownerLabels = parseOwnerLabels((settingsRes.data as { owner_labels?: unknown } | null)?.owner_labels);
  const ownerNameOf = (tag: string | null) => (tag === null ? "No owner" : (ownerLabels.find((o) => o.code === tag)?.name ?? tag));

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
    day:
      c.status === "PENDING"
        ? manilaDay(c.created_at as string)
        : ((c.payment_id ? paidOnOf.get(c.payment_id as string) : undefined) ?? manilaDay(((c.reviewed_at as string | null) ?? (c.created_at as string)))),
    distributedAt: (c.distributed_at as string | null | undefined) ?? null,
    proofUrl: urlOf.get(c.proof_path as string) ?? null,
    cards: (cardRes.data ?? [])
      .filter((r) => r.claim_id === c.id)
      .map((r) => {
        const sale = saleById.get(r.sale_id as string);
        return {
          name: (sale?.card_name as string) ?? "Card",
          amount: Number(r.amount),
          liveTitle: liveTitle.get((sale?.live_id as string) ?? "") ?? "",
          owner: ownerNameOf(normalizeOwnerTag(sale?.owner_tag as string | null | undefined)),
        };
      }),
  }));

  // Marketplace payment screenshots from buyers (My Dibs), so one inbox covers both ledgers. One screenshot can cover several orders.
  const marketClaims = (await loadMarketplaceClaims(db, admin.id, null)).filter((c) => c.status === "PENDING" && c.proofPath);
  const marketBuyerIds = [...new Set(marketClaims.map((c) => c.buyerId))];
  const [marketProfiles, marketCustomers, marketUrls] = await Promise.all([
    marketBuyerIds.length ? db.from("profiles").select("id, handle").in("id", marketBuyerIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    marketBuyerIds.length ? db.from("tracker_customers").select("id, name, buyer_id").eq("owner_id", admin.id).in("buyer_id", marketBuyerIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    marketClaims.length ? db.storage.from("order-proofs").createSignedUrls([...new Set(marketClaims.map((c) => c.proofPath as string))], 3600) : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
  ]);
  const marketHandle = new Map((marketProfiles.data ?? []).map((p) => [p.id as string, p.handle as string]));
  const marketCustomer = new Map((marketCustomers.data ?? []).map((c) => [c.buyer_id as string, { id: c.id as string, name: c.name as string }]));
  const marketUrl = new Map(((marketUrls.data ?? []) as { path: string | null; signedUrl: string }[]).map((u) => [u.path ?? "", u.signedUrl]));
  const byProof = new Map<string, typeof marketClaims>();
  for (const claim of marketClaims) byProof.set(claim.proofPath as string, [...(byProof.get(claim.proofPath as string) ?? []), claim]);
  const marketItems: MarketProofItem[] = [...byProof.entries()].map(([path, group]) => {
    const first = group[0];
    const customer = marketCustomer.get(first.buyerId);
    return {
      key: path,
      buyerHandle: marketHandle.get(first.buyerId) ?? "buyer",
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? null,
      note: first.proofNote,
      uploadedAt: first.proofUploadedAt ?? first.claimedAt,
      day: manilaDay(first.proofUploadedAt ?? first.claimedAt),
      proofUrl: marketUrl.get(path) ?? null,
      total: Math.round(group.reduce((n, c) => n + c.amount, 0) * 100) / 100,
      claims: group.map((c) => ({ id: c.id, title: c.title, packNumber: c.packNumber, amount: c.amount })),
    };
  });

  return <ProofsView items={items} marketItems={marketItems} />;
}
