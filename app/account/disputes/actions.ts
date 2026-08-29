"use server";

import { revalidatePath } from "next/cache";
import { createAuthServerClient } from "@/lib/supabase/authServer";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateImageFile } from "@/lib/imageValidation";
import { isDisputeResolved } from "@/lib/disputeStatus";
import { notifyUser } from "@/lib/notify";
import { DisputeStatus } from "@/types/marketplace";

/**
 * Buyer's evidence/note upload on their own dispute. Authenticates the
 * caller via the session cookie first, then does the actual write with the
 * service-role client (bypasses RLS, matching every other Storage write in
 * this app) - the ownership check happens here in application code, not via
 * a public RPC, so a buyer can't fabricate a dispute_evidence row pointing
 * at an unvalidated file by calling a database function directly.
 */
export async function uploadDisputeEvidence(disputeId: string, note: string, file?: File | null) {
  const authClient = await createAuthServerClient("buyer");
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  if (!note.trim() && !file) {
    throw new Error("Add a note or a photo.");
  }

  const admin = createAdminClient();
  const { data: dispute, error: fetchError } = await admin
    .from("disputes")
    .select("buyer_id, status, seller_admin_id")
    .eq("id", disputeId)
    .single();
  if (fetchError || !dispute) throw new Error("Dispute not found.");
  if (dispute.buyer_id !== user.id) throw new Error("Dispute not found.");
  if (isDisputeResolved(dispute.status as DisputeStatus)) {
    throw new Error("This dispute is already resolved.");
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

    const { error: uploadError } = await admin.storage
      .from("dispute-evidence")
      .upload(storagePath, validated.bytes, { contentType, upsert: false });
    if (uploadError) throw new Error(uploadError.message);
  }

  const { error: insertError } = await admin.from("dispute_evidence").insert({
    dispute_id: disputeId,
    uploaded_by: user.id,
    uploader_role: "BUYER",
    storage_path: storagePath,
    file_name: fileName,
    content_type: contentType,
    note: note.trim() || null,
  });
  if (insertError) throw new Error(insertError.message);

  revalidatePath(`/account/disputes/${disputeId}`);

  // Mirrors the admin's own respondToDispute, which already notifies the
  // buyer on a seller reply - a buyer reply notified nobody until now.
  if (dispute.seller_admin_id) {
    await notifyUser(admin, {
      recipientId: dispute.seller_admin_id,
      type: "dispute_response",
      title: "Buyer replied to a dispute",
      body: note.trim() || "The buyer added a photo response.",
      link: "/admin/disputes",
    });
  }
}
