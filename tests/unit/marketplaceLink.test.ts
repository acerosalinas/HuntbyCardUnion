import { test } from "node:test";
import assert from "node:assert/strict";
import { canShipWithParcel, combinedOwed, marketplaceSummary, suggestLinks, MarketClaim } from "../../lib/tracker/marketplaceLink";

const claim = (over: Partial<MarketClaim>): MarketClaim => ({
  id: "c", buyerId: "b1", orderId: null, title: "Card", packNumber: null, image: null, amount: 100, status: "PENDING", paymentMethod: "PREPAID",
  fulfillment: "SHIP", shipped: false, shipRequestedAt: null, claimedAt: "2026-11-01T00:00:00Z", proofPath: null, proofNote: null, proofUploadedAt: null, ...over,
});

test("only paid, unshipped orders that are to ship (or stash with a ship request) can ride in a parcel", () => {
  assert.equal(canShipWithParcel(claim({ status: "SOLD" })), true);
  assert.equal(canShipWithParcel(claim({ status: "PENDING" })), false);
  assert.equal(canShipWithParcel(claim({ status: "SOLD", shipped: true })), false);
  assert.equal(canShipWithParcel(claim({ status: "SOLD", fulfillment: "STASH" })), false);
  assert.equal(canShipWithParcel(claim({ status: "SOLD", fulfillment: "STASH", shipRequestedAt: "2026-11-02T00:00:00Z" })), true);
});

test("summary separates pay-now unpaid, cash on delivery, ready to ship and stashed", () => {
  const s = marketplaceSummary([
    claim({ id: "1", amount: 120 }),
    claim({ id: "2", amount: 80, paymentMethod: "COD" }),
    claim({ id: "3", status: "SOLD", amount: 50 }),
    claim({ id: "4", status: "SOLD", fulfillment: "STASH", amount: 60 }),
    claim({ id: "5", status: "SOLD", shipped: true, amount: 70 }),
  ]);
  assert.equal(s.unpaid, 120);
  assert.equal(s.unpaidCount, 1);
  assert.equal(s.cod, 80);
  assert.deepEqual(s.readyToShip.map((c) => c.id), ["3"]);
  assert.equal(s.stashed, 1);
});

test("combined owed adds pay-now marketplace orders to the live balance and ignores a live credit", () => {
  const s = marketplaceSummary([claim({ amount: 120 }), claim({ id: "2", amount: 30, paymentMethod: "COD" })]);
  assert.equal(combinedOwed(500, s), 620);
  assert.equal(combinedOwed(-200, s), 120);
});

const profiles = [
  { id: "p1", handle: "@ana_cruz", fullName: "Ana Cruz" },
  { id: "p2", handle: "@benj", fullName: "Benjamin Lee" },
  { id: "p3", handle: "@dup", fullName: "Dup Name" },
  { id: "p4", handle: "@dup2", fullName: "Dup Name" },
];

test("link suggestions match a handle or a full name, and are never applied automatically", () => {
  const s = suggestLinks(
    [
      { id: "c1", name: "Ana Cruz", buyerId: null },
      { id: "c2", name: "benj", buyerId: null },
      { id: "c3", name: "Benjamin Lee", buyerId: null },
    ],
    profiles,
  );
  const byCustomer = new Map(s.map((x) => [x.customerId, x]));
  assert.equal(byCustomer.get("c1")?.buyerId, "p1");
  assert.equal(byCustomer.get("c1")?.reason, "handle");
  // p2 fits two customers (by handle and by full name), so neither is suggested.
  assert.equal(byCustomer.has("c2"), false);
  assert.equal(byCustomer.has("c3"), false);
});

test("a name that fits two accounts, or an account already linked, is left out", () => {
  assert.deepEqual(suggestLinks([{ id: "c", name: "Dup Name", buyerId: null }], profiles), []);
  assert.deepEqual(suggestLinks([{ id: "c1", name: "Ana Cruz", buyerId: null }, { id: "c9", name: "Someone", buyerId: "p1" }], profiles), []);
});
