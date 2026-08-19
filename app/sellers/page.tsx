import { Store } from "lucide-react";
import { SellerSpotlightCard } from "@/components/SellerSpotlightCard";
import { SetupNotice } from "@/components/SetupNotice";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerReadClient } from "@/lib/supabase/server";
import { SellerProfileRow, sellerProfileFromRow } from "@/types/marketplace";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sellers — Card Union" };

export default async function SellersPage() {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const supabase = createServerReadClient();
  const [{ data: profileRows }, { data: cardRows }] = await Promise.all([
    supabase.from("seller_profiles").select("*").order("display_name", { ascending: true }),
    supabase.from("cards").select("admin_id").neq("status", "SOLD"),
  ]);

  const profiles = ((profileRows as SellerProfileRow[] | null) ?? []).map(sellerProfileFromRow);
  const counts = new Map<string, number>();
  for (const row of (cardRows as { admin_id: string | null }[] | null) ?? []) {
    if (!row.admin_id) continue;
    counts.set(row.admin_id, (counts.get(row.admin_id) ?? 0) + 1);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="mb-6 text-2xl font-bold text-foreground">Sellers</h1>

      {profiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-card-border py-24 text-center">
          <Store size={28} className="mb-3 text-foreground-muted" />
          <p className="text-sm text-foreground-muted">No seller spotlights yet.</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-4">
          {profiles.map((profile) => (
            <SellerSpotlightCard key={profile.adminId} profile={profile} cardCount={counts.get(profile.adminId) ?? 0} />
          ))}
        </div>
      )}
    </div>
  );
}
