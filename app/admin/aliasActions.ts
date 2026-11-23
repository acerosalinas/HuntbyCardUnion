"use server";

import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanAlias } from "@/lib/buyerAlias";
import { revalidateAdmin } from "./actionHelpers";

const SETUP = "Sub usernames need a one-time setup: run supabase/migration_buyer_aliases.sql in the Supabase SQL editor first.";

/**
 * Sets (or, with blank text, clears) the sub username THIS admin gives a customer account. Any admin can do it; it is private to them:
 * other admins never see it and the customer never does. Returns { error } for expected refusals.
 */
export async function setBuyerAlias(buyerId: string, alias: string): Promise<{ error?: string; alias?: string | null }> {
  try {
    const admin = await requireAdmin();
    const parsed = z.string().uuid().safeParse(buyerId);
    if (!parsed.success) return { error: "That account isn't valid." };
    const db = createAdminClient();
    const { data: profile } = await db.from("profiles").select("id").eq("id", buyerId).maybeSingle();
    if (!profile) return { error: "That customer account doesn't exist." };

    const clean = cleanAlias(String(alias ?? ""));
    if (!clean) {
      const { error } = await db.from("buyer_aliases").delete().eq("admin_id", admin.id).eq("buyer_id", buyerId);
      if (error) return { error: /buyer_aliases|schema cache|does not exist/i.test(error.message) ? SETUP : error.message };
      revalidateAdmin();
      return { alias: null };
    }
    const { error } = await db.from("buyer_aliases").upsert({ admin_id: admin.id, buyer_id: buyerId, alias: clean, updated_at: new Date().toISOString() }, { onConflict: "admin_id,buyer_id" });
    if (error) return { error: /buyer_aliases|schema cache|does not exist/i.test(error.message) ? SETUP : error.message };
    revalidateAdmin();
    return { alias: clean };
  } catch (err) {
    console.error("[setBuyerAlias]", err);
    return { error: "Couldn't save the sub username." };
  }
}
