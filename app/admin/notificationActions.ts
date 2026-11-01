"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";
import { AppNotification, NotificationRow, notificationFromRow } from "@/types/marketplace";

/**
 * Admin's most recent notifications, polled client-side (AdminNotificationBell)
 * rather than pushed via Realtime - see lib/notify.ts / supabase/schema.sql
 * for how rows get created. Scoped to `.eq("recipient_id", admin.id)` even
 * though the service-role client could read any row, so one admin can never
 * see another's notifications.
 */
export async function getMyNotifications(): Promise<AppNotification[]> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("recipient_id", admin.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return ((data as NotificationRow[] | null) ?? []).map(notificationFromRow);
}

export async function markNotificationRead(notificationId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("recipient_id", admin.id);
  if (error) throw new Error(error.message);
}

export async function markAllNotificationsRead() {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", admin.id)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}
