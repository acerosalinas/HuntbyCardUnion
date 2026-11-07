"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { logout } from "@/app/admin/accountActions";

const baseTabs = [
  { href: "/admin", label: "Pending Payments" },
  { href: "/admin/offers", label: "Incoming Offers" },
  { href: "/admin/inventory", label: "Inventory Manager" },
  { href: "/admin/wanted", label: "Wanted Cards" },
  { href: "/admin/logs", label: "Sales Log" },
  { href: "/admin/disputes", label: "Disputes" },
  { href: "/admin/profile", label: "My Profile" },
];

export function AdminTabs({ isSuperAdmin, showTracker = false }: { isSuperAdmin: boolean; showTracker?: boolean }) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);

  // Ten tabs overflow a phone screen: bring the current one into view after
  // navigating so you never land on a page whose tab is off-screen.
  useEffect(() => {
    const current = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [pathname]);

  const withTracker = showTracker ? [...baseTabs, { href: "/tracker", label: "Live Tracker" }] : baseTabs;
  const tabs = isSuperAdmin
    ? [...withTracker, { href: "/admin/live-sales", label: "Live Sales" }, { href: "/admin/manage", label: "Manage Admins" }]
    : withTracker;

  return (
    <div className="mb-6 flex items-center justify-between gap-2 border-b border-card-border">
      <nav
        ref={navRef}
        aria-label="Admin sections"
        className="flex min-w-0 flex-1 gap-1 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] pr-8 sm:[mask-image:none] sm:pr-0"
      >
        {tabs.map((tab) => {
          // Disputes has a nested [id] detail route, so it needs prefix
          // matching to stay highlighted there - "/admin" itself must stay
          // an exact match, or it'd match every other tab's path too.
          const active = tab.href === "/admin" ? pathname === "/admin" : pathname?.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 whitespace-nowrap border-b-2 px-2.5 py-3 text-sm font-medium transition-colors",
                active
                  ? "border-gold text-foreground"
                  : "border-transparent text-foreground-muted hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <form action={logout} className="shrink-0">
        <button
          type="submit"
          className="mb-1.5 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground sm:px-3"
        >
          <LogOut size={14} aria-hidden="true" />
          <span className="hidden 2xl:inline">Sign Out</span>
          <span className="sr-only 2xl:hidden">Sign Out</span>
        </button>
      </form>
    </div>
  );
}
