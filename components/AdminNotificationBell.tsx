"use client";

import { NotificationBell } from "@/components/NotificationBell";
import { useAdminNotifications } from "@/hooks/useAdminNotifications";

/**
 * Admin-side notification bell - thin wrapper around useAdminNotifications
 * (the actual poll timer) for any call site that just wants a single
 * self-contained bell. Navbar.tsx calls the hook directly instead, since it
 * needs to render the bell UI in two places (mobile + desktop rows)
 * without running two competing 15s poll timers.
 */
export function AdminNotificationBell() {
  const { notifications, refetch, markRead, markAllRead } = useAdminNotifications();

  return (
    <NotificationBell notifications={notifications} onOpen={refetch} onMarkRead={markRead} onMarkAllRead={markAllRead} />
  );
}
