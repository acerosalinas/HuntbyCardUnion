import Link from "next/link";
import { ArrowLeft, LogOut } from "lucide-react";
import { SetupNotice } from "@/components/SetupNotice";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TrackerNav } from "@/components/tracker/TrackerNav";
import { StickyBar } from "@/components/tracker/StickyBar";
import { requireTrackerAdminOrRedirect } from "@/lib/tracker/auth";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { logout } from "@/app/admin/actions";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// A standalone workspace for live selling: deliberately NOT inside
// app/admin/(dashboard), so none of the marketplace admin chrome (metric
// cards, listing tabs) shows here. The site navbar/footer are hidden for
// /tracker too (see Navbar.tsx and ChromeGate in app/layout.tsx). Access is
// guarded by proxy.ts exactly like /admin, and again here.
export default async function TrackerLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return <SetupNotice />;
  }
  const admin = await requireTrackerAdminOrRedirect();

  // Proofs waiting for review, for the menu badge. Quietly 0 until the claims migration has been run.
  const { count: proofCount } = await createAdminClient()
    .from("tracker_payment_claims")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", admin.id)
    .eq("status", "PENDING");

  return (
    <div className="min-h-screen">
      <StickyBar>
      <header>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/tracker" className="flex items-center gap-2.5">
            <Logo src="/crdunion.png" iconOnly />
            <span className="leading-tight">
              <span className="block text-base font-bold">Live Tracker</span>
              <span className="block text-[11px] uppercase tracking-widest text-gold">Hunt by Card Union</span>
            </span>
          </Link>
          <div className="flex items-center gap-1.5">
            <span className="hidden text-xs text-foreground-muted sm:inline">{admin.email}</span>
            <Link
              href="/admin"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <ArrowLeft size={14} />
              <span className="hidden sm:inline">Admin</span>
            </Link>
            <ThemeToggle />
            <form action={logout}>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <LogOut size={14} />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 pb-3 sm:px-6">
        <TrackerNav proofCount={proofCount ?? 0} />
      </div>
      </StickyBar>
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">{children}</div>
    </div>
  );
}
