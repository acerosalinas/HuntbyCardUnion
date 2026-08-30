"use client";

import { NotificationBell } from "@/components/NotificationBell";
import { useBuyerNotifications } from "@/hooks/useBuyerNotifications";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";

/**
 * Buyer-side notification bell - thin wrapper around useBuyerNotifications
 * (the actual Realtime subscription) for any call site that just wants a
 * single self-contained bell. Navbar.tsx calls the hook directly instead,
 * since it needs to render the bell UI in two places (mobile + desktop
 * rows) without opening two competing Realtime subscriptions.
 */
export function BuyerNotificationBell() {
  const { buyer } = useBuyerIdentity();
  const { notifications, markRead, markAllRead } = useBuyerNotifications();

  if (!buyer) return null;

  return <NotificationBell notifications={notifications} onMarkRead={markRead} onMarkAllRead={markAllRead} />;
}
