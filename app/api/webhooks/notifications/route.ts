import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";

/**
 * The notification types that also warrant an email, on top of the in-app
 * bell - not everyone is watching the dashboard when this happens. Covers
 * both directions of the offer negotiation (each type fires for whichever
 * side needs to act or just hear the outcome - see acceptOffer/counterOffer/
 * declineOffer in app/admin/actions.ts for the admin-acts-on-buyer's-offer
 * direction, and respond_to_offer/expire_stale_offers in supabase/schema.sql
 * for the buyer-acts-on-a-counter and 24h-no-response directions) - the
 * webhook doesn't care which table code path inserted the row, only that it
 * did. Deliberately still leaves out dispute_*, ship_requested, etc. - those
 * already have their own more specific in-app treatment and would just be
 * noise here.
 */
const EMAIL_WORTHY_TYPES = new Set([
  "offer_received",
  "card_claimed",
  "offer_accepted",
  "offer_countered",
  "offer_declined",
  "offer_expired",
]);

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
 * `notifications` table, and emails whichever buyer or admin the row is
 * for, if its type is in EMAIL_WORTHY_TYPES. Exists because submit_offer/
 * place_order/respond_to_offer (supabase/schema.sql) run as direct
 * client-side RPCs - there's no Next.js server in that request to call
 * Resend from directly, so the database has to call back out to this
 * endpoint instead.
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

  await sendNotificationEmail({
    to: email,
    title: record.title,
    body: record.body ?? record.title,
    // "/" not "/admin" - this fallback only matters if link is ever
    // unexpectedly null, and unlike the other fields here, recipient could
    // be a buyer, for whom an admin-only path would be a dead link.
    link: record.link ?? "/",
  });

  return NextResponse.json({ sent: true });
}
