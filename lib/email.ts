import "server-only";
import { Resend } from "resend";
import { formatCurrency } from "@/lib/utils";

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
    await resend.emails.send({
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
  } catch (err) {
    console.error("Failed to send order confirmation email:", err);
  }
}
