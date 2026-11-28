import { test } from "node:test";
import assert from "node:assert/strict";
import { afterOneSold, listingNote } from "../../lib/tracker/listingStock";

test("taking one off a listing leaves it for sale until the last one is gone", () => {
  assert.deepEqual(afterOneSold(3), { available: 2, status: "AVAILABLE" });
  assert.deepEqual(afterOneSold(2), { available: 1, status: "AVAILABLE" });
  assert.deepEqual(afterOneSold(1), { available: 0, status: "SOLD" });
});

test("nothing is taken when there is no stock, or the number is not usable", () => {
  assert.equal(afterOneSold(0), null);
  assert.equal(afterOneSold(-1), null);
  assert.equal(afterOneSold(Number.NaN), null);
});

test("the seller is told what happened", () => {
  assert.equal(listingNote("Riolu", { available: 0, status: "SOLD" }), '"Riolu" is marked sold out on the marketplace.');
  assert.equal(listingNote("Riolu", { available: 2, status: "AVAILABLE" }), 'Took 1 off "Riolu" on the marketplace (2 left).');
});
