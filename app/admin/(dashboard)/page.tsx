import { PendingPaymentsTable, PendingClaimView } from "@/components/admin/PendingPaymentsTable";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";
import { loadClaimPlans } from "@/lib/claimInstallmentsData";
import type { ClaimPlanView } from "@/components/admin/ClaimPlanPanel";

interface ClaimJoinRow {
  id: string;
  card_id: string;
  buyer_handle: string;
  order_id: string | null;
  quantity: number;
  unit_price: number;
  claimed_at: string;
  pack_number: number | null;
  proof_path: string | null;
  proof_note: string | null;
  cards: { title: string; admin_id: string | null; images: string[] } | null;
}

export default async function AdminPendingPaymentsPage() {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  let query = supabase
    .from("card_claims")
    .select(
      "id, card_id, buyer_handle, order_id, quantity, unit_price, claimed_at, pack_number, proof_path, proof_note, cards!inner(title, admin_id, images)",
    )
    .eq("status", "PENDING")
    // Most-recent-first - the component further groups these by order and
    // re-sorts groups the same way, but this keeps the raw query itself
    // sensible on its own too.
    .order("claimed_at", { ascending: false });

  if (admin.role !== "SUPER_ADMIN") {
    query = query.eq("cards.admin_id", admin.id);
  }

  const { data } = await query;
  // The screenshots are private: each is shown through a short-lived signed link, one per file (a screenshot can cover several claims).
  const proofUrlByPath = new Map<string, string>();
  const proofPaths = [...new Set(((data as unknown as ClaimJoinRow[] | null) ?? []).map((r) => r.proof_path).filter((p): p is string => Boolean(p)))];
  await Promise.all(
    proofPaths.map(async (path) => {
      const { data: signed } = await supabase.storage.from("order-proofs").createSignedUrl(path, 600);
      if (signed?.signedUrl) proofUrlByPath.set(path, signed.signedUrl);
    }),
  );

  // Installment plans on these orders (quietly none until the installments migration has been run), with a signed link for every screenshot waiting on the seller.
  const rawRows = (data as unknown as ClaimJoinRow[] | null) ?? [];
  const plansByClaim = await loadClaimPlans(supabase, rawRows.map((r) => r.id));
  const planViewByClaim = new Map<string, ClaimPlanView>();
  for (const [claimId, plan] of plansByClaim) {
    if (plan.status === "DECLINED") continue;
    const row = rawRows.find((r) => r.id === claimId);
    const waitingPayments = await Promise.all(
      plan.payments
        .filter((p) => p.status === "PENDING")
        .map(async (p) => {
          const { data: signed } = await supabase.storage.from("order-proofs").createSignedUrl(p.proofPath, 600);
          return { id: p.id, amount: p.amount, note: p.note, proofUrl: signed?.signedUrl ?? null, createdAt: p.createdAt };
        }),
    );
    planViewByClaim.set(claimId, {
      status: plan.status,
      installments: plan.installments,
      confirmed: plan.confirmed,
      waiting: plan.waiting,
      total: Math.round(Number(row?.unit_price ?? 0) * (row?.quantity ?? 1) * 100) / 100,
      waitingPayments,
    });
  }

  const claims: PendingClaimView[] = ((data as unknown as ClaimJoinRow[] | null) ?? []).map((row) => ({
    id: row.id,
    cardId: row.card_id,
    cardTitle: `${row.cards?.title ?? "Card"}${row.pack_number ? ` · Pack #${row.pack_number}` : ""}`,
    cardImage: row.cards?.images?.[0] ?? null,
    buyerHandle: row.buyer_handle,
    orderId: row.order_id,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    claimedAt: new Date(row.claimed_at).getTime(),
    proofUrl: row.proof_path ? (proofUrlByPath.get(row.proof_path) ?? null) : null,
    proofNote: row.proof_note,
    plan: planViewByClaim.get(row.id) ?? null,
  }));

  const queueCounts: Record<string, number> = {};
  const cardIds = [...new Set(claims.map((c) => c.cardId))];
  if (cardIds.length > 0) {
    const { data: queueRows } = await supabase
      .from("dibs_queue")
      .select("card_id")
      .in("card_id", cardIds)
      .eq("status", "WAITING");
    for (const row of queueRows ?? []) {
      queueCounts[row.card_id] = (queueCounts[row.card_id] ?? 0) + 1;
    }
  }

  return <PendingPaymentsTable claims={claims} queueCounts={queueCounts} />;
}
