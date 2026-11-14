"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { assertOwnsOrSuper, requireAdmin } from "@/lib/adminAuth";
import { notifyUser } from "@/lib/notify";
import { loadClaimPlans } from "@/lib/claimInstallmentsData";
import { extractErrorMessage, formatCurrency } from "@/lib/utils";
import { confirmPaid } from "./orderActions";
import { revalidateAdmin } from "./actionHelpers";

// The seller's side of marketplace installments. Every action checks that the order is on the caller's own listing (or the caller is a super admin)
// and returns the reason on failure, because production hides the message of a thrown action error.

interface ClaimRow {
  id: string;
  buyer_id: string | null;
  status: string;
  quantity: number;
  unit_price: number | string;
  cards: { admin_id: string | null; title: string } | { admin_id: string | null; title: string }[] | null;
}

async function ownedClaim(claimId: string) {
  const admin = await requireAdmin();
  const db = createAdminClient();
  const { data, error } = await db.from("card_claims").select("id, buyer_id, status, quantity, unit_price, cards(admin_id, title)").eq("id", claimId).maybeSingle();
  if (error) throw new Error(error.message);
  const claim = data as unknown as ClaimRow | null;
  if (!claim) throw new Error("That order no longer exists.");
  const card = Array.isArray(claim.cards) ? claim.cards[0] : claim.cards;
  assertOwnsOrSuper(admin, card?.admin_id ?? null);
  return { db, claim, title: card?.title ?? "Card", total: Math.round(Number(claim.unit_price) * claim.quantity * 100) / 100 };
}

/** Approve a buyer's installment request (it becomes ACTIVE and they can start paying) or decline it with a reason they will see. */
export async function decideInstallmentPlan(claimId: string, approve: boolean, reason = ""): Promise<{ error?: string }> {
  try {
    const { db, claim, title } = await ownedClaim(claimId);
    if (claim.status !== "PENDING") return { error: "This order is already paid or cancelled." };
    const plan = (await loadClaimPlans(db, [claimId])).get(claimId);
    if (!plan || plan.status !== "REQUESTED") return { error: "There's no waiting installment request on this order." };
    const why = reason.trim().slice(0, 300);
    if (!approve && !why) return { error: "Say why - the buyer will see it." };

    const { error } = await db
      .from("claim_installment_plans")
      .update({ status: approve ? "ACTIVE" : "DECLINED", decline_reason: approve ? null : why, decided_at: new Date().toISOString() })
      .eq("id", plan.planId)
      .eq("status", "REQUESTED");
    if (error) return { error: error.message };

    await notifyUser(db, {
      recipientId: claim.buyer_id,
      type: approve ? "tracker_proof_confirmed" : "tracker_proof_rejected",
      title: approve ? "Installment plan approved" : "Installment plan not approved",
      body: approve ? `Your installment plan for "${title}" is approved. Send a screenshot for each payment from My Dibs.` : `Your installment request for "${title}": ${why} You can still pay in full.`,
      link: "/account/dibs",
    });
    revalidateAdmin();
    return {};
  } catch (err) {
    console.error("[decideInstallmentPlan]", err);
    return { error: extractErrorMessage(err) ?? "Couldn't update the plan." };
  }
}

async function ownedPayment(paymentId: string) {
  const db = createAdminClient();
  const { data, error } = await db.from("claim_payments").select("id, claim_id, amount, status, proof_path").eq("id", paymentId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That payment no longer exists.");
  const owned = await ownedClaim(data.claim_id as string);
  return { ...owned, payment: { id: data.id as string, amount: Number(data.amount), status: data.status as string, proofPath: data.proof_path as string } };
}

/** Confirm one installment. When the confirmed installments add up to the full price the order is marked paid, exactly like a normal payment. */
export async function confirmInstallmentPayment(paymentId: string): Promise<{ error?: string; fullyPaid?: boolean }> {
  try {
    const { db, claim, title, total, payment } = await ownedPayment(paymentId);
    if (payment.status !== "PENDING") return { error: "That payment was already reviewed." };
    if (claim.status !== "PENDING") return { error: "This order is already paid or cancelled." };

    const { error } = await db.from("claim_payments").update({ status: "CONFIRMED", reviewed_at: new Date().toISOString() }).eq("id", payment.id).eq("status", "PENDING");
    if (error) return { error: error.message };

    const plan = (await loadClaimPlans(db, [claim.id])).get(claim.id);
    const confirmed = plan?.confirmed ?? payment.amount;
    if (confirmed >= total - 0.004) {
      // Fully covered: settle the order through the normal path (locks the claim, marks it paid, emails and notifies the buyer).
      await confirmPaid(claim.id);
      return { fullyPaid: true };
    }
    await notifyUser(db, {
      recipientId: claim.buyer_id,
      type: "payment_confirmed",
      title: "Installment confirmed",
      body: `Your ${formatCurrency(payment.amount)} payment for "${title}" was confirmed. ${formatCurrency(Math.round((total - confirmed) * 100) / 100)} left.`,
      link: "/account/dibs",
    });
    revalidateAdmin();
    return { fullyPaid: false };
  } catch (err) {
    console.error("[confirmInstallmentPayment]", err);
    return { error: extractErrorMessage(err) ?? "Couldn't confirm the payment." };
  }
}

/** Turn down an installment screenshot (wrong amount, unreadable...). The buyer sees the reason and can send another. */
export async function rejectInstallmentPayment(paymentId: string, reason: string): Promise<{ error?: string }> {
  try {
    const { db, claim, title, payment } = await ownedPayment(paymentId);
    const why = reason.trim().slice(0, 300);
    if (!why) return { error: "Say why - the buyer will see it." };
    if (payment.status !== "PENDING") return { error: "That payment was already reviewed." };

    const { error } = await db.from("claim_payments").update({ status: "REJECTED", reject_reason: why, reviewed_at: new Date().toISOString() }).eq("id", payment.id).eq("status", "PENDING");
    if (error) return { error: error.message };
    await db.storage.from("order-proofs").remove([payment.proofPath]);

    await notifyUser(db, {
      recipientId: claim.buyer_id,
      type: "tracker_proof_rejected",
      title: "Installment payment not accepted",
      body: `Your ${formatCurrency(payment.amount)} payment for "${title}": ${why} Please send another screenshot.`,
      link: "/account/dibs",
    });
    revalidateAdmin();
    return {};
  } catch (err) {
    console.error("[rejectInstallmentPayment]", err);
    return { error: extractErrorMessage(err) ?? "Couldn't reject the payment." };
  }
}
