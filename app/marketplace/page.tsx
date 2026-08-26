import { Marketplace } from "@/components/Marketplace";
import { SetupNotice } from "@/components/SetupNotice";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerReadClient } from "@/lib/supabase/server";
import { CardRow, cardFromRow } from "@/types/marketplace";

// Was force-dynamic. A short cache window is safe here even though this
// shows live stock: useRealtimeCards patches the client the moment it
// hydrates regardless of how stale the server-cached HTML was, and the
// actual claim is re-validated atomically server-side in place_order - the
// cache can only ever affect the first paint, never who actually wins a claim.
export const revalidate = 15;

export const metadata = { title: "All Cards — Card Union" };

export default async function MarketplacePage() {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const supabase = createServerReadClient();
  const { data } = await supabase.from("cards").select("*").order("created_at", { ascending: false });
  const initialCards = ((data as CardRow[] | null) ?? []).map(cardFromRow);

  const nextDropAtRaw = process.env.NEXT_PUBLIC_NEXT_DROP_AT;
  const nextDropAt = nextDropAtRaw ? new Date(nextDropAtRaw).getTime() : null;

  return <Marketplace initialCards={initialCards} nextDropAt={nextDropAt} />;
}
