import { WantedCardsView } from "@/components/admin/WantedCardsView";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";
import { WantedCardRow, wantedCardFromRow } from "@/types/marketplace";

export default async function AdminWantedPage() {
  await requireAdmin();
  const supabase = createAdminClient();

  // Not scoped per-admin (unlike Inventory/Offers/Sales Log) - a buyer's
  // "can't find it" request isn't owned by any one seller, every admin
  // should see the same shared want-list.
  const { data } = await supabase.from("wanted_cards").select("*").order("created_at", { ascending: false });
  const wanted = ((data as WantedCardRow[] | null) ?? []).map(wantedCardFromRow);

  return <WantedCardsView wanted={wanted} />;
}
