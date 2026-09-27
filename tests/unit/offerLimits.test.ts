import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_OFFER_FRACTION, MAX_OFFER_FRACTION, minOfferFor, maxOfferFor } from "../../lib/offerLimits";

test("floor is 80% of listed price, rounded up", () => {
  assert.equal(MIN_OFFER_FRACTION, 0.8);
  assert.equal(minOfferFor(1000), 800);
  assert.equal(minOfferFor(999), 800); // 799.2 rounds up, never lets a buyer skate under the real floor
});

test("ceiling is 120% of listed price, rounded down", () => {
  assert.equal(MAX_OFFER_FRACTION, 1.2);
  assert.equal(maxOfferFor(1000), 1200);
  assert.equal(maxOfferFor(999), 1198); // 1198.8 rounds down, never lets a buyer exceed the real ceiling
});

test("the allowed range brackets the listed price itself", () => {
  const price = 500;
  assert.ok(minOfferFor(price) < price);
  assert.ok(maxOfferFor(price) > price);
});
