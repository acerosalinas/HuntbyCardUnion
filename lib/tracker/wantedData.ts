import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchWanted, WantedMatch } from "./wanted";

/**
 * Open buyer requests ("Can't find a card?") that may match the given cards, per card. Best-effort: if the
 * requests or the notice table can't be read, the screen simply shows no flags rather than failing.
 */
export async function loadWantedMatches(ownerId: string, sales: { id: string; cardName: string }[]): Promise<Record<string, WantedMatch[]>> {
  if (sales.length === 0) return {};
  const db = createAdminClient();
  const { data: rows, error } = await db.from("wanted_cards").select("id, buyer_id, buyer_handle, card_name").eq("status", "OPEN");
  if (error || !rows || rows.length === 0) return {};

  const { data: noticeRows } = await db.from("tracker_wanted_notices").select("wanted_id, sale_id").eq("owner_id", ownerId);
  const notified = new Set((noticeRows ?? []).map((n) => `${n.wanted_id}:${n.sale_id}`));

  return matchWanted(
    sales,
    rows.map((r) => ({ id: r.id as string, buyerId: (r.buyer_id as string | null) ?? null, buyerHandle: String(r.buyer_handle ?? "").replace(/^@/, ""), cardName: r.card_name as string })),
    notified,
  );
}
