"use client";

import Link from "next/link";
import { LayoutGrid, ListChecks, LogOut, UserCircle } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
import { logout } from "@/app/account/actions";

const NAV_ITEMS = [
  { href: "/marketplace", label: "Marketplace", icon: LayoutGrid },
  { href: "/account/dibs", label: "My Dibs Queue", icon: ListChecks },
  { href: "/account", label: "Account / Profile Settings", icon: UserCircle },
];

/** Buyer-facing mobile drawer content - primary navigation only. Cart and Notifications stay as header icons on mobile (same as desktop), not duplicated here. */
export function MobileNavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { buyer } = useBuyerIdentity();

  return (
    <Drawer open={open} onClose={onClose} title="Menu">
      <div className="flex items-center justify-between gap-3 border-b border-card-border p-4">
        {buyer ? (
          <div className="flex min-w-0 items-center gap-3">
            {/* Buyers have no avatarUrl field today - initial-letter fallback, same idea as the seller-avatar fallback elsewhere in the app. */}
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-navy-950 text-lg font-semibold text-gold">
              {buyer.handle.replace("@", "").charAt(0).toUpperCase() || "?"}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{buyer.handle}</p>
              <p className="truncate text-xs text-foreground-muted">{buyer.fullName}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm font-semibold text-foreground">Menu</p>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={onClose}
            className="flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5"
          >
            <Icon size={20} className="shrink-0 text-foreground-muted" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center justify-between gap-3 border-t border-card-border p-4">
        <ThemeToggle />
        {buyer && (
          <form action={logout}>
            <button
              type="submit"
              className="flex h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <LogOut size={18} />
              Log Out
            </button>
          </form>
        )}
      </div>
    </Drawer>
  );
}
