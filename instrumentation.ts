import type { Instrumentation } from "next";

// The same error repeating (a broken page hit by many visitors) is reported once per window, not once per visit.
const recent = new Map<string, number>();
const REPEAT_WINDOW_MS = 5 * 60 * 1000;

/**
 * Server errors (pages, server actions, route handlers) are written to the host's logs and, when
 * ERROR_WEBHOOK_URL is set (a Discord or Slack incoming-webhook address), posted there as well so
 * a failure reaches you before a customer does. Only the route, method and message are sent -
 * never headers, cookies or form data.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const message = err instanceof Error ? err.message : String(err);
  const digest = typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : undefined;
  const summary = `${request.method} ${request.path} (${context.routeType}: ${context.routePath}) - ${message}`;

  console.error(`[server-error] ${summary}${digest ? ` digest=${digest}` : ""}`);

  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;

  const key = digest ?? summary;
  const now = Date.now();
  if ((recent.get(key) ?? 0) > now - REPEAT_WINDOW_MS) return;
  recent.set(key, now);
  if (recent.size > 200) for (const [k, t] of recent) if (t < now - REPEAT_WINDOW_MS) recent.delete(k);

  const text = `Card Union error: ${summary}`.slice(0, 1800);
  try {
    // "content" is what Discord reads, "text" is what Slack reads.
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: text, text }) });
  } catch {
    // Reporting must never cause a second failure.
  }
};
