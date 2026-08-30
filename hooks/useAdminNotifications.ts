"use client";

import { useEffect, useRef, useState } from "react";
import { getMyNotifications, markAllNotificationsRead, markNotificationRead } from "@/app/admin/actions";
import { AppNotification } from "@/types/marketplace";

const POLL_INTERVAL_MS = 15_000;

export interface AdminNotificationsState {
  notifications: AppNotification[];
  refetch: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

/**
 * Polls a Server Action rather than subscribing to Realtime - see
 * AdminNotificationBell.tsx for why. Extracted out of that component so the
 * header can call this ONCE and render the bell UI twice (mobile row +
 * desktop row, only one visible at a time via CSS) without each instance
 * running its own independent 15s poll timer.
 */
/**
 * @param enabled Gates the poll on/off without violating the rules of hooks
 * (Navbar calls this unconditionally on every page, but should only
 * actually poll getMyNotifications() - an admin-only Server Action - while
 * on an /admin/* route; polling it for a buyer browsing the marketplace
 * would just throw on every tick).
 */
export function useAdminNotifications(enabled: boolean = true): AdminNotificationsState {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const mountedRef = useRef(true);

  const refetch = () => {
    if (!enabled) return;
    getMyNotifications()
      .then((data) => {
        if (mountedRef.current) setNotifications(data);
      })
      .catch((err) => console.error("Failed to load notifications:", err));
  };

  useEffect(() => {
    if (!enabled) return;
    mountedRef.current = true;
    refetch();
    const interval = setInterval(refetch, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch is redefined every render but only ever needs to be (re)wired up once per enabled toggle, same as the original AdminNotificationBell
  }, [enabled]);

  const markRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: Date.now() } : n)));
    markNotificationRead(id).catch((err) => console.error("Failed to mark notification read:", err));
  };

  const markAllRead = () => {
    const now = Date.now();
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
    markAllNotificationsRead().catch((err) => console.error("Failed to mark notifications read:", err));
  };

  return { notifications, refetch, markRead, markAllRead };
}
