import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { NotificationType } from "@/types/marketplace";

interface NotifyUserParams {
  recipientId: string | null;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}

/**
 * Inserts an in-app notification for a buyer or admin recipient. No-ops
 * silently if `recipientId` is null (e.g. a historical claim with no linked
 * account) and never throws - a failed notification must never fail the
 * mutation it's attached to, same principle as notifyBuyerPaymentConfirmed
 * in app/admin/actions.ts. Called from Server Actions only; the equivalent
 * for security-definer RPCs is a raw `insert into notifications` inline in
 * supabase/schema.sql, since RPCs can't call TypeScript.
 */
export async function notifyUser(
  supabase: ReturnType<typeof createAdminClient>,
  { recipientId, type, title, body, link }: NotifyUserParams,
) {
  if (!recipientId) return;
  try {
    const { error } = await supabase.from("notifications").insert({
      recipient_id: recipientId,
      type,
      title,
      body: body ?? null,
      link: link ?? null,
    });
    if (error) throw error;
  } catch (err) {
    console.error("Failed to create notification:", err);
  }
}
