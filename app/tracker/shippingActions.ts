"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUser } from "@/lib/notify";
import { requireTrackerAdmin } from "@/lib/tracker/auth";
import { islandGroupForRegion } from "@/lib/tracker/regions";
import { canShipWithParcel } from "@/lib/tracker/marketplaceLink";
import { loadMarketplaceClaims } from "@/lib/tracker/marketplaceData";
import { refresh, money, text, parse } from "./trackerHelpers";

/**
 * One parcel = one shipping fee, however many cards go in it. The fee is computed by the caller from the customer's island group and may be
 * overridden/waived (0). `marketplaceClaimIds` are the customer's paid marketplace orders riding in the same parcel: they are marked shipped
 * with it (and put back if the parcel is undone), so one parcel and one fee covers both ledgers.
 */
export async function markShipped(input: { customerId: string; saleIds: string[]; fee: number; note: string; marketplaceClaimIds?: string[] }) {
  const admin = await requireTrackerAdmin();
  const v = parse(
    z.object({
      customerId: z.string().uuid(),
      saleIds: z.array(z.string().uuid()).min(1, "Select at least one card.").max(500),
      fee: money,
      note: text(300),
      marketplaceClaimIds: z.array(z.string().uuid()).max(100).optional(),
    }),
    input,
  );
  const db = createAdminClient();
  const { data: customer, error: cErr } = await db
    .from("tracker_customers")
    .select("region, buyer_id")
    .eq("id", v.customerId)
    .eq("owner_id", admin.id)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!customer) throw new Error("Customer not found.");

  // Checked before anything is written: only this customer's own paid, unshipped orders on this seller's cards can ride along.
  const claimIds = [...new Set(v.marketplaceClaimIds ?? [])];
  let claimTitles = new Map<string, string>();
  if (claimIds.length > 0) {
    if (!customer.buyer_id) throw new Error("This customer isn't linked to a marketplace account.");
    const open = await loadMarketplaceClaims(db, admin.id, [customer.buyer_id as string]);
    const eligible = new Map(open.filter(canShipWithParcel).map((c) => [c.id, c]));
    if (claimIds.some((id) => !eligible.has(id))) {
      throw new Error("Some marketplace orders can't ship now - they may be unpaid, already shipped or not theirs. Refresh and try again.");
    }
    claimTitles = new Map(claimIds.map((id) => [id, eligible.get(id)?.title ?? "Card"]));
  }

  const { data: shipmentId, error } = await db.rpc("tracker_mark_shipped", {
    p_owner: admin.id,
    p_customer: v.customerId,
    p_sale_ids: v.saleIds,
    p_fee: v.fee,
    p_island_group: islandGroupForRegion(customer.region),
    p_note: v.note || null,
  });
  if (error) throw new Error(error.message);

  if (claimIds.length > 0) {
    const { error: claimError } = await db
      .from("card_claims")
      .update({ shipped: true, tracker_shipment_id: shipmentId as string })
      .in("id", claimIds)
      .eq("buyer_id", customer.buyer_id as string)
      .eq("status", "SOLD")
      .eq("shipped", false);
    if (claimError) {
      // Don't leave a half-shipped parcel behind: take the whole shipment back and say why.
      await db.rpc("tracker_undo_shipment", { p_owner: admin.id, p_shipment: shipmentId });
      throw new Error(`Couldn't mark the marketplace orders as shipped (${claimError.message}), so nothing was shipped. Run supabase/migration_unified_customer.sql if you haven't yet.`);
    }
    for (const id of claimIds) {
      await notifyUser(db, {
        recipientId: customer.buyer_id as string,
        type: "claim_shipped",
        title: "Your order is on the way",
        body: `"${claimTitles.get(id) ?? "Card"}" has been marked as shipped.`,
        link: "/account/dibs",
      });
    }
  }
  refresh();
}

export async function undoShipment(shipmentId: string) {
  const admin = await requireTrackerAdmin();
  const db = createAdminClient();

  // Marketplace orders that rode in this parcel go back to "not shipped" first: undoing the shipment clears the link to them.
  const { data: shipment } = await db.from("tracker_shipments").select("id").eq("id", shipmentId).eq("owner_id", admin.id).maybeSingle();
  let restored: string[] = [];
  if (shipment) {
    const { data: rode, error: rodeError } = await db.from("card_claims").select("id").eq("tracker_shipment_id", shipmentId);
    // A missing column just means the shared-parcel migration hasn't been run, so no order could have ridden along.
    if (rodeError && !/tracker_shipment_id/i.test(rodeError.message)) throw new Error(rodeError.message);
    restored = (rode ?? []).map((r) => r.id as string);
    if (restored.length > 0) {
      const { error } = await db.from("card_claims").update({ shipped: false, tracker_shipment_id: null }).in("id", restored);
      if (error) throw new Error(error.message);
    }
  }

  const { error } = await db.rpc("tracker_undo_shipment", { p_owner: admin.id, p_shipment: shipmentId });
  if (error) {
    if (restored.length > 0) await db.from("card_claims").update({ shipped: true, tracker_shipment_id: shipmentId }).in("id", restored);
    throw new Error(error.message);
  }
  refresh();
}
