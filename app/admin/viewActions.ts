"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/adminAuth";
import { ADMIN_VIEW_COOKIE } from "@/lib/adminView";

/** Super Admin only: show the dashboard for just their own store (the default) or for every store. Remembered for a year. */
export async function setAdminView(view: "mine" | "all"): Promise<{ error?: string }> {
  const admin = await requireAdmin();
  if (admin.role !== "SUPER_ADMIN") return { error: "Only a super admin can look at other stores." };
  (await cookies()).set(ADMIN_VIEW_COOKIE, view === "all" ? "all" : "mine", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/admin", "layout");
  return {};
}
