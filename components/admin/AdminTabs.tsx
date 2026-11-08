"use client";

import { useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Select } from "@/components/ui/Select";
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
  const router = useRouter();
  const navRef = useRef<HTMLElement>(null);

  const withTracker = showTracker ? [...baseTabs, { href: "/tracker", label: "Live Tracker" }] : baseTabs;
  const tabs = isSuperAdmin
    ? [...withTracker, { href: "/admin/live-sales", label: "Live Sales" }, { href: "/admin/manage", label: "Manage Admins" }]
    : withTracker;

  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : Boolean(pathname?.startsWith(href)));
  const current = tabs.find((tab) => isActive(tab.href));

  return (
    <div className="mb-6 flex items-start justify-between gap-2 border-b border-card-border pb-2">
      {/* Phone: one dropdown instead of a strip you have to swipe through. */}
      <div className="min-w-0 flex-1 sm:hidden">
        <label htmlFor="admin-section" className="sr-only">
          Admin section
        </label>
        <Select id="admin-section" value={current?.href ?? ""} onChange={(e) => router.push(e.target.value)}>
          {!current && <option value="">Choose a section</option>}
          {tabs.map((tab) => (
            <option key={tab.href} value={tab.href}>
              {tab.label}
            </option>
          ))}
        </Select>
      </div>

      {/* Desktop: every tab visible, wrapping onto a second row instead of scrolling sideways. */}
      <nav ref={navRef} aria-label="Admin sections" className="hidden min-w-0 flex-1 flex-wrap gap-1 sm:flex">
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-gold/15 text-foreground ring-1 ring-gold/60" : "text-foreground-muted hover:bg-foreground/5 hover:text-foreground",
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
