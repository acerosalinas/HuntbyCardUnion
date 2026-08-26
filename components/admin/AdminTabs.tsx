"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { logout } from "@/app/admin/actions";

const baseTabs = [
  { href: "/admin", label: "Pending Payments" },
  { href: "/admin/offers", label: "Incoming Offers" },
  { href: "/admin/inventory", label: "Inventory Manager" },
  { href: "/admin/wanted", label: "Wanted Cards" },
  { href: "/admin/logs", label: "Sales Log" },
  { href: "/admin/disputes", label: "Disputes" },
  { href: "/admin/profile", label: "My Profile" },
];

export function AdminTabs({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const pathname = usePathname();
  const tabs = isSuperAdmin ? [...baseTabs, { href: "/admin/manage", label: "Manage Admins" }] : baseTabs;

  return (
    <div className="mb-6 flex items-center justify-between gap-2 border-b border-card-border">
      <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          // Disputes has a nested [id] detail route, so it needs prefix
          // matching to stay highlighted there - "/admin" itself must stay
          // an exact match, or it'd match every other tab's path too.
          const active = tab.href === "/admin" ? pathname === "/admin" : pathname?.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
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
          className="mb-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground sm:px-3"
        >
          <LogOut size={14} />
          <span className="hidden sm:inline">Sign Out</span>
        </button>
      </form>
    </div>
  );
}
