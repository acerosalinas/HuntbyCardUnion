import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail } from "@/lib/accessGate";

/** Whether an admin removed an account with this email. False if the list is not set up yet (migration not run). */
export async function isEmailRemoved(email: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().from("removed_users").select("email").eq("email", normalizeEmail(email)).maybeSingle();
    return !error && Boolean(data);
  } catch {
    return false;
  }
}
