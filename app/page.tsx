import Link from "next/link";
import { Store } from "lucide-react";
import { SellerSpotlightCard } from "@/components/SellerSpotlightCard";
import { LandingBackdrop } from "@/components/LandingBackdrop";
import { VouchWall } from "@/components/VouchWall";
import { SetupNotice } from "@/components/SetupNotice";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerReadClient } from "@/lib/supabase/server";
import { CardShowcase } from "@/components/CardShowcase";
import { CardRow, SellerProfileRow, VouchRow, cardFromRow, sellerProfileFromRow, vouchFromRow } from "@/types/marketplace";

// Was force-dynamic (refetched on every request) - this page has no
// per-user content (seller spotlight + counts are the same for everyone;
// proxy.ts already gates the whole site behind sign-in before this ever
// renders), so a short cache window cuts real load off Supabase with no
// correctness cost. 30s, not longer, since seller counts should still feel
// current.
export const revalidate = 30;

export default async function HomePage() {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const supabase = createServerReadClient();
  const [{ data: profileRows }, { data: cardRows }, { data: vouchRows, error: vouchError }, { data: freshRows }] = await Promise.all([
    supabase.from("seller_profiles").select("*").order("created_at", { ascending: true }),
    supabase.from("cards").select("admin_id").neq("status", "SOLD"),
    supabase.from("vouches").select("*").order("created_at", { ascending: false }).limit(60),
    supabase.from("cards").select("*").in("status", ["AVAILABLE", "PENDING"]).order("created_at", { ascending: false }),
  ]);
  const fresh = ((freshRows as CardRow[] | null) ?? []).map(cardFromRow);
  // The vouch wall needs supabase/migration_vouches.sql; until it has been run the query errors and the section stays hidden.
  const vouches = vouchError ? null : ((vouchRows as VouchRow[] | null) ?? []).map(vouchFromRow);

  const profiles = ((profileRows as SellerProfileRow[] | null) ?? []).map(sellerProfileFromRow);
  const counts = new Map<string, number>();
  for (const row of (cardRows as { admin_id: string | null }[] | null) ?? []) {
    if (!row.admin_id) continue;
    counts.set(row.admin_id, (counts.get(row.admin_id) ?? 0) + 1);
  }
  const totalListings = (cardRows ?? []).length;

  return (
    <div className="relative">
      <LandingBackdrop />

      <div className="mx-auto flex w-full max-w-5xl flex-col items-center px-4 py-10 sm:py-12">
        <h1 className="mb-2 text-balance text-center font-display text-3xl font-medium tracking-tight text-foreground sm:text-5xl">
          Find your next card
        </h1>
        <p className="mb-5 max-w-md text-balance text-center text-sm text-foreground-muted sm:text-base">
          Claim it, message the seller, done. No bidding wars, no waiting rooms.
        </p>
        <div className="mb-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/marketplace"
            className="foil-shine overflow-hidden rounded-full bg-gold px-6 py-3 text-sm font-semibold text-navy-950 transition-colors hover:bg-gold-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            Browse {totalListings} cards
          </Link>
          <Link
            href="/how-it-works"
            className="px-2 py-3 text-sm font-medium text-foreground-muted underline underline-offset-4 transition-colors hover:text-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            How buying works
          </Link>
        </div>

        <CardShowcase initialCards={fresh} />

        <h2 className="mb-1 text-balance text-center font-display text-xl font-medium text-foreground sm:text-2xl">Shop by seller</h2>
        <p className="mb-5 text-center text-sm text-foreground-muted">
          {profiles.length} sellers · {totalListings} live listings
        </p>

        {profiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-card-border px-8 py-16 text-center">
            <Store size={28} className="mb-3 text-foreground-muted" />
            <p className="text-sm text-foreground-muted">No seller spotlights yet — check back soon.</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-start justify-center gap-4">
            {profiles.map((profile) => (
              <SellerSpotlightCard key={profile.adminId} profile={profile} cardCount={counts.get(profile.adminId) ?? 0} />
            ))}
          </div>
        )}

      </div>

      {vouches && <VouchWall initialVouches={vouches} />}

    </div>
  );
}
