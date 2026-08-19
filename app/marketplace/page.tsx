import { Marketplace } from "@/components/Marketplace";
import { SetupNotice } from "@/components/SetupNotice";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerReadClient } from "@/lib/supabase/server";
import { CardRow, cardFromRow } from "@/types/marketplace";

export const dynamic = "force-dynamic";

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
