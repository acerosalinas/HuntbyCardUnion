import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BuyerAliasInfo } from "@/lib/buyerAlias";
import { selectIn } from "@/lib/chunkedIn";

const MISSING = /buyer_aliases|schema cache|does not exist/i;

/**
 * For each buyer @handle on an admin's screen: the buyer's account id and the sub username THIS admin gave them (if any).
 * Only this admin's own labels are ever read. Quietly gives no labels until migration_buyer_aliases.sql has been run, so a list never breaks over it.
 */
export async function loadAliasInfo(adminId: string, handles: string[]): Promise<Record<string, BuyerAliasInfo>> {
  const unique = [...new Set(handles.filter(Boolean))];
  const out: Record<string, BuyerAliasInfo> = {};
  if (unique.length === 0) return out;
  const db = createAdminClient();
  // Handles are stored with a leading @ on profiles, but some records keep them without it: look up both shapes, key the answer by what the caller has.
  const at = (h: string) => `@${h.replace(/^@+/, "")}`;
  const profiles = await selectIn<{ id: string; handle: string }>(unique.map(at), (batch) => db.from("profiles").select("id, handle").in("handle", batch));
  const idByAt = new Map(profiles.map((p) => [p.handle, p.id]));
  const idByHandle = new Map(unique.flatMap((h) => (idByAt.has(at(h)) ? [[h, idByAt.get(at(h)) as string] as [string, string]] : [])));
  const ids = [...idByHandle.values()];
  let aliasById = new Map<string, string>();
  if (ids.length > 0) {
    try {
      const rows = await selectIn<{ buyer_id: string; alias: string }>(ids, (batch) => db.from("buyer_aliases").select("buyer_id, alias").eq("admin_id", adminId).in("buyer_id", batch));
      aliasById = new Map(rows.map((r) => [r.buyer_id, r.alias]));
    } catch (err) {
      // Quietly no labels until migration_buyer_aliases.sql has been run; anything else is a real problem.
      if (!(err instanceof Error && MISSING.test(err.message))) throw err;
    }
  }
  for (const h of unique) {
    const id = idByHandle.get(h) ?? null;
    out[h] = { buyerId: id, alias: id ? (aliasById.get(id) ?? null) : null };
  }
  return out;
}

/** Account ids whose sub username (as this admin gave it) contains the search text - so typing a label finds the customer. */
export async function findBuyerIdsByAlias(adminId: string, text: string): Promise<string[]> {
  const q = text.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  if (q.length < 2) return [];
  const { data, error } = await createAdminClient().from("buyer_aliases").select("buyer_id").eq("admin_id", adminId).ilike("alias", `%${q}%`).limit(20);
  if (error) {
    if (MISSING.test(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => r.buyer_id as string);
}
