/** Who hears about a new wishlist entry. Override with WISHLIST_NOTIFY_EMAILS (comma-separated). */
export const DEFAULT_WISHLIST_NOTIFY_EMAILS = "acrosalinas@gmail.com";

/** At most this many alerts per buyer per hour - hearting and un-hearting in a loop must not flood the admin. */
export const MAX_WISHLIST_ALERTS_PER_HOUR = 8;

export function parseNotifyEmails(raw: string | undefined | null): string[] {
  const list = (raw && raw.trim() ? raw : DEFAULT_WISHLIST_NOTIFY_EMAILS)
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@") && !/\s/.test(e));
  return [...new Set(list)];
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export type WishlistKind = "wishlist" | "wanted";

/** The alert an admin gets when a buyer adds something new. */
export function adminAlertText(kind: WishlistKind, buyerHandle: string, cardName: string): { title: string; body: string } {
  return kind === "wanted"
    ? { title: `New card request from @${buyerHandle}`, body: `@${buyerHandle} is looking for "${cardName}".` }
    : { title: `New wishlist card from @${buyerHandle}`, body: `@${buyerHandle} added "${cardName}" to their wishlist.` };
}

/** What the buyer is told once an admin answers their wishlist card or request. */
export function buyerResultText(result: "FULFILLED" | "CLOSED", cardName: string): { title: string; body: string } {
  return result === "FULFILLED"
    ? { title: "Your wishlist card is available", body: `"${cardName}" is now available - message us to claim it.` }
    : { title: "Update on your wishlist card", body: `We couldn't get "${cardName}" for you this time. You're welcome to ask again anytime.` };
}
