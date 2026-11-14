import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFranchiseBySlug } from "@/lib/franchises";

/** The franchise a seller said they sell ("What do you sell?" in their profile), or null when they haven't said. */
export async function sellerFranchise(adminId: string): Promise<string | null> {
  const { data } = await createAdminClient().from("seller_profiles").select("tags").eq("admin_id", adminId).maybeSingle();
  const first = (data?.tags as string[] | null)?.[0] ?? "";
  return getFranchiseBySlug(first)?.slug ?? null;
}
