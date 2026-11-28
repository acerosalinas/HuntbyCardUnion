/**
 * Taking one unit off a marketplace listing because the card was just sold in a live.
 * Same rule the marketplace uses everywhere: one fewer unit available, and the listing reads sold out when none are left.
 * Null when there is nothing to take (no stock left, so it was already sold or reserved).
 */
export function afterOneSold(available: number): { available: number; status: "AVAILABLE" | "SOLD" } | null {
  if (!Number.isFinite(available) || available < 1) return null;
  const left = Math.floor(available) - 1;
  return { available: left, status: left > 0 ? "AVAILABLE" : "SOLD" };
}

/** What the seller is told after taking one off a listing. */
export function listingNote(title: string, result: { available: number; status: "AVAILABLE" | "SOLD" }): string {
  return result.status === "SOLD" ? `"${title}" is marked sold out on the marketplace.` : `Took 1 off "${title}" on the marketplace (${result.available} left).`;
}
