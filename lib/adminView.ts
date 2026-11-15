import "server-only";
import { cookies } from "next/headers";

/** Name of the cookie that remembers whether a Super Admin is looking at every store or only their own. */
export const ADMIN_VIEW_COOKIE = "admin_view";

/**
 * True only for a Super Admin who has switched the dashboard to "All stores".
 * Everyone else - every normal admin, and a Super Admin by default - sees just their own store's payments, offers, sales and wishlist hearts,
 * so alerts and lists from other stores never land in front of them unasked.
 */
export async function seesAllStores(admin: { role: string }): Promise<boolean> {
  if (admin.role !== "SUPER_ADMIN") return false;
  return (await cookies()).get(ADMIN_VIEW_COOKIE)?.value === "all";
}
