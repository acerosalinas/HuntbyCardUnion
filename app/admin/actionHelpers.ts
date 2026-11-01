import "server-only";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";

export async function requireSuperAdmin() {
  const admin = await requireAdmin();
  if (admin.role !== "SUPER_ADMIN") throw new Error("Only super admins can manage admin accounts.");
  return admin;
}

export function revalidateAdmin() {
  revalidatePath("/admin");
  revalidatePath("/admin/offers");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/manage");
  revalidatePath("/admin/logs");
  revalidatePath("/admin/live-sales");
  revalidatePath("/admin/disputes");
  revalidatePath("/admin/profile");
  revalidatePath("/");
  revalidatePath("/sellers");
}

export async function getCardOwner(supabase: ReturnType<typeof createAdminClient>, cardId: string) {
  const { data, error } = await supabase.from("cards").select("admin_id").eq("id", cardId).single();
  if (error || !data) throw new Error(error?.message ?? "Card not found");
  return data.admin_id as string | null;
}

export interface ClaimWithCard {
  card_id: string;
  buyer_id: string | null;
  buyer_handle: string;
  quantity: number;
  unit_price: number;
  order_id: string | null;
  status: string;
  is_live_sale: boolean;
  cards: { admin_id: string | null; title: string; list_price: number; quantity_available: number } | null;
}

/** Fetches a claim joined to its card - the common lookup every per-claim admin action (confirmPaid, cancelRelist, setShipped) starts with. */
export async function getClaimWithCard(supabase: ReturnType<typeof createAdminClient>, claimId: string): Promise<ClaimWithCard> {
  const { data, error } = await supabase
    .from("card_claims")
    .select(
      "card_id, buyer_id, buyer_handle, quantity, unit_price, order_id, status, is_live_sale, cards(admin_id, title, list_price, quantity_available)",
    )
    .eq("id", claimId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Claim not found");
  return data as unknown as ClaimWithCard;
}

/** Marks any remaining WAITING queue entries for a card as CANCELLED - used whenever the card's PENDING chain ends (sold or released). */
export async function cancelQueue(supabase: ReturnType<typeof createAdminClient>, cardId: string) {
  await supabase
    .from("dibs_queue")
    .update({ status: "CANCELLED" })
    .eq("card_id", cardId)
    .eq("status", "WAITING");
}
