import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { roleFromMetadata } from "@/lib/adminAuth";
import { parseNotifyEmails } from "@/lib/wishlistText";

/**
 * Who hears about a hearted listing: only the seller whose listing it is (bell + their notification inbox, or the address they sign in with).
 * A listing's wishlist alert never goes to the shop-wide list or to other stores. A listing with no owner alerts nobody.
 */
export async function sellerWishlistRecipients(db: ReturnType<typeof createAdminClient>, sellerAdminId: string | null): Promise<{ emails: string[]; adminIds: string[] }> {
  if (!sellerAdminId) return { emails: [], adminIds: [] };
  const [{ data: user }, { data: chosen }] = await Promise.all([
    db.auth.admin.getUserById(sellerAdminId),
    db.from("admin_settings").select("notification_email").eq("admin_id", sellerAdminId).maybeSingle(),
  ]);
  const email = ((chosen?.notification_email as string | null | undefined) || user?.user?.email || "").trim().toLowerCase();
  return { emails: email.includes("@") ? [email] : [], adminIds: user?.user ? [sellerAdminId] : [] };
}

/** The addresses to email, and the matching admin accounts to send an in-app (bell) notification to. */
export async function wishlistRecipients(db: ReturnType<typeof createAdminClient>): Promise<{ emails: string[]; adminIds: string[] }> {
  const emails = parseNotifyEmails(process.env.WISHLIST_NOTIFY_EMAILS);
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const adminIds = (data?.users ?? [])
    .filter((u) => u.email && emails.includes(u.email.toLowerCase()) && roleFromMetadata(u.app_metadata) !== null)
    .map((u) => u.id);
  return { emails, adminIds };
}
