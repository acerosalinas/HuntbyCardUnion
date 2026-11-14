"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBuyer } from "@/lib/buyerAuth";
import { validateImageFile } from "@/lib/imageValidation";
import { notifyUser } from "@/lib/notify";
import { allowRequest, TOO_MANY } from "@/lib/rateLimit";
import { buildSchedule, maxInstallmentPayment } from "@/lib/claimInstallments";
import { loadClaimPlans, ClaimPlanData } from "@/lib/claimInstallmentsData";
import { manilaDay } from "@/lib/tracker/proofDays";
import { extractErrorMessage, formatCurrency } from "@/lib/utils";

// Everything here runs as the SIGNED-IN BUYER and only ever touches that buyer's own unpaid, pay-now orders.
const SETUP = "Installments aren't set up yet. The shop needs to run supabase/migration_marketplace_installments.sql first.";

interface ClaimRow {
  id: string;
  buyer_id: string | null;
  status: string;
  payment_method: string;
  quantity: number;
  unit_price: number | string;
  cards: { admin_id: string | null; title: string; allow_installments?: boolean } | { admin_id: string | null; title: string; allow_installments?: boolean }[] | null;
}

async function myClaim(claimId: string, buyerId: string) {
  const db = createAdminClient();
  const { data, error } = await db
    .from("card_claims")
    .select("id, buyer_id, status, payment_method, quantity, unit_price, cards(admin_id, title, allow_installments)")
    .eq("id", claimId)
    .eq("buyer_id", buyerId)
    .maybeSingle();
  if (error) throw new Error(/allow_installments/i.test(error.message) ? SETUP : error.message);
  const claim = data as unknown as ClaimRow | null;
  if (!claim) return null;
  const card = Array.isArray(claim.cards) ? claim.cards[0] : claim.cards;
  return { db, claim, card, total: Math.round(Number(claim.unit_price) * claim.quantity * 100) / 100 };
}

/** The plans (and what's been paid on them) for the signed-in buyer's own orders, for My Dibs. */
export async function getMyInstallments(claimIds: string[]): Promise<Record<string, ClaimPlanData>> {
  const buyer = await getCurrentBuyer();
  if (!buyer || claimIds.length === 0) return {};
  const db = createAdminClient();
  const { data } = await db.from("card_claims").select("id").in("id", claimIds.slice(0, 100)).eq("buyer_id", buyer.id);
  const mine = (data ?? []).map((r) => r.id as string);
  return Object.fromEntries((await loadClaimPlans(db, mine)).entries());
}

/** The buyer asks to pay an unpaid order in 2-4 weekly installments. It stays a request until the seller approves it. Returns the reason on failure. */
export async function requestInstallmentPlan(claimId: string, count: number): Promise<{ error?: string }> {
  try {
    const v = z.object({ claimId: z.string().uuid(), count: z.number().int().min(2).max(4) }).parse({ claimId, count });
    const buyer = await getCurrentBuyer();
    if (!buyer) return { error: "Please sign in again." };
    if (!(await allowRequest("installment-request", buyer.id, 20, 3600))) return { error: TOO_MANY };
    const found = await myClaim(v.claimId, buyer.id);
    if (!found || !found.card) return { error: "That order isn't yours anymore. Refresh and try again." };
    const { db, claim, card, total } = found;
    if (claim.status !== "PENDING" || claim.payment_method !== "PREPAID") return { error: "Installments are for unpaid, pay-now orders." };
    if (!card.allow_installments) return { error: "This seller doesn't offer installments on this card." };

    const schedule = buildSchedule(total, v.count, manilaDay(new Date().toISOString()));
    if (!schedule.installments) return { error: schedule.error ?? "Couldn't make that plan." };
    const installments = schedule.installments;

    const plans = await loadClaimPlans(db, [claim.id]);
    const existing = plans.get(claim.id);
    if (existing && existing.status !== "DECLINED") return { error: "You already have an installment plan on this order." };
    if (existing) await db.from("claim_installment_plans").delete().eq("id", existing.planId);

    const { data: plan, error } = await db.from("claim_installment_plans").insert({ claim_id: claim.id }).select("id").single();
    if (error || !plan) return { error: /claim_installment_plans|schema cache|does not exist/i.test(error?.message ?? "") ? SETUP : (error?.message ?? "Couldn't send your request.") };
    const { error: rowsError } = await db.from("claim_installments").insert(installments.map((i) => ({ plan_id: plan.id, seq: i.seq, due_date: i.dueDate, amount: i.amount })));
    if (rowsError) {
      await db.from("claim_installment_plans").delete().eq("id", plan.id);
      return { error: rowsError.message };
    }

    await notifyUser(db, {
      recipientId: card.admin_id,
      type: "tracker_proof_submitted",
      title: `Installment plan requested by ${buyer.handle}`,
      body: `${buyer.handle} asked to pay "${card.title}" (${formatCurrency(total)}) in ${v.count} weekly payments.`,
      link: "/admin",
    });
    revalidatePath("/admin");
    return {};
  } catch (err) {
    console.error("[requestInstallmentPlan]", err);
    return { error: extractErrorMessage(err) ?? "Couldn't send your request." };
  }
}

