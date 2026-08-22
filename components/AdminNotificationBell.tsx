"use client";

import { useEffect, useRef, useState } from "react";
import { NotificationBell } from "@/components/NotificationBell";
import { getMyNotifications, markAllNotificationsRead, markNotificationRead } from "@/app/admin/actions";
import { AppNotification } from "@/types/marketplace";

const POLL_INTERVAL_MS = 15_000;

/**
 * Admin-side notification bell - polls a Server Action rather than
 * subscribing to Realtime. Admin has zero client-side Supabase usage
 * anywhere else in the app (everything goes through Server Actions with the
 * service-role client); a live bell would mean standing up a whole new
 * admin-cookie-scoped browser client just to authenticate a websocket. This
 * stays consistent with the rest of the admin UI, which already relies on
 * full revalidate-and-reload after actions rather than being "live".
 */
export function AdminNotificationBell() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const mountedRef = useRef(true);

  const refetch = () => {
    getMyNotifications()
      .then((data) => {
        if (mountedRef.current) setNotifications(data);
      })
      .catch((err) => console.error("Failed to load notifications:", err));
  };

  useEffect(() => {
    mountedRef.current = true;
    refetch();
    const interval = setInterval(refetch, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  const markRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: Date.now() } : n)));
    markNotificationRead(id).catch((err) => console.error("Failed to mark notification read:", err));
  };

  const markAllRead = () => {
    const now = Date.now();
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
    markAllNotificationsRead().catch((err) => console.error("Failed to mark notifications read:", err));
  };

  return (
    <NotificationBell notifications={notifications} onOpen={refetch} onMarkRead={markRead} onMarkAllRead={markAllRead} />
  );
}
