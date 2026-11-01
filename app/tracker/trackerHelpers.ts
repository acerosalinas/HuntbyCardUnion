import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

// Every action here derives the owner from the signed-in admin's session and
// filters every query by it. The service-role client bypasses RLS, so these
// owner_id filters are the only thing keeping one admin out of another's
// ledger - never take an owner id from the client.

export function refresh() {
  revalidatePath("/tracker", "layout");
}

export type Db = ReturnType<typeof createAdminClient>;

export const money = z.number().finite().min(0).max(10_000_000);
export const text = (max: number) => z.string().trim().max(max);

export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error(result.error.issues[0]?.message ?? "Invalid input.");
  return result.data;
}

export async function assertOwned(db: Db, table: string, id: string, ownerId: string, label: string) {
  const { data, error } = await db.from(table).select("id").eq("id", id).eq("owner_id", ownerId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`${label} not found.`);
}

export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Finds the owner's customer by name (case-insensitive) or creates it. */
export async function findOrCreateCustomer(db: Db, ownerId: string, rawName: string): Promise<{ id: string; created: boolean }> {
  const name = parse(text(120).min(1, "Enter the customer's name."), rawName);
  const find = async () => {
    const { data, error } = await db
      .from("tracker_customers")
      .select("id")
      .eq("owner_id", ownerId)
      .ilike("name", escapeLike(name))
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.id as string | undefined;
  };
  const existing = await find();
  if (existing) return { id: existing, created: false };

  const { data, error } = await db.from("tracker_customers").insert({ owner_id: ownerId, name }).select("id").single();
  if (error) {
    // Two quick adds of the same new name: the unique index rejects the second.
    if (error.code === "23505") {
      const raced = await find();
      if (raced) return { id: raced, created: false };
    }
    throw new Error(error.message);
  }
  return { id: data.id as string, created: true };
}
