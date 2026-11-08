"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBuyer } from "@/lib/buyerAuth";
import { validateImageFile } from "@/lib/imageValidation";
import { notifyUser } from "@/lib/notify";
import { allowRequest, TOO_MANY } from "@/lib/rateLimit";
import { extractErrorMessage } from "@/lib/utils";

interface ClaimCard {
  admin_id: string | null;
  title: string;
}

interface ClaimRow {
  id: string;
  buyer_id: string | null;
  status: string;
  payment_method: string;
  proof_path: string | null;
  cards: ClaimCard | ClaimCard[] | null;
}

const cardOf = (c: ClaimRow): ClaimCard | null => (Array.isArray(c.cards) ? (c.cards[0] ?? null) : c.cards);

/**
 * A buyer attaches a screenshot of their payment to unpaid orders. Nothing counts as paid until the seller confirms it
 * in Pending Payments. Returns the reason as data on failure: production blanks the message of a thrown action error.
 */
export async function submitOrderProof(formData: FormData): Promise<{ error?: string }> {
  try {
    const parsed = z
      .object({ claimIds: z.array(z.string().uuid()).min(1).max(50), note: z.string().max(300) })
      .parse({ claimIds: JSON.parse(String(formData.get("claimIds") ?? "[]")), note: String(formData.get("note") ?? "").trim() });
    const file = formData.get("proof");
    if (!(file instanceof File) || file.size === 0) return { error: "Attach a screenshot of your payment." };

    const buyer = await getCurrentBuyer();
    if (!buyer) return { error: "Please sign in again." };
    if (!(await allowRequest("order-proof", buyer.id, 20, 3600))) return { error: TOO_MANY };

    const db = createAdminClient();
    const { data, error } = await db
      .from("card_claims")
      .select("id, buyer_id, status, payment_method, proof_path, cards(admin_id, title)")
      .in("id", parsed.claimIds)
      .eq("buyer_id", buyer.id);
    if (error) return { error: error.message };
    const claims = (data ?? []) as unknown as ClaimRow[];
    if (claims.length !== new Set(parsed.claimIds).size) return { error: "Some of those orders aren't yours anymore. Refresh and try again." };
    if (claims.some((c) => c.status !== "PENDING" || c.payment_method !== "PREPAID")) return { error: "Proof can only be sent for unpaid, pay-now orders." };

    const sellerIds = new Set(claims.map((c) => cardOf(c)?.admin_id ?? ""));
    const [sellerId] = [...sellerIds];
    if (sellerIds.size !== 1 || !sellerId) return { error: "One screenshot can only cover orders from the same seller." };

    const validated = await validateImageFile(file);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
    const path = `${sellerId}/${buyer.id}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await db.storage.from("order-proofs").upload(path, validated.bytes, { contentType: validated.contentType, upsert: false });
    if (uploadError) return { error: uploadError.message };

    const { error: updateError } = await db
      .from("card_claims")
      .update({ proof_path: path, proof_uploaded_at: new Date().toISOString(), proof_note: parsed.note || null })
      .in("id", claims.map((c) => c.id))
      .eq("buyer_id", buyer.id)
      .eq("status", "PENDING");
    if (updateError) {
      await db.storage.from("order-proofs").remove([path]);
      return { error: updateError.message };
    }

    // A replaced screenshot is deleted unless another claim still points at it.
    for (const old of new Set(claims.map((c) => c.proof_path).filter((p): p is string => Boolean(p)))) {
      const { count } = await db.from("card_claims").select("id", { count: "exact", head: true }).eq("proof_path", old);
      if (!count) await db.storage.from("order-proofs").remove([old]);
    }

    const titles = claims.map((c) => cardOf(c)?.title ?? "card");
    await notifyUser(db, {
      recipientId: sellerId,
      type: "tracker_proof_submitted",
      title: `Payment proof from ${buyer.handle}`,
      body: `${buyer.handle} sent a payment screenshot for ${titles.length === 1 ? titles[0] : `${titles.length} orders`}.`,
      link: "/admin",
    });
    revalidatePath("/admin");
    return {};
  } catch (err) {
    console.error("[submitOrderProof]", err);
    return { error: extractErrorMessage(err) ?? "Couldn't send your proof." };
  }
}
