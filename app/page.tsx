import Link from "next/link";
import { LayoutGrid, Store } from "lucide-react";
import { SellerSpotlightCard } from "@/components/SellerSpotlightCard";
import { LandingBackdrop } from "@/components/LandingBackdrop";
import { SetupNotice } from "@/components/SetupNotice";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerReadClient } from "@/lib/supabase/server";
import { SellerProfileRow, sellerProfileFromRow } from "@/types/marketplace";

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
  const [{ data: profileRows }, { data: cardRows }] = await Promise.all([
    supabase.from("seller_profiles").select("*").order("created_at", { ascending: true }),
    supabase.from("cards").select("admin_id").neq("status", "SOLD"),
  ]);

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
        <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-gold/40 bg-navy-950 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-pulse-dot absolute inline-flex h-full w-full rounded-full bg-gold" />
          </span>
          Live Marketplace
        </span>

        <span className="mb-1.5 text-xs font-semibold uppercase tracking-[0.3em] text-gold">
          Card Union
        </span>
        <h1 className="mb-2 text-center text-3xl font-bold text-foreground sm:text-4xl">
          Meet Our Sellers
        </h1>
        <p className="mb-5 max-w-md text-center text-sm text-foreground-muted sm:text-base">
          Get to know who you&apos;re buying from, then browse their live listings, claim dibs, and make offers.
        </p>

        <div className="mb-8 flex items-center gap-6 rounded-full border border-card-border bg-card/60 px-6 py-2.5 text-sm">
          <span className="flex items-center gap-1.5 text-foreground-muted">
            <LayoutGrid size={15} className="text-gold" />
            <span className="font-semibold text-foreground">{totalListings}</span> listings
          </span>
          <span className="h-4 w-px bg-card-border" />
          <span className="flex items-center gap-1.5 text-foreground-muted">
            <Store size={15} className="text-gold" />
            <span className="font-semibold text-foreground">{profiles.length}</span> sellers
          </span>
        </div>

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

        <div className="mt-10 flex flex-col items-center gap-2 text-center">
          <Link
            href="/marketplace"
            className="rounded-full border border-gold/40 bg-navy-950 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-gold transition-colors hover:bg-gold/10"
          >
            Browse All Cards
          </Link>
          <Link
            href="/how-it-works"
            className="text-xs font-medium text-foreground-muted underline underline-offset-2 transition-colors hover:text-gold"
          >
            New here? See how buying works
          </Link>
          <span className="mt-2 text-xs font-semibold uppercase tracking-[0.25em] text-gold">
            Card Union
          </span>
          <p className="text-xs text-foreground-muted">
            Claim it, message the seller, done — no bidding wars, no waiting rooms.
          </p>
        </div>
      </div>
    </div>
  );
}
