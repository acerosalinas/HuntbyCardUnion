"use server";

import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertOwnsOrSuper, requireAdmin } from "@/lib/adminAuth";
import { sendOrderConfirmedEmail } from "@/lib/email";
import { notifyUser } from "@/lib/notify";
import { formatCurrency } from "@/lib/utils";
import { revalidateAdmin, getClaimWithCard, cancelQueue, requireSuperAdmin } from "./actionHelpers";

/**
 * Emails the buyer once payment is confirmed. Fires once per claim, but a
 * cart checkout groups multiple claims into one `orders` row - to avoid
 * spamming one email per claim, this only actually sends once every claim in
 * the order is accounted for (try_claim_order_confirmation is an atomic
 * single-row claim in Postgres, so concurrent per-claim confirmations can't
 * both win and send duplicate emails - see schema.sql for why a plain
 * count-remaining-unconfirmed check from Node would be racy). Claims with no
 * order_id (an accepted offer, not a cart checkout) email immediately.
 * Never throws - a failed lookup/send must not surface as a failure of the
 * actual payment confirmation.
 */
async function notifyBuyerPaymentConfirmed(
  supabase: ReturnType<typeof createAdminClient>,
  buyerId: string,
  orderId: string | null,
  fallbackItem: { title: string; price: number },
) {
  try {
    let items = [fallbackItem];

    if (orderId) {
      const { data: claimed } = await supabase.rpc("try_claim_order_confirmation", { p_order_id: orderId });
      if (!claimed) return;

      const { data: orderClaims } = await supabase
        .from("card_claims")
        .select("quantity, unit_price, cards(title)")
        .eq("order_id", orderId)
        .eq("status", "SOLD");
      if (orderClaims && orderClaims.length > 0) {
        items = (orderClaims as unknown as { quantity: number; unit_price: number; cards: { title: string } | null }[]).map(
          (c) => ({ title: c.cards?.title ?? "Card", price: c.unit_price * c.quantity }),
        );
      }
    }

    const { data: userRes } = await supabase.auth.admin.getUserById(buyerId);
    const email = userRes?.user?.email;
    if (!email) return;

    const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", buyerId).maybeSingle();

    await sendOrderConfirmedEmail({
      to: email,
      buyerName: profile?.full_name ?? "there",
      items,
      total: items.reduce((sum, i) => sum + i.price, 0),
      orderId,
    });
  } catch (err) {
    console.error("Failed to send payment-confirmation email:", err);
  }
}

export async function confirmPaid(claimId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const claim = await getClaimWithCard(supabase, claimId);
  assertOwnsOrSuper(admin, claim.cards?.admin_id ?? null);

  // confirm_paid_claim (supabase/schema.sql) locks the claim row and
  // re-checks status = PENDING inside one transaction, so a concurrent
  // cancelRelist on the same claim can't race past this check - see the
  // "atomic admin claim/stock mutations" migration for why that matters.
  const { data: updated, error } = await supabase.rpc("confirm_paid_claim", { p_claim_id: claimId });
  if (error) throw new Error(error.message);

  revalidateAdmin();

  // The buyer's email + in-app notification run after the response, so the
  // admin's button doesn't wait on Resend and several more database round-trips.
  const buyerId = updated?.buyer_id as string | null;
  if (buyerId) {
    const confirmed: ConfirmedPayment = {
      buyerId,
      orderId: updated.order_id as string | null,
      title: claim.cards?.title ?? "Card",
      price: (updated.unit_price as number) * (updated.quantity as number),
    };
    after(() => notifyPaymentsConfirmed(supabase, [confirmed]));
  }
}

/**
 * "Confirm all" for a buyer's pending claims - confirms each through the same
 * locked confirm_paid_claim RPC as confirmPaid (so a claim that's already
 * been confirmed/cancelled elsewhere is skipped and reported, never
 * double-processed), then sends ONE email per order and one in-app
 * notification per buyer instead of one per card.
 */
export async function confirmPaidMany(claimIds: string[]): Promise<{ confirmed: number; failed: number; firstError: string | null }> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const ids = [...new Set(claimIds)];
  if (ids.length === 0) return { confirmed: 0, failed: 0, firstError: null };
  if (ids.length > 100) throw new Error("Too many claims at once - confirm in smaller batches.");

  const { data: claims, error: fetchError } = await supabase
    .from("card_claims")
    .select("id, cards(admin_id, title)")
    .in("id", ids);
  if (fetchError) throw new Error(fetchError.message);
  const found = (claims ?? []) as unknown as { id: string; cards: { admin_id: string | null; title: string } | null }[];
  if (found.length !== ids.length) throw new Error("Some of these claims no longer exist - refresh and try again.");
  // Ownership is checked for every claim before any of them is touched, so
  // one claim that isn't yours can't leave the rest half-confirmed.
  for (const claim of found) assertOwnsOrSuper(admin, claim.cards?.admin_id ?? null);
  const titleById = new Map(found.map((c) => [c.id, c.cards?.title ?? "Card"]));

  const results = await Promise.all(
    ids.map(async (id) => ({ id, ...(await supabase.rpc("confirm_paid_claim", { p_claim_id: id })) })),
  );

  const confirmedPayments: ConfirmedPayment[] = [];
  let failed = 0;
  let firstError: string | null = null;
  for (const result of results) {
    if (result.error || !result.data) {
      failed++;
      firstError ??= result.error?.message ?? "Could not confirm this claim.";
      continue;
    }
    const row = result.data as { buyer_id: string | null; order_id: string | null; unit_price: number; quantity: number };
    if (row.buyer_id) {
      confirmedPayments.push({
        buyerId: row.buyer_id,
        orderId: row.order_id,
        title: titleById.get(result.id) ?? "Card",
        price: row.unit_price * row.quantity,
      });
    }
  }

  revalidateAdmin();
  if (confirmedPayments.length > 0) {
    after(() => notifyPaymentsConfirmed(supabase, confirmedPayments));
  }

  return { confirmed: ids.length - failed, failed, firstError };
}

