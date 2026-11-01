import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/** The caller's address as the host reports it (Vercel sets x-forwarded-for), or "unknown". */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/**
 * Counts one attempt and says whether it is allowed: at most `max` per `windowSeconds` for this
 * `action` + `subject` (an address, an email, a user id). Fails open: if the limiter itself is
 * unavailable (migration_rate_limits.sql not run yet, database hiccup) the request goes through,
 * because a broken limiter must never lock real customers out.
 */
export async function allowRequest(action: string, subject: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
      p_key: `${action}:${subject.toLowerCase().slice(0, 200)}`,
      p_window_seconds: windowSeconds,
      p_max: max,
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

export const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";
