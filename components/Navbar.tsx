"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, LayoutGrid, Menu, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { SearchBar } from "@/components/SearchBar";
import { CategoryFilters } from "@/components/CategoryFilters";
import { RarityFilter } from "@/components/RarityFilter";
import { PokemonTypeFilter } from "@/components/PokemonTypeFilter";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CartNavLink } from "@/components/CartNavLink";
import { MyDibsNavLink } from "@/components/MyDibsNavLink";
import { AccountNavLink } from "@/components/AccountNavLink";
import { useNavPending } from "@/components/NavPendingProvider";
import { NotificationBell } from "@/components/NotificationBell";
import { MobileNavDrawer } from "@/components/MobileNavDrawer";
import { AdminMobileNavDrawer } from "@/components/AdminMobileNavDrawer";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
import { useCart } from "@/components/CartProvider";
import { useAdminSession } from "@/hooks/useAdminSession";
import { useBuyerNotifications } from "@/hooks/useBuyerNotifications";
import { useAdminNotifications } from "@/hooks/useAdminNotifications";

const AUTH_PATH_PREFIXES = ["/account/login", "/account/signup", "/account/check-email", "/account/complete-profile"];

export function Navbar() {
  const pathname = usePathname();
  const { pending, markPending } = useNavPending();
  const { buyer } = useBuyerIdentity();
  const { items } = useCart();
  const adminSession = useAdminSession();
  const isAdmin = pathname?.startsWith("/admin");
  const isLanding = pathname === "/";
  const isAuthPage = AUTH_PATH_PREFIXES.some((p) => pathname?.startsWith(p));
  const showBrowseControls = !isAdmin && !isLanding && !isAuthPage;
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Called once here (not by two independent <BuyerNotificationBell>/
  // <AdminNotificationBell> instances, one per mobile/desktop row) since
  // both rows are always in the DOM at once (CSS just hides one) - two
  // instances meant two competing Realtime subscriptions to the same
  // channel, which crashed the page. One shared subscription/poll, fed
  // into a <NotificationBell> in each row instead.
  const buyerNotifications = useBuyerNotifications();
  const adminNotifications = useAdminNotifications(Boolean(isAdmin));

  // A link inside either drawer already closes it on click (see
  // MobileNavDrawer/AdminMobileNavDrawer), but this covers every other way
  // the route can change (browser back/forward, a redirect, etc.).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- closing a drawer left open from a previous route, not synchronizing render state
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-card-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6">
        {/* Mobile (<768px): single integrated row - logo, search, quick-access icons, hamburger. Primary nav lives in the drawer instead of a second row. */}
        <div className="flex flex-1 items-center gap-2 md:hidden">
          <Link href="/" className="shrink-0">
            <Logo src="/crdunion.png" iconOnly />
          </Link>
          {showBrowseControls && <SearchBar className="min-w-0 flex-1" />}
          {isAuthPage ? (
            <ThemeToggle />
          ) : isAdmin ? (
            <div className="ml-auto flex items-center gap-1">
              <NotificationBell
                notifications={adminNotifications.notifications}
                onOpen={adminNotifications.refetch}
                onMarkRead={adminNotifications.markRead}
                onMarkAllRead={adminNotifications.markAllRead}
              />
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <Menu size={22} />
              </button>
            </div>
          ) : (
            // Stays mounted (not conditionally removed) while `pending` is
            // true so it keeps reserving its layout width - unmounting it
            // here would free up flex space that SearchBar's flex-1
            // immediately expands into. See the desktop row below for the
            // full version of this comment.
            <div className={cn("ml-auto flex items-center gap-1", pending && "invisible")}>
              {buyer && (
                <Link
                  href="/cart"
                  aria-label="Cart"
                  className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <ShoppingCart size={20} />
                  {items.length > 0 && (
                    <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-navy-950">
                      {items.length}
                    </span>
                  )}
                </Link>
              )}
              {buyer && (
                <NotificationBell
                  notifications={buyerNotifications.notifications}
                  onMarkRead={buyerNotifications.markRead}
                  onMarkAllRead={buyerNotifications.markAllRead}
                />
              )}
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <Menu size={22} />
              </button>
            </div>
          )}
        </div>

        {/* Desktop (>=768px): full horizontal navbar, everything inline. */}
        <div className="hidden flex-1 items-center gap-4 md:flex">
          <Link href="/" className="shrink-0">
            <Logo src="/crdunion.png" />
          </Link>
          {showBrowseControls && <SearchBar className="max-w-md flex-1" />}
          <div className="ml-auto flex items-center gap-1">
            {isAdmin ? (
              <>
                <Link
                  href="/"
                  className="rounded-lg px-3 py-2 text-sm font-medium text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  View Marketplace
                </Link>
                <NotificationBell
                  notifications={adminNotifications.notifications}
                  onOpen={adminNotifications.refetch}
                  onMarkRead={adminNotifications.markRead}
                  onMarkAllRead={adminNotifications.markAllRead}
                />
              </>
            ) : isAuthPage ? null : (
              // Stays mounted (not conditionally removed) while `pending` is
              // true so it keeps reserving its layout width - unmounting it
              // here would free up flex space that SearchBar's flex-1
              // immediately expands into. `invisible` hides the stale
              // content without touching layout; see NavPendingProvider.
              // markPending only fires below when signed out - a signed-in
              // click never redirects (no auth gate to bounce through), so
              // there's nothing stale to hide and the group should never
              // flicker for the common logged-in case.
              <div className={cn("flex items-center gap-1", pending && "invisible")}>
                <Link
                  href="/marketplace"
                  onClick={buyer ? undefined : markPending}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <LayoutGrid size={18} />
                  Marketplace
                </Link>
                <CartNavLink />
                <MyDibsNavLink />
                <AccountNavLink />
                <NotificationBell
                  notifications={buyerNotifications.notifications}
                  onMarkRead={buyerNotifications.markRead}
                  onMarkAllRead={buyerNotifications.markAllRead}
                />
                {adminSession.isAdmin && (
                  <Link
                    href="/admin"
                    title="Back to Admin Dashboard"
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-gold transition-colors hover:bg-gold/10"
                  >
                    <LayoutDashboard size={18} />
                    Admin
                  </Link>
                )}
              </div>
            )}
            <ThemeToggle />
          </div>
        </div>

        {showBrowseControls && (
          <div className="flex flex-wrap items-center gap-2">
            <CategoryFilters />
            <RarityFilter className="w-auto" />
            <PokemonTypeFilter className="w-auto" />
          </div>
        )}
        </div>
      </header>

      {/*
        Rendered outside <header>, not inside it: the header's backdrop-blur-md
        (backdrop-filter) makes it a new containing block for `position: fixed`
        descendants, same as `transform` would. A Drawer nested inside it had
        its "fixed inset-0" sized to the header's own small box instead of the
        viewport, squashing the drawer into a sliver that overlapped the page
        instead of covering it.
      */}
      {!isAuthPage &&
        (isAdmin ? (
          <AdminMobileNavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} session={adminSession} />
        ) : (
          <MobileNavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} isAdmin={adminSession.isAdmin} />
        ))}
    </>
  );
}
