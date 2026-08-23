import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Pulls a human-readable message out of a caught error, for display in a
 * catch block's setError(...). `err instanceof Error` alone isn't enough
 * here - Supabase's RPC/PostgREST errors are plain `{ message, details,
 * hint, code }` objects, not real Error instances, so that check alone
 * silently swallows the real database error message and falls back to
 * whatever generic string the caller passes as a default, hiding the actual
 * cause. Returns null (not the generic default) when nothing usable is
 * found, so the caller's own `?? "fallback"` still applies.
 */
export function extractErrorMessage(err: unknown): string | null {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof err.message === "string" && err.message) {
    return err.message;
  }
  return null;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

/** Formats milliseconds remaining as "MM:SS" (or "HH:MM:SS" past an hour). */
export function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.floor(msRemaining / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Builds an m.me link that pre-fills the chat's message box with `message`.
 * The `text` param is only honored by Facebook business Pages with the
 * Messenger Platform configured; for personal profiles or unconfigured
 * Pages it's silently ignored and the chat just opens empty as before.
 */
export function buildMessengerUrl(username: string, message: string): string {
  return `https://m.me/${username}?text=${encodeURIComponent(message)}`;
}

export function formatRelativeTime(timestampMs: number): string {
  const diffSeconds = Math.round((timestampMs - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return rtf.format(diffSeconds, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSeconds / 3600), "hour");
  return rtf.format(Math.round(diffSeconds / 86400), "day");
}

export const STALE_PENDING_THRESHOLD_HOURS = 24;

/** True once a card has been claimed (PENDING) longer than the stale threshold, for flagging on the admin Pending Payments tab. */
export function isStalePending(claimedAt: number | null, thresholdHours = STALE_PENDING_THRESHOLD_HOURS): boolean {
  if (!claimedAt) return false;
  return Date.now() - claimedAt > thresholdHours * 60 * 60 * 1000;
}
