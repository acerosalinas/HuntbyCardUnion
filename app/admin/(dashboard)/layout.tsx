import { AdminTabs } from "@/components/admin/AdminTabs";
import { MetricCards } from "@/components/admin/MetricCards";
import { PriceReviewBanner } from "@/components/admin/PriceReviewBanner";
import { SetupNotice } from "@/components/SetupNotice";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentAdmin } from "@/lib/adminAuth";
import { isPriceReviewStale } from "@/lib/priceReview";

export const dynamic = "force-dynamic";

export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return <SetupNotice />;
  }

  const admin = await getCurrentAdmin();
  if (!admin) return null; // proxy.ts redirects before this can render

  const supabase = createAdminClient();
  const isSuper = admin.role === "SUPER_ADMIN";

  let cardsQuery = supabase.from("cards").select("status");
  if (!isSuper) cardsQuery = cardsQuery.eq("admin_id", admin.id);

  // Pending/sold counts and sales value now live on card_claims (a card row
  // can have some units still available and others claimed at once), not on
  // cards.status - see supabase/schema.sql's card_claims table.
  let claimsQuery = supabase.from("card_claims").select("status, quantity, unit_price, cards!inner(admin_id)");
  if (!isSuper) claimsQuery = claimsQuery.eq("cards.admin_id", admin.id);

  let offersQuery = supabase.from("offers").select("status, cards!inner(admin_id)");
  if (!isSuper) offersQuery = offersQuery.eq("cards.admin_id", admin.id);

  const [{ data: cards }, { data: claims }, { data: offers }, { data: sellerProfile }] = await Promise.all([
    cardsQuery,
    claimsQuery,
    offersQuery,
    supabase.from("seller_profiles").select("price_reviewed_at").eq("admin_id", admin.id).maybeSingle(),
  ]);

  const showPriceReviewBanner = !sellerProfile || isPriceReviewStale(sellerProfile.price_reviewed_at as string);

  const soldClaims = (claims ?? []).filter((c) => c.status === "SOLD");
  const pendingClaims = (claims ?? []).filter((c) => c.status === "PENDING");

  const metrics = {
    activeListings: (cards ?? []).filter((c) => c.status !== "SOLD").length,
    totalSalesValue: soldClaims.reduce((sum, c) => sum + Number(c.unit_price) * c.quantity, 0),
    pendingPayments: pendingClaims.length,
    openOffers: (offers ?? []).filter((o) => o.status === "PENDING").length,
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <span className="text-sm text-foreground-muted">
          {admin.email} · <span className="font-medium text-gold">{isSuper ? "Super Admin" : "Admin"}</span>
        </span>
      </div>
      <MetricCards metrics={metrics} />
      {showPriceReviewBanner && <PriceReviewBanner hasProfile={!!sellerProfile} />}
      <div className="mt-6">
        <AdminTabs isSuperAdmin={isSuper} />
        {children}
      </div>
    </div>
  );
}