/** The buyer sends a screenshot for one installment. It counts only once the seller confirms it. Returns the reason on failure. */
export async function submitInstallmentProof(formData: FormData): Promise<{ error?: string }> {
  try {
    const v = z
      .object({ claimId: z.string().uuid(), amount: z.number().finite().positive().max(10_000_000), note: z.string().max(300) })
      .parse({ claimId: String(formData.get("claimId") ?? ""), amount: Number(formData.get("amount")), note: String(formData.get("note") ?? "").trim() });
    const file = formData.get("proof");
    if (!(file instanceof File) || file.size === 0) return { error: "Attach a screenshot of your payment." };

    const buyer = await getCurrentBuyer();
    if (!buyer) return { error: "Please sign in again." };
    if (!(await allowRequest("installment-proof", buyer.id, 20, 3600))) return { error: TOO_MANY };
    const found = await myClaim(v.claimId, buyer.id);
    if (!found || !found.card?.admin_id) return { error: "That order isn't yours anymore. Refresh and try again." };
    const { db, claim, card, total } = found;
    if (claim.status !== "PENDING") return { error: "This order is already paid or cancelled." };

    const plan = (await loadClaimPlans(db, [claim.id])).get(claim.id);
    if (!plan || plan.status !== "ACTIVE") return { error: "The seller hasn't approved an installment plan for this order yet." };
    const most = maxInstallmentPayment(total, plan.confirmed, plan.waiting);
    if (most <= 0) return { error: "Everything is already paid or waiting for the seller to confirm." };
    if (v.amount > most + 0.001) return { error: `That's more than what's left (${formatCurrency(most)}). Payments waiting for the seller count too.` };

    const validated = await validateImageFile(file);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
    const path = `${card.admin_id}/${buyer.id}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await db.storage.from("order-proofs").upload(path, validated.bytes, { contentType: validated.contentType, upsert: false });
    if (uploadError) return { error: uploadError.message };
    const { error } = await db.from("claim_payments").insert({ claim_id: claim.id, buyer_id: buyer.id, amount: Math.round(v.amount * 100) / 100, proof_path: path, note: v.note || null });
    if (error) {
      await db.storage.from("order-proofs").remove([path]);
      return { error: error.message };
    }

    await notifyUser(db, {
      recipientId: card.admin_id,
      type: "tracker_proof_submitted",
      title: `Installment payment from ${buyer.handle}`,
      body: `${buyer.handle} sent a screenshot for ${formatCurrency(v.amount)} on "${card.title}".`,
      link: "/admin",
    });
    revalidatePath("/admin");
    return {};
  } catch (err) {
    console.error("[submitInstallmentProof]", err);
    return { error: extractErrorMessage(err) ?? "Couldn't send your proof." };
  }
}
