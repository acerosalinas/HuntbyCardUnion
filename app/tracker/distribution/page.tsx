import { createAdminClient } from "@/lib/supabase/admin";
import { requireTrackerAdminOrRedirect } from "@/lib/tracker/auth";
import { DistributionView, DistributionItem } from "@/components/tracker/DistributionView";
import { loadTrackerData } from "@/lib/tracker/data";
import { attributePayments, SplitSale } from "@/lib/tracker/split";

export const dynamic = "force-dynamic";

/**
 * Payment distribution: every payment for cards - a customer's confirmed proof or an invoice / card the seller marked paid directly -
 * split by card owner, and how much of each owner's share has been handed out.
 */
export default async function TrackerDistributionPage() {
  const admin = await requireTrackerAdminOrRedirect();
  const data = await loadTrackerData(admin.id);
  const db = createAdminClient();

  const liveById = new Map(data.lives.map((l) => [l.id, l]));
  const saleById = new Map(data.sales.map((s) => [s.id, s]));
  const customerById = new Map(data.customers.map((c) => [c.id, c]));
  const ownerNameOf = (tag: string | null) => (tag === null ? "No owner" : (data.settings.ownerLabels.find((o) => o.code === tag)?.name ?? tag));

  // Which card each payment paid, so one payment can be split by owner.
  const splitSales: SplitSale[] = data.sales.map((s) => ({
    id: s.id,
    customerId: s.customerId,
    liveId: s.liveId,
    amount: s.amount,
    ownerTag: s.ownerTag,
    order: `${liveById.get(s.liveId)?.liveDate ?? ""}|${s.createdAt}`,
  }));
  const cardPayments = data.payments.filter((p) => p.purpose === "CARDS" && p.amount > 0);
  const attribution = attributePayments(
    splitSales,
    cardPayments.map((p) => ({ id: p.id, customerId: p.customerId, amount: p.amount, liveId: p.liveId, purpose: p.purpose, allocations: p.allocations, order: `${p.paidOn}|${p.createdAt}` })),
    { strict: data.settings.strictPayments },
  );

  // Payments that came from a confirmed customer proof keep their screenshot.
  const proofByPayment = new Map<string, { path: string; note: string | null }>();
  const { data: claims, error } = await db
    .from("tracker_payment_claims")
    .select("payment_id, proof_path, note")
    .eq("owner_id", admin.id)
    .eq("status", "CONFIRMED")
    .not("payment_id", "is", null)
    .limit(2000);
  // The claims table arrives with its own migration; without it every payment is simply a direct one.
  if (!error) for (const c of claims ?? []) proofByPayment.set(c.payment_id as string, { path: c.proof_path as string, note: (c.note as string | null) ?? null });
  const paths = [...new Set([...proofByPayment.values()].map((p) => p.path))];
  const { data: signed } = paths.length ? await db.storage.from("tracker-proofs").createSignedUrls(paths, 3600) : { data: [] as { path: string | null; signedUrl: string }[] };
  const urlOf = new Map((signed ?? []).map((u) => [u.path ?? "", u.signedUrl]));

  const items: DistributionItem[] = cardPayments.map((p) => {
    const proof = proofByPayment.get(p.id);
    const cards = [...(attribution.get(p.id) ?? new Map<string, number>()).entries()].flatMap(([saleId, amount]) => {
      const sale = saleById.get(saleId);
      return sale ? [{ name: sale.cardName, amount, liveTitle: liveById.get(sale.liveId)?.title ?? "", owner: ownerNameOf(sale.ownerTag) }] : [];
    });
    return {
      id: p.id,
      customerId: p.customerId,
      customerName: customerById.get(p.customerId)?.name ?? "Customer",
      method: p.method,
      amount: p.amount,
      note: p.note ?? proof?.note ?? null,
      createdAt: p.createdAt,
      day: p.paidOn,
      distributedAt: p.distributedAt,
      source: proof ? "PROOF" : "DIRECT",
      proofUrl: proof ? (urlOf.get(proof.path) ?? null) : null,
      cards,
    };
  });

  return <DistributionView items={items} ownerLabels={data.settings.ownerLabels} />;
}
