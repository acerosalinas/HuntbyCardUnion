"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTrackerAdmin } from "@/lib/tracker/auth";
import { islandGroupForRegion } from "@/lib/tracker/regions";
import { refresh, money, text, parse } from "./trackerHelpers";

/** One parcel = one shipping fee, however many cards go in it. The fee is computed by the caller from the customer's island group and may be overridden/waived (0). */
export async function markShipped(input: { customerId: string; saleIds: string[]; fee: number; note: string }) {
  const admin = await requireTrackerAdmin();
  const v = parse(
    z.object({ customerId: z.string().uuid(), saleIds: z.array(z.string().uuid()).min(1, "Select at least one card.").max(500), fee: money, note: text(300) }),
    input,
  );
  const db = createAdminClient();
  const { data: customer, error: cErr } = await db
    .from("tracker_customers")
    .select("region")
    .eq("id", v.customerId)
    .eq("owner_id", admin.id)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!customer) throw new Error("Customer not found.");

  const { error } = await db.rpc("tracker_mark_shipped", {
    p_owner: admin.id,
    p_customer: v.customerId,
    p_sale_ids: v.saleIds,
    p_fee: v.fee,
    p_island_group: islandGroupForRegion(customer.region),
    p_note: v.note || null,
  });
  if (error) throw new Error(error.message);
  refresh();
}

export async function undoShipment(shipmentId: string) {
  const admin = await requireTrackerAdmin();
  const { error } = await createAdminClient().rpc("tracker_undo_shipment", { p_owner: admin.id, p_shipment: shipmentId });
  if (error) throw new Error(error.message);
  refresh();
}
