import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Installment } from "@/lib/tracker/installments";

type Db = ReturnType<typeof createAdminClient>;

const MISSING = /claim_installment_plans|claim_installments|claim_payments|schema cache|does not exist/i;

export interface ClaimPlanData {
  claimId: string;
  planId: string;
  status: "REQUESTED" | "ACTIVE" | "DECLINED";
  declineReason: string | null;
  createdAt: string;
  installments: Installment[];
  payments: { id: string; amount: number; status: "PENDING" | "CONFIRMED" | "REJECTED"; note: string | null; createdAt: string; proofPath: string; rejectReason: string | null }[];
  /** Sum of the payments the seller has confirmed. */
  confirmed: number;
  /** Sum of the payments sent but not reviewed yet. */
  waiting: number;
}

/**
 * The installment plans (with their installments and payments) of the given claims. Quietly empty until supabase/migration_marketplace_installments.sql
 * has been run, so nothing that reads plans can break a page on a project that hasn't got the tables yet.
 */
export async function loadClaimPlans(db: Db, claimIds: string[]): Promise<Map<string, ClaimPlanData>> {
  const out = new Map<string, ClaimPlanData>();
  if (claimIds.length === 0) return out;

  const { data: plans, error } = await db.from("claim_installment_plans").select("id, claim_id, status, decline_reason, created_at").in("claim_id", claimIds);
  if (error) {
    if (MISSING.test(error.message)) return out;
    throw new Error(error.message);
  }
  const planIds = (plans ?? []).map((p) => p.id as string);
  const [{ data: rows }, { data: pays }] = await Promise.all([
    planIds.length ? db.from("claim_installments").select("plan_id, seq, due_date, amount").in("plan_id", planIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    db.from("claim_payments").select("id, claim_id, amount, status, note, created_at, proof_path, reject_reason").in("claim_id", claimIds).order("created_at", { ascending: true }),
  ]);

  for (const p of plans ?? []) {
    const claimId = p.claim_id as string;
    const payments = (pays ?? [])
      .filter((x) => x.claim_id === claimId)
      .map((x) => ({
        id: x.id as string,
        amount: Number(x.amount),
        status: x.status as "PENDING" | "CONFIRMED" | "REJECTED",
        note: (x.note as string | null) ?? null,
        createdAt: x.created_at as string,
        proofPath: x.proof_path as string,
        rejectReason: (x.reject_reason as string | null) ?? null,
      }));
    out.set(claimId, {
      claimId,
      planId: p.id as string,
      status: p.status as ClaimPlanData["status"],
      declineReason: (p.decline_reason as string | null) ?? null,
      createdAt: p.created_at as string,
      installments: (rows ?? [])
        .filter((r) => r.plan_id === p.id)
        .map((r) => ({ seq: Number(r.seq), dueDate: r.due_date as string, amount: Number(r.amount) }))
        .sort((a, b) => a.seq - b.seq),
      payments,
      confirmed: Math.round(payments.filter((x) => x.status === "CONFIRMED").reduce((n, x) => n + x.amount, 0) * 100) / 100,
      waiting: Math.round(payments.filter((x) => x.status === "PENDING").reduce((n, x) => n + x.amount, 0) * 100) / 100,
    });
  }
  return out;
}
