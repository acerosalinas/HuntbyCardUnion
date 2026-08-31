import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendSellerNotificationEmail } from "@/lib/email";

/**
 * The notification types that also warrant an email, on top of the in-app
 * bell - a seller isn't always watching the dashboard. Deliberately narrow:
 * every other notification type (offer_accepted, dispute_*, etc.) already
 * has its own more specific in-app treatment and would just be noise here.
 */
const EMAIL_WORTHY_TYPES = new Set(["offer_received", "card_claimed"]);

interface NotificationWebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: {
    recipient_id: string;
    type: string;
    title: string;
    body: string | null;
    link: string | null;
  } | null;
}

/**
 * Receives a Supabase Database Webhook fired on every INSERT into the
 * `notifications` table, and emails the recipient for the couple of types
 * sellers most need a push on (a new offer, a new order). Exists because
 * submit_offer/place_order (supabase/schema.sql) run as direct client-side
 * RPCs - there's no Next.js server in that request to call Resend from
 * directly, so the database has to call back out to this endpoint instead.
 *
 * Configure once in the Supabase Dashboard: Database -> Webhooks -> Create
 * a new hook -> table "notifications", event "Insert", type "HTTP Request",
 * URL "https://cardunion.online/api/webhooks/notifications", method POST,
 * with an "x-webhook-secret" header set to WEBHOOK_SHARED_SECRET below.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-webhook-secret");
  if (!secret || secret !== process.env.SUPABASE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: NotificationWebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const record = payload.record;
  if (!record || !EMAIL_WORTHY_TYPES.has(record.type)) {
    return NextResponse.json({ skipped: true });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.auth.admin.getUserById(record.recipient_id);
  const email = data?.user?.email;

  if (error || !email) {
    console.error("notifications webhook: couldn't resolve recipient email:", error);
    return NextResponse.json({ skipped: true });
  }

  await sendSellerNotificationEmail({
    to: email,
    title: record.title,
    body: record.body ?? record.title,
    link: record.link ?? "/admin",
  });

  return NextResponse.json({ sent: true });
}
