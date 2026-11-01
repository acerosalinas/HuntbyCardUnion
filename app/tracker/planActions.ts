"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTrackerAdmin } from "@/lib/tracker/auth";
import { validateSchedule } from "@/lib/tracker/installments";
import { notifyUser } from "@/lib/notify";
import { refresh, money, text, parse } from "./trackerHelpers";

const scheduleSchema = z
  .array(z.object({ dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date for every payment."), amount: money.refine((n) => n > 0, "Every payment must be more than zero.") }))
  .min(2, "An installment plan needs at least 2 payments.")
  .max(12);

/** Enter a card's installment plan yourself (it starts approved), or change the schedule of its existing plan / pending request. */
export async function savePlan(input: { saleId: string; installments: { dueDate: string; amount: number }[]; note: string }) {
  const admin = await requireTrackerAdmin();
  const v = parse(z.object({ saleId: z.string().uuid(), installments: scheduleSchema, note: text(300) }), input);
  const db = createAdminClient();

  const { data: sale, error: saleError } = await db.from("tracker_sales").select("amount, card_name, customer_id").eq("id", v.saleId).eq("owner_id", admin.id).maybeSingle();
  if (saleError) throw new Error(saleError.message);
  if (!sale) throw new Error("Card not found.");
  const problem = validateSchedule(v.installments, Number(sale.amount));
  if (problem) throw new Error(problem);

  // If this approves a customer's request, remember who asked so we can tell them.
  const { data: open } = await db
    .from("tracker_installment_plans")
    .select("status, requested_by, buyer_id")
    .eq("sale_id", v.saleId)
    .in("status", ["REQUESTED", "ACTIVE"])
    .maybeSingle();

  const { error } = await db.rpc("tracker_set_plan", {
    p_owner: admin.id,
    p_sale: v.saleId,
    p_installments: v.installments.map((i) => ({ due_date: i.dueDate, amount: i.amount })),
    p_status: "ACTIVE",
    p_requested_by: "ADMIN",
    p_buyer: null,
    p_note: v.note || null,
  });
  if (error) throw new Error(error.message);

  if (open?.status === "REQUESTED" && open.requested_by === "CUSTOMER") {
    await notifyUser(db, {
      recipientId: open.buyer_id as string | null,
      type: "tracker_proof_confirmed",
      title: "Installment plan approved",
      body: `Your installment plan for ${sale.card_name} was approved.`,
      link: "/account/orders",
    });
  }
  refresh();
  revalidatePath("/account/orders");
}

export async function declinePlan(planId: string, reason: string) {
  const admin = await requireTrackerAdmin();
  const v = parse(z.object({ planId: z.string().uuid(), reason: text(300).min(3, "Tell the customer why (a few words).") }), { planId, reason });
  const db = createAdminClient();
  const { data: updated, error } = await db
    .from("tracker_installment_plans")
    .update({ status: "DECLINED", decline_reason: v.reason, decided_at: new Date().toISOString() })
    .eq("id", v.planId)
    .eq("owner_id", admin.id)
    .eq("status", "REQUESTED")
    .select("buyer_id, sale_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) throw new Error("This request was already handled.");

  await notifyUser(db, {
    recipientId: updated.buyer_id as string | null,
    type: "tracker_proof_rejected",
    title: "Installment request not approved",
    body: v.reason,
    link: "/account/orders",
  });
  refresh();
  revalidatePath("/account/orders");
}

/** Ends an approved plan (the card goes back to being owed in full, minus anything already paid). */
export async function cancelPlan(planId: string) {
  const admin = await requireTrackerAdmin();
  const id = parse(z.string().uuid(), planId);
  const { error } = await createAdminClient()
    .from("tracker_installment_plans")
    .update({ status: "CANCELLED", decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", admin.id)
    .in("status", ["REQUESTED", "ACTIVE"]);
  if (error) throw new Error(error.message);
  refresh();
  revalidatePath("/account/orders");
}
