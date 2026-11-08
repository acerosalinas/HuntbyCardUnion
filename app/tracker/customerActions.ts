"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTrackerAdmin } from "@/lib/tracker/auth";
import { islandGroupForRegion, REGIONS } from "@/lib/tracker/regions";
import { refresh, text, parse, assertOwned, escapeLike } from "./trackerHelpers";

export interface CustomerInput {
  name: string;
  region: string;
  provinceCity: string;
  barangay: string;
  zip: string;
  street: string;
}

export async function saveCustomer(id: string, input: CustomerInput) {
  const admin = await requireTrackerAdmin();
  const v = parse(
    z.object({
      name: text(120).min(1, "Enter the customer's name."),
      region: z.string().refine((r) => r === "" || REGIONS.some((x) => x.value === r), "Pick a valid region."),
      provinceCity: text(120),
      barangay: text(120),
      zip: text(10).refine((z) => z === "" || /^\d{4}$/.test(z), "ZIP code must be 4 digits."),
      street: text(200),
    }),
    input,
  );
  const blank = (s: string) => (s === "" ? null : s);
  const { error } = await createAdminClient()
    .from("tracker_customers")
    .update({
      name: v.name,
      region: blank(v.region),
      province_city: blank(v.provinceCity),
      barangay: blank(v.barangay),
      zip: blank(v.zip),
      street: blank(v.street),
      island_group: islandGroupForRegion(v.region),
    })
    .eq("id", id)
    .eq("owner_id", admin.id);
  if (error) throw new Error(error.code === "23505" ? "You already have a customer with that name." : error.message);
  refresh();
}

/** Handle search for the "link this customer to an account" box. */
export async function findBuyers(query: string): Promise<{ id: string; handle: string; fullName: string }[]> {
  await requireTrackerAdmin();
  const q = query.trim().replace(/^@/, "");
  if (q.length < 2) return [];
  const { data, error } = await createAdminClient().from("profiles").select("id, handle, full_name").ilike("handle", `%${escapeLike(q)}%`).limit(8);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: r.id as string, handle: r.handle as string, fullName: r.full_name as string }));
}

/** Links a tracker customer to a marketplace account (or unlinks with null). One account can be linked to one customer. */
export async function linkCustomerBuyer(customerId: string, buyerId: string | null) {
  const admin = await requireTrackerAdmin();
  const v = parse(z.object({ customerId: z.string().uuid(), buyerId: z.string().uuid().nullable() }), { customerId, buyerId });
  const db = createAdminClient();
  await assertOwned(db, "tracker_customers", v.customerId, admin.id, "Customer");

  if (v.buyerId) {
    const { data: profile, error: profileError } = await db.from("profiles").select("id").eq("id", v.buyerId).maybeSingle();
    if (profileError) throw new Error(profileError.message);
    if (!profile) throw new Error("That account doesn't exist.");
  }

  const { error } = await db.from("tracker_customers").update({ buyer_id: v.buyerId }).eq("id", v.customerId).eq("owner_id", admin.id);
  if (error) {
    if (error.code === "23505") {
      const { data: other } = await db.from("tracker_customers").select("name").eq("owner_id", admin.id).eq("buyer_id", v.buyerId as string).maybeSingle();
      throw new Error(`That account is already linked to ${other?.name ?? "another customer"}. Unlink it there first.`);
    }
    throw new Error(error.message);
  }
  refresh();
}

/** Links several customers to the accounts the admin confirmed from the suggestions. Each goes through the same checks as a single link; failures are reported, the rest still link. */
export async function linkSuggested(pairs: { customerId: string; buyerId: string }[]): Promise<{ linked: string[]; firstError: string | null }> {
  await requireTrackerAdmin();
  const list = parse(z.array(z.object({ customerId: z.string().uuid(), buyerId: z.string().uuid() })).max(200), pairs);
  const linked: string[] = [];
  let firstError: string | null = null;
  for (const pair of list) {
    try {
      await linkCustomerBuyer(pair.customerId, pair.buyerId);
      linked.push(pair.customerId);
    } catch (err) {
      firstError ??= err instanceof Error ? err.message : "Couldn't link one of them.";
    }
  }
  return { linked, firstError };
}

/** Returns { error } when it can't be deleted - a thrown message is hidden in production (React #441), so expected refusals come back as a value. */
export async function deleteCustomer(id: string): Promise<{ error: string } | void> {
  const admin = await requireTrackerAdmin();
  const db = createAdminClient();
  await assertOwned(db, "tracker_customers", id, admin.id, "Customer");
  for (const table of ["tracker_sales", "tracker_payments", "tracker_shipments"]) {
    const { count, error } = await db.from(table).select("id", { count: "exact", head: true }).eq("customer_id", id).eq("owner_id", admin.id);
    if (error) throw new Error(error.message);
    if (count) return { error: "This customer has cards or payments recorded, so they can't be deleted. Remove their cards and payments first." };
  }
  const { error } = await db.from("tracker_customers").delete().eq("id", id).eq("owner_id", admin.id);
  if (error) throw new Error(error.message);
  refresh();
  // Leave from the server: the page the user is on (this customer's) no longer exists, so letting the
  // revalidation rebuild it fails ("An error occurred in the Server Components render", React #441).
  redirect("/tracker/customers");
}
