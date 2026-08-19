"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { Logo } from "@/components/Logo";
import { SearchBar } from "@/components/SearchBar";
import { CategoryFilters } from "@/components/CategoryFilters";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CartNavLink } from "@/components/CartNavLink";
import { AccountNavLink } from "@/components/AccountNavLink";

const AUTH_PATH_PREFIXES = ["/account/login", "/account/signup", "/account/check-email", "/account/complete-profile"];

export function Navbar() {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin");
  const isLanding = pathname === "/";
  const isAuthPage = AUTH_PATH_PREFIXES.some((p) => pathname?.startsWith(p));
  const showBrowseControls = !isAdmin && !isLanding && !isAuthPage;

  return (
    <header className="sticky top-0 z-40 border-b border-card-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2 sm:gap-4">
          <Link href="/" className="shrink-0">
            <Logo src="/crdunion.png" />
          </Link>
          {showBrowseControls && <SearchBar className="hidden flex-1 md:block" />}
          <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
            {isAdmin ? (
              <Link
                href="/"
                className="rounded-lg px-2 py-2 text-sm font-medium text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground sm:px-3"
              >
                <span className="sm:hidden">Marketplace</span>
                <span className="hidden sm:inline">View Marketplace</span>
              </Link>
            ) : isAuthPage ? null : (
              <>
                <Link
                  href="/marketplace"
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground sm:px-3"
                >
                  <LayoutGrid size={18} />
                  <span className="hidden sm:inline">Marketplace</span>
                </Link>
                <CartNavLink />
                <AccountNavLink />
              </>
            )}
            <ThemeToggle />
          </div>
        </div>
        {showBrowseControls && (
          <>
            <SearchBar className="md:hidden" />
            <CategoryFilters />
          </>
        )}
      </div>
    </header>
  );
}
