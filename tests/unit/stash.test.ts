import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStash, isHeld, StashClaimInput, StashSaleInput } from "../../lib/tracker/stash";

const NOW = new Date("2026-11-10T00:00:00Z").getTime();
const customers = [
  { id: "c1", name: "Ana", buyerId: "b1" },
  { id: "c2", name: "Ben", buyerId: null },
];
const lives = [{ id: "L1", title: "Friday live", liveDate: "2026-11-02" }];
const sale = (over: Partial<StashSaleInput>): StashSaleInput => ({
  id: "s", customerId: "c1", liveId: "L1", cardName: "Card", amount: 100, forShipping: false, shipmentId: null, distributedAt: null, createdAt: "2026-11-05T00:00:00Z", ...over,
});
const claim = (over: Partial<StashClaimInput>): StashClaimInput => ({
  id: "m", buyerId: "b1", buyerHandle: "@ana", buyerName: "Ana", title: "Nami", setName: "OP", image: null, sellerHandle: "@op", quantity: 1, unitPrice: 500, status: "SOLD", heldSince: "2026-11-08T00:00:00Z", ...over,
});

test("held = not yet handed over (stash) or not yet in a parcel (shipping)", () => {
  assert.equal(isHeld({ forShipping: false, shipmentId: null, distributedAt: null }), true);
  assert.equal(isHeld({ forShipping: false, shipmentId: null, distributedAt: "2026-11-06" }), false);
  assert.equal(isHeld({ forShipping: true, shipmentId: null, distributedAt: null }), true);
  assert.equal(isHeld({ forShipping: true, shipmentId: "p1", distributedAt: null }), false);
});

test("shipped and handed-over cards are left out; unpaid is amount minus paid", () => {
  const out = buildStash({
    customers, lives, nowMs: NOW, claims: [],
    sales: [sale({ id: "a", amount: 100 }), sale({ id: "b", amount: 50, distributedAt: "2026-11-06" }), sale({ id: "c", amount: 80, forShipping: true, shipmentId: "p1" })],
    paidBySale: { a: 30 },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].cardCount, 1);
  assert.equal(out[0].total, 100);
  assert.equal(out[0].unpaid, 70);
  assert.equal(out[0].oldestDays, 5);
});

test("a marketplace stash joins the linked tracker customer; unlinked buyers stand alone", () => {
  const out = buildStash({
    customers, lives, nowMs: NOW, paidBySale: {},
    sales: [sale({ id: "a", amount: 100 })],
    claims: [claim({ id: "m1" }), claim({ id: "m2", buyerId: "zz", buyerHandle: "@zed", buyerName: null, status: "PENDING", unitPrice: 200, quantity: 2 })],
  });
  const ana = out.find((g) => g.customerId === "c1");
  assert.equal(ana?.cardCount, 2);
  assert.equal(ana?.total, 600);
  const zed = out.find((g) => g.key === "b:zz");
  assert.equal(zed?.name, "@zed");
  assert.equal(zed?.total, 400);
  assert.equal(zed?.unpaid, 400);
  assert.equal(out[0].name, "Ana"); // biggest stash first
});

test("a customer holding nothing does not appear", () => {
  assert.equal(buildStash({ customers, lives, nowMs: NOW, sales: [], claims: [], paidBySale: {} }).length, 0);
});

import { wholeInvoiceViolation } from "../../lib/tracker/wholeInvoice";

const invoiceLives = [
  { title: "Live A", cards: [{ id: "a1", left: 40, underReview: false }, { id: "a2", left: 70, underReview: false }, { id: "a3", left: 0, underReview: false }] },
  { title: "Live B", cards: [{ id: "b1", left: 130, underReview: false }, { id: "b2", left: 50, underReview: true }] },
];

test("payment per invoice: a whole live is fine, single cards are refused", () => {
  assert.equal(wholeInvoiceViolation(invoiceLives, new Set(["a1", "a2"])), null);
  assert.match(wholeInvoiceViolation(invoiceLives, new Set(["a1"])) ?? "", /per invoice/);
  assert.match(wholeInvoiceViolation(invoiceLives, new Set(["a2"])) ?? "", /Live A/);
});

test("payment per invoice: paid and under-review cards are not required, several lives are fine", () => {
  assert.equal(wholeInvoiceViolation(invoiceLives, new Set(["b1"])), null); // b2 is under review, so b1 is the whole payable invoice
  assert.equal(wholeInvoiceViolation(invoiceLives, new Set(["a1", "a2", "b1"])), null);
  // An under-review card is not payable, so this rule ignores it (portalSubmitClaim already refuses such a card separately).
  assert.equal(wholeInvoiceViolation(invoiceLives, new Set(["a1", "a2", "b2"])), null);
  assert.equal(wholeInvoiceViolation(invoiceLives, new Set()), null);
});
