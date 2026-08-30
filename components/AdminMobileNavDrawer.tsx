"use client";

import Link from "next/link";
import { LayoutGrid, LogOut } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AdminSession } from "@/hooks/useAdminSession";
import { logout } from "@/app/admin/actions";

const ROLE_LABEL: Record<NonNullable<AdminSession["role"]>, string> = {
  ADMIN: "Admin",
  SUPER_ADMIN: "Super Admin",
};

/** Admin-facing mobile drawer content - deliberately minimal. Admin's own section-to-section navigation already lives in AdminTabs (the horizontal scroll strip under the header on /admin/* pages) - this is just the "leave the dashboard" / account-level actions. */
export function AdminMobileNavDrawer({
  open,
  onClose,
  session,
}: {
  open: boolean;
  onClose: () => void;
  session: AdminSession;
}) {
  return (
    <Drawer open={open} onClose={onClose} title="Menu">
      <div className="flex items-center gap-3 border-b border-card-border p-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-navy-950 text-lg font-semibold text-gold">
          {(session.email ?? "?").charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{session.email ?? "Admin"}</p>
          <p className="truncate text-xs text-foreground-muted">{session.role ? ROLE_LABEL[session.role] : ""}</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        <Link
          href="/"
          onClick={onClose}
          className="flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5"
        >
          <LayoutGrid size={20} className="shrink-0 text-foreground-muted" />
          View Marketplace
        </Link>
      </nav>

      <div className="flex items-center justify-between gap-3 border-t border-card-border p-4">
        <ThemeToggle />
        <form action={logout}>
          <button
            type="submit"
            className="flex h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <LogOut size={18} />
            Log Out
          </button>
        </form>
      </div>
    </Drawer>
  );
}
