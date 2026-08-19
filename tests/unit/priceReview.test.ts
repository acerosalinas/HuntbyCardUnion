import { test } from "node:test";
import assert from "node:assert/strict";
import { isPriceReviewStale } from "../../lib/priceReview";

const NOW = new Date("2026-08-19T00:00:00.000Z");

test("a review from earlier today is not stale", () => {
  assert.equal(isPriceReviewStale("2026-08-19T00:00:00.000Z", NOW), false);
});

test("a review from 6 days ago is not stale", () => {
  assert.equal(isPriceReviewStale("2026-08-13T01:00:00.000Z", NOW), false);
});

test("a review from exactly 7 days ago is not stale (boundary is exclusive)", () => {
  assert.equal(isPriceReviewStale("2026-08-12T00:00:00.000Z", NOW), false);
});

test("a review from 8 days ago is stale", () => {
  assert.equal(isPriceReviewStale("2026-08-11T00:00:00.000Z", NOW), true);
});

test("accepts an epoch-ms timestamp as well as an ISO string", () => {
  const eightDaysAgoMs = NOW.getTime() - 8 * 24 * 60 * 60 * 1000;
  assert.equal(isPriceReviewStale(eightDaysAgoMs, NOW), true);
});
