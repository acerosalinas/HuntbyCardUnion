"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { AppNotification } from "@/types/marketplace";

interface NotificationBellProps {
  notifications: AppNotification[];
  /** Fired every time the panel is opened - lets the caller refresh the list on demand. */
  onOpen?: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}

/**
 * Presentational bell + dropdown, shared by both the buyer and admin nav -
 * see BuyerNotificationBell (Realtime) and AdminNotificationBell (polling)
 * for how each role actually sources `notifications`. No popover library in
 * this repo, so the panel is a plain absolutely-positioned div closed via a
 * click-outside listener, matching how the rest of components/ui is built.
 */
export function NotificationBell({ notifications, onOpen, onMarkRead, onMarkAllRead }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const unreadCount = notifications.filter((n) => !n.readAt).length;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) onOpen?.();
      return next;
    });
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={toggle}
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-navy-950">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b border-card-border px-4 py-2.5">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            {unreadCount > 0 && (
              <button type="button" onClick={onMarkAllRead} className="text-xs font-medium text-gold hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-foreground-muted">No notifications yet.</p>
            ) : (
              notifications.map((n) => (
                <Link
                  key={n.id}
                  href={n.link ?? "#"}
                  onClick={() => {
                    if (!n.readAt) onMarkRead(n.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "block border-l-2 px-4 py-3 text-sm transition-colors hover:bg-foreground/5",
                    n.readAt ? "border-transparent" : "border-gold bg-gold/5",
                  )}
                >
                  <p className={cn("font-medium", n.readAt ? "text-foreground-muted" : "text-foreground")}>
                    {n.title}
                  </p>
                  {n.body && <p className="mt-0.5 text-xs text-foreground-muted">{n.body}</p>}
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-foreground-muted/70">
                    {formatRelativeTime(n.createdAt)}
                  </p>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