interface ConfirmedPayment {
  buyerId: string;
  orderId: string | null;
  title: string;
  price: number;
}

/**
 * The buyer-facing side of confirming payment(s): one confirmation email per
 * order (notifyBuyerPaymentConfirmed already de-dupes per order, and lists
 * every paid item on it), and one in-app notification per buyer - a single
 * line for one card, a combined line when several were confirmed together.
 */
async function notifyPaymentsConfirmed(supabase: ReturnType<typeof createAdminClient>, payments: ConfirmedPayment[]) {
  const emailed = new Set<string>();
  for (const payment of payments) {
    if (payment.orderId) {
      if (emailed.has(payment.orderId)) continue;
      emailed.add(payment.orderId);
    }
    await notifyBuyerPaymentConfirmed(supabase, payment.buyerId, payment.orderId, {
      title: payment.title,
      price: payment.price,
    });
  }

  const byBuyer = new Map<string, ConfirmedPayment[]>();
  for (const payment of payments) {
    const bucket = byBuyer.get(payment.buyerId);
    if (bucket) bucket.push(payment);
    else byBuyer.set(payment.buyerId, [payment]);
  }
  for (const [buyerId, items] of byBuyer) {
    await notifyUser(supabase, {
      recipientId: buyerId,
      type: "payment_confirmed",
      title: "Payment confirmed",
      body:
        items.length === 1
          ? `Your payment for "${items[0].title}" has been confirmed.`
          : `Your payment for ${items.length} cards has been confirmed: ${items.map((i) => `"${i.title}"`).join(", ")}.`,
      link: "/account/dibs",
    });
  }
}

export async function cancelRelist(claimId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const claim = await getClaimWithCard(supabase, claimId);
  const card = claim.cards;
  if (!card) throw new Error("Card not found");
  assertOwnsOrSuper(admin, card.admin_id);

  // cancel_relist_claim locks the claim then the card row and re-checks
  // status/open-disputes inside that lock, closing the same race window
  // confirmPaid above does.
  const { data: rpcData, error } = await supabase.rpc("cancel_relist_claim", { p_claim_id: claimId }).single();
  if (error) throw new Error(error.message);
  const data = rpcData as { out_card_id: string; out_buyer_id: string | null };

  await cancelQueue(supabase, data.out_card_id);
  revalidateAdmin();

  await notifyUser(supabase, {
    recipientId: data.out_buyer_id,
    type: "listing_cancelled",
    title: "Listing cancelled",
    body: `"${card.title}" was cancelled and re-listed by the seller.`,
    link: "/marketplace",
  });
}

/**
 * Promotes the earliest WAITING queue entry whose requested_quantity fits
 * into the card's current quantity_available, turning it into a new
 * card_claims row (the admin then reaches out to that buyer manually, since
 * the app has no way to message them directly). No-ops if nothing in the
 * queue currently fits - unlike the old single-claimant model, there's no
 * "release the card" fallback needed here anymore: quantity_available
 * already reflects what's genuinely open, with no separate manual reset.
 */
export async function promoteNextInQueue(cardId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { data: card, error: cardFetchError } = await supabase.from("cards").select("admin_id").eq("id", cardId).single();
  if (cardFetchError || !card) throw new Error(cardFetchError?.message ?? "Card not found");
  assertOwnsOrSuper(admin, card.admin_id);

  // promote_next_in_queue locks the card row (and the picked queue entry)
  // for the whole find-eligible-entry -> insert-claim -> decrement-stock
  // sequence, so this can't double-promote the same stock unit against a
  // concurrent call (e.g. two admins hitting "Promote" on the same card).
  const { data: rpcData, error } = await supabase.rpc("promote_next_in_queue", { p_card_id: cardId }).single();
  if (error) throw new Error(error.message);
  const data = rpcData as { out_promoted: boolean; out_buyer_id: string; out_buyer_handle: string; out_unit_price: number };

  if (!data.out_promoted) {
    return { promoted: false as const };
  }

  revalidateAdmin();

  await notifyUser(supabase, {
    recipientId: data.out_buyer_id,
    type: "queue_promoted",
    title: "You're up next",
    body: `A card you were waiting on is now yours to pay for at ${formatCurrency(data.out_unit_price)} - the seller will message you.`,
    link: "/account/dibs",
  });

  return { promoted: true as const, buyerHandle: data.out_buyer_handle };
}

