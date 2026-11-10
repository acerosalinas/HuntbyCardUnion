"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";
import { parseNotificationEmail } from "@/lib/emailAddress";
import { sendNotificationEmail } from "@/lib/email";
import { extractErrorMessage } from "@/lib/utils";

const MISSING = /admin_settings|schema cache|does not exist/i;
const SETUP_HINT = "Run supabase/migration_admin_notification_email.sql in the Supabase SQL editor first.";

/** The signed-in admin's own settings: the address they sign in with, and the inbox they chose for notification emails (null = the sign-in address). */
export async function getMyNotificationEmail(): Promise<{ loginEmail: string; notificationEmail: string | null; setUp: boolean }> {
  const admin = await requireAdmin();
  const { data, error } = await createAdminClient().from("admin_settings").select("notification_email").eq("admin_id", admin.id).maybeSingle();
  if (error && !MISSING.test(error.message)) throw new Error(error.message);
  return { loginEmail: admin.email, notificationEmail: (data?.notification_email as string | null | undefined) ?? null, setUp: !error };
}

/** Saves where this admin's notification emails go. Empty = back to the sign-in address. Never changes the sign-in address. Returns the reason on failure (a thrown message is hidden in production). */
export async function saveNotificationEmail(raw: string): Promise<{ error?: string; email?: string | null }> {
  try {
    const admin = await requireAdmin();
    const parsed = parseNotificationEmail(raw);
    if (parsed.error) return { error: parsed.error };
    const { error } = await createAdminClient()
      .from("admin_settings")
      .upsert({ admin_id: admin.id, notification_email: parsed.email, updated_at: new Date().toISOString() }, { onConflict: "admin_id" });
    if (error) return { error: MISSING.test(error.message) ? SETUP_HINT : error.message };
    revalidatePath("/admin/profile");
    return { email: parsed.email };
  } catch (err) {
    console.error("[saveNotificationEmail]", err);
    return { error: extractErrorMessage(err) ?? "Couldn't save the email." };
  }
}

/** Sends one sample notification to wherever this admin's emails currently go, so they can see it arrive. */
export async function sendTestNotificationEmail(): Promise<{ error?: string; sentTo?: string }> {
  try {
    const admin = await requireAdmin();
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) return { error: "Email sending isn't set up on this site yet." };
    const { notificationEmail } = await getMyNotificationEmail();
    const to = notificationEmail ?? admin.email;
    await sendNotificationEmail({ to, title: "Test notification from Hunt by Card Union", body: "This is a test. Your shop notifications will arrive at this address.", link: "/admin" });
    return { sentTo: to };
  } catch (err) {
    console.error("[sendTestNotificationEmail]", err);
    return { error: extractErrorMessage(err) ?? "Couldn't send the test email." };
  }
}
