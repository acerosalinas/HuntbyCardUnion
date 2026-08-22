"use client";

import { useEffect, useState } from "react";
import { NotificationBell } from "@/components/NotificationBell";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppNotification, NotificationRow, notificationFromRow } from "@/types/marketplace";

/** Buyer-side notification bell - Realtime-driven, same shape as hooks/useCardQueue.ts. */
export function BuyerNotificationBell() {
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

  if (!buyer) return null;

  const markRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: Date.now() } : n)));
    createClient()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .then();
  };

  const markAllRead = () => {
    const now = Date.now();
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
    createClient()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", buyer.id)
      .is("read_at", null)
      .then();
  };

  return <NotificationBell notifications={notifications} onMarkRead={markRead} onMarkAllRead={markAllRead} />;
}
