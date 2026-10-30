import "server-only";
import { Resend } from "resend";
import { formatCurrency } from "@/lib/utils";
import { escapeHtml } from "@/lib/wishlistText";

export interface OrderConfirmedItem {
  title: string;
  price: number;
}

interface SendOrderConfirmedEmailInput {
  to: string;
  buyerName: string;
  items: OrderConfirmedItem[];
  total: number;
  orderId: string | null;
}

/**
 * Emails a buyer once admin has confirmed payment for an order (or a single
 * card, when it wasn't part of a cart checkout). Never throws - a failed
 * send must not block or appear to fail the actual payment confirmation;
 * callers should just log and move on.
 */
export async function sendOrderConfirmedEmail({
  to,
  buyerName,
  items,
  total,
  orderId,
}: SendOrderConfirmedEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.warn("RESEND_API_KEY/RESEND_FROM_EMAIL not configured - skipping order confirmation email.");
    return;
  }

  const resend = new Resend(apiKey);
  const itemLines = items.map((item) => `<li>${item.title} — ${formatCurrency(item.price)}</li>`).join("");
  const subject = items.length > 1 ? "Your Card Union order is confirmed" : "Your Card Union payment is confirmed";

  try {
    // Resend reports API problems (bad key, unverified domain, quota, paused account) as a RETURNED error,
    // not a thrown one - so it has to be checked or a failed send looks like a success.
    const { error } = await resend.emails.send({
      from,
      to,
      subject,
      html: `
        <p>Hi ${buyerName},</p>
        <p>Your payment has been confirmed for:</p>
        <ul>${itemLines}</ul>
        <p><strong>Total: ${formatCurrency(total)}</strong></p>
        ${orderId ? `<p style="color:#888;font-size:12px;">Order #${orderId.slice(0, 8)}</p>` : ""}
        <p>Thanks for shopping with Card Union!</p>
      `,
    });
    if (error) console.error(`Resend rejected the order confirmation email (${error.name}): ${error.message}`);
  } catch (err) {
    console.error("Failed to send order confirmation email:", err);
  }
}

interface SendNotificationEmailInput {
  to: string;
  title: string;
  body: string;
  /** Path within the app, e.g. "/admin/offers" - turned into an absolute link using NEXT_PUBLIC_SITE_URL. */
  link: string;
}

/**
 * Emails whoever a `notifications` row's recipient is - a buyer (offer
 * accepted/countered/declined/expired) or an admin/seller (new offer, new
 * order, buyer responded to a counter) - the in-app bell already covers all
 * of these, but nobody's watching the dashboard every minute. Triggered by a
 * Supabase Database Webhook on inserts into the `notifications` table (see
 * app/api/webhooks/notifications/route.ts) rather than called directly,
 * since submit_offer/place_order/respond_to_offer run as client-side RPCs
 * with no Next.js server involved in that request - only EMAIL_WORTHY_TYPES
 * there actually reach this. Never throws, same reasoning as
 * sendOrderConfirmedEmail.
 */
export async function sendNotificationEmail({ to, title, body, link }: SendNotificationEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.warn("RESEND_API_KEY/RESEND_FROM_EMAIL not configured - skipping notification email.");
    return;
  }

  const resend = new Resend(apiKey);
  // Hardcoded, not resolveOrigin() (lib/origin.ts) - that reads the incoming
  // request's Host header, which for this route is Supabase's webhook
  // caller, not a real visitor's browser. There's only one production
  // domain this could ever point at.
  const siteUrl = "https://cardunion.online";

  try {
    // See sendOrderConfirmedEmail: Resend returns API errors rather than throwing them.
    const { error } = await resend.emails.send({
      from,
      to,
      subject: title,
      html: `
        <p>${body}</p>
        <p><a href="${siteUrl}${link}">View it on Card Union</a></p>
      `,
    });
    if (error) console.error(`Resend rejected the notification email (${error.name}): ${error.message}`);
  } catch (err) {
    console.error("Failed to send notification email:", err);
  }
}

interface SendWishlistAdminEmailInput {
  to: string[];
  title: string;
  body: string;
  /** Path within the app, e.g. "/admin/wanted". */
  link: string;
}

/** Tells the admin(s) a buyer added a wishlist entry. Buyer-typed text is HTML-escaped. Never throws. */
export async function sendWishlistAdminEmail({ to, title, body, link }: SendWishlistAdminEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.warn("RESEND_API_KEY/RESEND_FROM_EMAIL not configured - skipping wishlist alert email.");
    return;
  }
  if (to.length === 0) return;

  const resend = new Resend(apiKey);
  const siteUrl = "https://cardunion.online";
  try {
    const { error } = await resend.emails.send({
      from,
      to,
      subject: title,
      html: `
        <p>${escapeHtml(body)}</p>
        <p><a href="${siteUrl}${link}">See it in the admin Wanted tab</a></p>
      `,
    });
    if (error) console.error(`Resend rejected the wishlist alert email (${error.name}): ${error.message}`);
  } catch (err) {
    console.error("Failed to send wishlist alert email:", err);
  }
}

export interface InvoiceReadyEmail {
  to: string;
  name: string;
  liveTitle: string;
  cards: { name: string; amount: number }[];
  total: number;
  paid: number;
}

/**
 * "Your invoice is ready" emails, one per customer, sent through Resend's batch endpoint (up to 100 per
 * request, so a big live doesn't hit the per-second limit). Each customer gets their own email - addresses
 * are never shown to each other. Customer-typed text is HTML-escaped. Never throws; returns how many were sent.
 */
export async function sendInvoiceReadyEmails(items: InvoiceReadyEmail[]): Promise<number> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.warn("RESEND_API_KEY/RESEND_FROM_EMAIL not configured - skipping invoice emails.");
    return 0;
  }
  if (items.length === 0) return 0;

  const resend = new Resend(apiKey);
  const siteUrl = "https://cardunion.online";
  const messages = items.map((i) => {
    const left = Math.round((i.total - i.paid) * 100) / 100;
    const shown = i.cards.slice(0, 20);
    const more = i.cards.length - shown.length;
    return {
      from,
      to: [i.to],
      subject: `Your invoice for ${i.liveTitle} is ready`,
      html: `
        <p>Hi ${escapeHtml(i.name)},</p>
        <p>Your invoice for <strong>${escapeHtml(i.liveTitle)}</strong> is ready:</p>
        <ul>${shown.map((c) => `<li>${escapeHtml(c.name)} - ${formatCurrency(c.amount)}</li>`).join("")}${more > 0 ? `<li>and ${more} more</li>` : ""}</ul>
        <p><strong>Total: ${formatCurrency(i.total)}</strong>${i.paid > 0 ? ` &middot; paid so far ${formatCurrency(i.paid)} &middot; <strong>${formatCurrency(left)} left</strong>` : ""}</p>
        <p><a href="${siteUrl}/account/orders">Open My Live Orders</a> to see everything and send your payment.</p>
      `,
    };
  });

  let sent = 0;
  for (let start = 0; start < messages.length; start += 100) {
    const chunk = messages.slice(start, start + 100);
    try {
      const { error } = await resend.batch.send(chunk);
      if (error) console.error(`Resend rejected the invoice emails (${error.name}): ${error.message}`);
      else sent += chunk.length;
    } catch (err) {
      console.error("Failed to send invoice emails:", err);
    }
  }
  return sent;
}
