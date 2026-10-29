import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { roleFromMetadata } from "@/lib/adminAuth";
import { parseNotifyEmails } from "@/lib/wishlistText";

/** The addresses to email, and the matching admin accounts to send an in-app (bell) notification to. */
export async function wishlistRecipients(db: ReturnType<typeof createAdminClient>): Promise<{ emails: string[]; adminIds: string[] }> {
  const emails = parseNotifyEmails(process.env.WISHLIST_NOTIFY_EMAILS);
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const adminIds = (data?.users ?? [])
    .filter((u) => u.email && emails.includes(u.email.toLowerCase()) && roleFromMetadata(u.app_metadata) !== null)
    .map((u) => u.id);
  return { emails, adminIds };
}
