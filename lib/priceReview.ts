const PRICE_REVIEW_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** Whether a seller's last price review is more than 7 days old. */
export function isPriceReviewStale(reviewedAt: string | number, now: Date = new Date()): boolean {
  const reviewedAtMs = typeof reviewedAt === "string" ? new Date(reviewedAt).getTime() : reviewedAt;
  return now.getTime() - reviewedAtMs > PRICE_REVIEW_STALE_MS;
}