export async function setShipped(claimId: string, shipped: boolean) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const claim = await getClaimWithCard(supabase, claimId);
  assertOwnsOrSuper(admin, claim.cards?.admin_id ?? null);

  const { error } = await supabase.from("card_claims").update({ shipped }).eq("id", claimId);
  if (error) throw new Error(error.message);
  revalidateAdmin();

  if (shipped && claim.buyer_id) {
    const title = claim.cards?.title ?? "Card";
    await notifyUser(supabase, {
      recipientId: claim.buyer_id,
      type: "claim_shipped",
      title: "Your order is on the way",
      body: `"${title}" has been marked as shipped/stashed.`,
      link: "/account/dibs",
    });
  }
}

// ---------------------------------------------------------------------------
// Live Sales - a super admin running a Facebook Live stream assigns a card
// straight to the winning buyer's account instead of checking it out under
// their own (which is what prompted this: a real sale ended up attributed
// to the admin, not the buyer). There's no way to write into a buyer's
// cart - it's client-side localStorage, not server state - so this creates
// the PENDING claim directly instead, which lands in their My Dibs exactly
// like a normal checkout would, just skipping the buyer clicking anything.
// Restricted to a super admin's own store: each store owner runs their own
// lives, this was never meant to let one super admin assign cards out of a
// different seller's inventory.
// ---------------------------------------------------------------------------

/** Handle search for the assign-a-buyer autocomplete - super admin only, same gate as the rest of this section. */
export async function findBuyerByHandle(query: string): Promise<{ id: string; handle: string; fullName: string }[]> {
  await requireSuperAdmin();
  const q = query.trim().replace(/^@/, "");
  if (q.length < 2) return [];

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, handle, full_name")
    .ilike("handle", `%${q}%`)
    .limit(8);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: r.id as string, handle: r.handle as string, fullName: r.full_name as string }));
}

export interface AssignLiveSaleInput {
  cardId: string;
  buyerId: string;
  fulfillmentMethod: "SHIP" | "STASH";
  paymentMethod: "PREPAID" | "COD";
}

export async function assignLiveSale(input: AssignLiveSaleInput) {
  const admin = await requireSuperAdmin();
  const supabase = createAdminClient();

  const { data: card, error: cardError } = await supabase.from("cards").select("admin_id").eq("id", input.cardId).single();
  if (cardError || !card) throw new Error(cardError?.message ?? "Card not found");
  if (card.admin_id !== admin.id) throw new Error("You can only assign live sales for your own store.");

  const { data: buyer, error: buyerError } = await supabase
    .from("profiles")
    .select("id, handle")
    .eq("id", input.buyerId)
    .single();
  if (buyerError || !buyer) throw new Error("Buyer not found.");

  // assign_live_sale locks the card row for the stock-check -> insert-claim
  // -> decrement sequence, so two fast clicks against the last unit can't
  // both succeed.
  const { data: rpcData, error: rpcError } = await supabase
    .rpc("assign_live_sale", {
      p_card_id: input.cardId,
      p_buyer_id: buyer.id,
      p_buyer_handle: buyer.handle,
      p_fulfillment_method: input.fulfillmentMethod,
      p_payment_method: input.paymentMethod,
    })
    .single();
  if (rpcError) throw new Error(rpcError.message);
  const data = rpcData as { out_unit_price: number; out_card_title: string };

  revalidateAdmin();

  const unitPrice = data.out_unit_price;
  await notifyUser(supabase, {
    recipientId: buyer.id,
    type: "live_sale_assigned",
    title: "You claimed a card during a live stream!",
    body: `"${data.out_card_title}" is waiting for you in My Dibs at ${formatCurrency(unitPrice)} - complete payment to secure it.`,
    link: "/account/dibs",
  });
}

/** Deletes a live-assigned sale and restocks the card - the "I checked it out under the wrong account" undo button. Only ever touches is_live_sale rows; a regular sale still has no undo (see the Sales Log's lack of one). */
export async function removeLiveSale(claimId: string) {
  const admin = await requireSuperAdmin();
  const supabase = createAdminClient();

  const claim = await getClaimWithCard(supabase, claimId);
  const card = claim.cards;
  if (!card) throw new Error("Card not found");
  if (card.admin_id !== admin.id) throw new Error("You can only remove sales from your own store.");

  // remove_live_sale_claim locks the claim then the card row and re-checks
  // is_live_sale/status/open-disputes inside that lock.
  const { error } = await supabase.rpc("remove_live_sale_claim", { p_claim_id: claimId });
  if (error) throw new Error(error.message);

  revalidateAdmin();
}
