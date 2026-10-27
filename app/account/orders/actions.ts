"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBuyer } from "@/lib/buyerAuth";
import { validateImageFile } from "@/lib/imageValidation";
import { notifyUser } from "@/lib/notify";
import { loadPortalInternal, PortalCustomerInternal } from "@/lib/tracker/portal";
import { round2 } from "@/lib/tracker/money";

// Everything here runs as the SIGNED-IN BUYER. The customer is never taken from
// the request on trust: it must be one of the tracker customers linked to this
// buyer's account (loadPortalInternal filters on buyer_id from the session).
// Cards are then matched against that customer's own cards, so a forged card id
// or customer id from the browser can't touch anyone else's data.

const MAX_PENDING_CLAIMS = 5;

async function linkedCustomer(customerId: string): Promise<{ buyerId: string; buyerHandle: string; customer: PortalCustomerInternal }> {
  const buyer = await getCurrentBuyer();
  if (!buyer) throw new Error("Please sign in again.");
  const customer = (await loadPortalInternal(buyer.id)).find((c) => c.customerId === customerId);
  if (!customer) throw new Error("That order isn't linked to your account.");
  return { buyerId: buyer.id, buyerHandle: buyer.handle, customer };
}

function allCards(customer: PortalCustomerInternal) {
  // Oldest live first, then entry order - the order a partial payment is spread across the ticked cards.
  return customer.view.lives.flatMap((l) => l.cards);
}

/** The customer ticks which of their unshipped cards they want shipped. This is the same For shipping flag the seller uses. */
export async function portalSetShipping(customerId: string, saleIds: string[], want: boolean) {
  const v = z.object({ customerId: z.string().uuid(), saleIds: z.array(z.string().uuid()).min(1).max(200), want: z.boolean() }).parse({ customerId, saleIds, want });
  const { customer } = await linkedCustomer(v.customerId);

  const mine = new Set(allCards(customer).filter((c) => c.state === "PENDING").map((c) => c.id));
  const ids = v.saleIds.filter((id) => mine.has(id));
  if (ids.length === 0) throw new Error("Those cards can't be changed - they may already be shipped.");

  const { error } = await createAdminClient()
    .from("tracker_sales")
    .update(v.want ? { for_shipping: true, distributed_at: null } : { for_shipping: false })
    .in("id", ids)
    .eq("customer_id", customer.customerId)
    .eq("owner_id", customer.ownerId)
    .is("shipment_id", null);
  if (error) throw new Error(error.message);
  revalidatePath("/account/orders");
  revalidatePath("/tracker", "layout");
}

/** The customer sends a proof of payment for the cards they ticked. Nothing counts as paid until the seller confirms it. */
export async function portalSubmitClaim(formData: FormData) {
  const raw = {
    customerId: String(formData.get("customerId") ?? ""),
    saleIds: JSON.parse(String(formData.get("saleIds") ?? "[]")) as unknown,
    cardsAmount: Number(formData.get("cardsAmount") ?? 0),
    sfAmount: Number(formData.get("sfAmount") ?? 0),
    method: String(formData.get("method") ?? ""),
    note: String(formData.get("note") ?? "").trim().slice(0, 300),
  };
  const v = z
    .object({
      customerId: z.string().uuid(),
      saleIds: z.array(z.string().uuid()).max(200),
      cardsAmount: z.number().finite().min(0).max(10_000_000),
      sfAmount: z.number().finite().min(0).max(5000),
      method: z.enum(["GCASH", "MARIBANK"]),
      note: z.string(),
    })
    .parse(raw);
  const file = formData.get("proof");
  if (!(file instanceof File) || file.size === 0) throw new Error("Attach a screenshot of your payment.");

  const { buyerId, buyerHandle, customer } = await linkedCustomer(v.customerId);
  const db = createAdminClient();

  // Which of the ticked cards are really claimable: theirs, still owing, and not already waiting on review.
  const cards = allCards(customer);
  const wanted = new Set(v.saleIds);
  const claimable = cards.filter((c) => wanted.has(c.id) && c.left > 0 && !c.underReview);
  if (v.cardsAmount > 0 && claimable.length === 0) throw new Error("None of the ticked cards can be claimed - they may be paid or already under review.");
  if (claimable.length !== v.saleIds.length) throw new Error("Some ticked cards are already paid or under review. Refresh the page and try again.");

  const owed = round2(claimable.reduce((n, c) => n + c.left, 0));
  if (v.cardsAmount > owed + 0.001) throw new Error(`The cards you ticked only add up to ${owed.toFixed(2)} unpaid.`);
  if (v.cardsAmount + v.sfAmount <= 0) throw new Error("Enter the amount you paid.");
  if (v.cardsAmount > 0 && claimable.length === 0) throw new Error("Tick the cards you paid for.");

  const pendingCount = customer.view.claims.filter((c) => c.status === "PENDING").length;
  if (pendingCount >= MAX_PENDING_CLAIMS) throw new Error("You already have several proofs waiting for review. Please wait for the seller to confirm them.");

  // Spread the amount across the ticked cards in order; the last one may be only part-paid.
  let remaining = v.cardsAmount;
  const parts: { saleId: string; amount: number }[] = [];
  for (const c of claimable) {
    const part = Math.min(c.left, remaining);
    if (part > 0) parts.push({ saleId: c.id, amount: round2(part) });
    remaining = round2(remaining - part);
  }

  const validated = await validateImageFile(file);
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
  const proofPath = `${customer.ownerId}/${customer.customerId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await db.storage.from("tracker-proofs").upload(proofPath, validated.bytes, { contentType: validated.contentType, upsert: false });
  if (uploadError) throw new Error(uploadError.message);

  const { data: claim, error: claimError } = await db
    .from("tracker_payment_claims")
    .insert({
      owner_id: customer.ownerId,
      customer_id: customer.customerId,
      buyer_id: buyerId,
      method: v.method,
      cards_amount: v.cardsAmount,
      sf_amount: v.sfAmount,
      proof_path: proofPath,
      note: v.note || null,
    })
    .select("id")
    .single();
  if (claimError || !claim) {
    await db.storage.from("tracker-proofs").remove([proofPath]);
    throw new Error(claimError?.message ?? "Couldn't send your proof.");
  }

  if (parts.length > 0) {
    const { error: cardsError } = await db.from("tracker_claim_cards").insert(parts.map((p) => ({ claim_id: claim.id, sale_id: p.saleId, amount: p.amount })));
    if (cardsError) {
      // Don't leave a claim behind that isn't tied to the cards that were ticked.
      await db.from("tracker_payment_claims").delete().eq("id", claim.id);
      await db.storage.from("tracker-proofs").remove([proofPath]);
      throw new Error(cardsError.message);
    }
  }

  await notifyUser(db, {
    recipientId: customer.ownerId,
    type: "tracker_proof_submitted",
    title: `Payment proof from @${buyerHandle}`,
    body: `${customer.customerName} sent a proof of payment to review.`,
    link: "/tracker/proofs",
  });
  revalidatePath("/account/orders");
  revalidatePath("/tracker", "layout");
}
