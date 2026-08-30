"use client";

import { useEffect, useState } from "react";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppNotification, NotificationRow, notificationFromRow } from "@/types/marketplace";

export interface BuyerNotificationsState {
  notifications: AppNotification[];
  markRead: (id: string) => void;
  markAllRead: () => void;
}

/**
 * Realtime-driven buyer notifications - extracted out of
 * BuyerNotificationBell.tsx so the header can call this ONCE and render the
 * bell UI twice (mobile row + desktop row, only one visible at a time via
 * CSS). Two separate component instances each independently subscribing to
 * the same `notifications-${buyerId}` Realtime channel is exactly what
 * broke the header after the mobile/desktop split - Supabase's client
 * throws ("cannot add postgres_changes callbacks... after subscribe()")
 * when a second subscription collides with the first, crashing the whole
 * page. One shared subscription here, fed into as many <NotificationBell>
 * instances as the layout needs.
 */
export function useBuyerNotifications(): BuyerNotificationsState {
  const { buyer } = useBuyerIdentity();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  useEffect(() => {
    if (!buyer || !isSupabaseConfigured()) return;
    const supabase = createClient();
    let cancelled = false;

    const refetch = () => {
      supabase
        .from("notifications")
        .select("*")
        .eq("recipient_id", buyer.id)
        .order("created_at", { ascending: false })
        .limit(20)
        .then(({ data }) => {
          if (cancelled) return;
          setNotifications(((data as NotificationRow[] | null) ?? []).map(notificationFromRow));
        });
    };

    refetch();

    const channel = supabase
      .channel(`notifications-${buyer.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${buyer.id}` },
        refetch,
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [buyer]);

  const markRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: Date.now() } : n)));
    createClient().from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).then();
  };

  const markAllRead = () => {
    if (!buyer) return;
    const now = Date.now();
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
    createClient()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", buyer.id)
      .is("read_at", null)
      .then();
  };

  return { notifications, markRead, markAllRead };
}
