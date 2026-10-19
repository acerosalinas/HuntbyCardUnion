import "server-only";
import { redirect } from "next/navigation";
import { CurrentAdmin, getCurrentAdmin, requireAdmin } from "@/lib/adminAuth";
import { canUseTracker } from "./accessList";

/** For Server Actions: throws unless the caller may use the tracker. */
export async function requireTrackerAdmin(): Promise<CurrentAdmin> {
  const admin = await requireAdmin();
  if (!canUseTracker(admin)) throw new Error("The Live Tracker isn't available for your account.");
  return admin;
}

/** For pages/layouts: sends anyone else away instead of throwing. */
export async function requireTrackerAdminOrRedirect(): Promise<CurrentAdmin> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/account/login?from=/tracker");
  if (!canUseTracker(admin)) redirect("/admin");
  return admin;
}
