"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { assertOwnsOrSuper, requireAdmin } from "@/lib/adminAuth";
import { validateImageFile } from "@/lib/imageValidation";
import { canTransitionDispute } from "@/lib/disputeStatus";
import { notifyUser } from "@/lib/notify";
import { DisputeStatus } from "@/types/marketplace";
import { revalidateAdmin, cancelQueue } from "./actionHelpers";

// ---------------------------------------------------------------------------
// Disputes. "Seller" in this app has no account of its own - the admin who
// owns the card (disputes.seller_admin_id, snapshotted from cards.admin_id
// at open_dispute() time) handles the seller side. All writes here use the
// service-role client, same as every other admin action in this file - the
// only RLS-scoped writes anywhere in the dispute feature are the buyer-side
// open_dispute/withdraw_dispute RPCs in supabase/schema.sql.
// ---------------------------------------------------------------------------

async function getDisputeOwner(supabase: ReturnType<typeof createAdminClient>, disputeId: string) {
  const { data, error } = await supabase
    .from("disputes")
    .select("seller_admin_id, status, buyer_id, claim_id")
    .eq("id", disputeId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Dispute not found");
  return data as { seller_admin_id: string | null; status: DisputeStatus; buyer_id: string; claim_id: string | null };
}

/**
 * Admin's evidence/response upload. Shares the exact validate-then-upload
 * shape as the buyer's uploadDisputeEvidence (app/account/disputes/actions.ts)
 * but gated by requireAdmin()/assertOwnsOrSuper instead of a buyer session -
 * intentionally not unified into one function, since the two need different
 * auth checks and this keeps each one simple to read in isolation.
 */
export async function respondToDispute(disputeId: string, note: string, file?: File | null) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const dispute = await getDisputeOwner(supabase, disputeId);
  assertOwnsOrSuper(admin, dispute.seller_admin_id);

  if (!note.trim() && !file) {
    throw new Error("Add a note or a photo to respond.");
  }

  let storagePath: string | null = null;
  let contentType: string | null = null;
  let fileName: string | null = null;

  if (file) {
    const validated = await validateImageFile(file);
    const ext = file.name.split(".").pop() || "jpg";
    storagePath = `${disputeId}/${crypto.randomUUID()}.${ext}`;
    contentType = validated.contentType;
    fileName = file.name;

    const { error: uploadError } = await supabase.storage
      .from("dispute-evidence")
      .upload(storagePath, validated.bytes, { contentType, upsert: false });
    if (uploadError) throw new Error(uploadError.message);
  }

  const { error: insertError } = await supabase.from("dispute_evidence").insert({
    dispute_id: disputeId,
    uploaded_by: admin.id,
    uploader_role: "ADMIN",
    storage_path: storagePath,
    file_name: fileName,
    content_type: contentType,
    note: note.trim() || null,
  });
  if (insertError) throw new Error(insertError.message);

  if (dispute.status === "OPEN" && canTransitionDispute(dispute.status, "SELLER_RESPONDED")) {
    await supabase.from("disputes").update({ status: "SELLER_RESPONDED" }).eq("id", disputeId);
    await notifyUser(supabase, {
      recipientId: dispute.buyer_id,
      type: "dispute_response",
      title: "Seller responded to your dispute",
      body: note.trim() || "The seller added a photo response.",
      link: `/account/disputes/${disputeId}`,
    });
  }

  revalidateAdmin();
}

export async function markDisputeUnderReview(disputeId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const dispute = await getDisputeOwner(supabase, disputeId);
  assertOwnsOrSuper(admin, dispute.seller_admin_id);

  if (!canTransitionDispute(dispute.status, "UNDER_REVIEW")) {
    throw new Error(`Can't move a ${dispute.status} dispute to Under Review.`);
  }

  const { error } = await supabase.from("disputes").update({ status: "UNDER_REVIEW" }).eq("id", disputeId);
  if (error) throw new Error(error.message);
  revalidateAdmin();

  await notifyUser(supabase, {
    recipientId: dispute.buyer_id,
    type: "dispute_under_review",
    title: "Your dispute is under review",
    link: `/account/disputes/${disputeId}`,
  });
}

/**
 * Resolves a dispute as either refunded or dismissed. This is bookkeeping
 * only - there's no payment integration anywhere in this app (buyers pay
 * sellers off-platform, same as how confirmPaid just records that payment
 * happened rather than moving money). Marking RESOLVED_REFUND does not
 * touch the underlying card/order state; admin still issues any actual
 * refund themselves outside the app. Resolutions are terminal - there is no
 * reopen path (see lib/disputeStatus.ts).
 */
export async function resolveDispute(disputeId: string, resolution: "REFUND" | "DISMISSED", resolutionNote: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const dispute = await getDisputeOwner(supabase, disputeId);
  assertOwnsOrSuper(admin, dispute.seller_admin_id);

  const targetStatus: DisputeStatus = resolution === "REFUND" ? "RESOLVED_REFUND" : "RESOLVED_DISMISSED";
  if (!canTransitionDispute(dispute.status, targetStatus)) {
    throw new Error(`Can't resolve a ${dispute.status} dispute this way.`);
  }

  const { error } = await supabase
    .from("disputes")
    .update({
      status: targetStatus,
      resolution_note: resolutionNote.trim() || null,
      resolved_by: admin.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", disputeId);
  if (error) throw new Error(error.message);
  revalidateAdmin();

  await notifyUser(supabase, {
    recipientId: dispute.buyer_id,
    type: "dispute_resolved",
    title: resolution === "REFUND" ? "Dispute resolved - refund" : "Dispute resolved",
    body: resolutionNote.trim() || undefined,
    link: `/account/disputes/${disputeId}`,
  });

  // A refund doesn't move the physical unit by itself (see the comment on
  // this function) - the seller still has to decide whether it's sellable
  // again or a write-off, via resolveDisputeRestock below. Without this
  // notification that decision had no prompt at all: the claim just sat
  // SOLD forever with the unit permanently unavailable.
  if (resolution === "REFUND" && dispute.seller_admin_id) {
    await notifyUser(supabase, {
      recipientId: dispute.seller_admin_id,
      type: "dispute_resolved",
      title: "Refund issued - restock decision needed",
      body: "Decide whether to re-list this card or write it off.",
      link: `/admin/disputes/${disputeId}`,
    });
  }
}

/**
 * Follow-up to a REFUND resolution: the seller decides whether the unit
 * goes back on sale (relist = true, mirrors cancelRelist's stock-restore
 * logic) or is written off (relist = false - claim just goes CANCELLED,
 * stock untouched, for a lost/damaged item that can't actually be resold).
 * Guarded by claim.status = 'SOLD' so this can only run once per dispute.
 */
export async function resolveDisputeRestock(disputeId: string, relist: boolean) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const dispute = await getDisputeOwner(supabase, disputeId);
  assertOwnsOrSuper(admin, dispute.seller_admin_id);

  // resolve_dispute_restock locks the dispute, then its claim, then the
  // card, re-checking status at each step inside that lock before writing.
  const { data: cardId, error } = await supabase.rpc("resolve_dispute_restock", {
    p_dispute_id: disputeId,
    p_relist: relist,
  });
  if (error) throw new Error(error.message);

  if (relist) {
    await cancelQueue(supabase, cardId as string);
  }

  revalidateAdmin();
}
