import "server-only";
import { headers } from "next/headers";

/**
 * The real request origin (protocol + host) for building auth redirect URLs
 * from a Server Action - `window.location.origin` isn't available there.
 * Never hardcode/assume a domain: this must reflect whatever host the
 * request actually came in on (localhost in dev, the deployed domain in
 * production) or Supabase's confirmation/reset emails end up pointing at
 * the wrong environment.
 */
export async function resolveOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "";
  const protocol = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}
