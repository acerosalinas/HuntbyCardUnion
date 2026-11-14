import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStatementText, computeStatement, StatementInput } from "../../lib/tracker/statement";
import { statementOrders } from "../../lib/tracker/statementOrders";
import { marketplaceStatementItems, MarketClaim } from "../../lib/tracker/marketplaceLink";

const base: StatementInput = {
  customerName: "Jorge",
  orders: [{ liveTitle: "11/06 Live", liveDate: "2026-11-06", cards: [{ cardName: "Gengar", amount: 80, paid: 0 }, { cardName: "Haunter", amount: 40, paid: 0 }] }],
  shippingUnpaid: 0,
  awaitingShipCount: 0,
  shippingFee: null,
  islandGroup: null,
  prepaidCredit: 0,
  address: null,
  showAddress: false,
  paymentInstructions: "GCash 0917 000 0000",
  includeShipping: false,
};

test("live and marketplace balances are added into ONE total", () => {
  const input = { ...base, marketplace: { unpaid: [{ title: "Ninetales", packNumber: null, amount: 120 }, { title: "Mystery Pack", packNumber: 4, amount: 50 }], cod: [] } };
  const s = computeStatement(input);
  assert.equal(s.cardsDue, 120);
  assert.equal(s.marketplaceDue, 170);
  assert.equal(s.totalToPay, 290);
  const text = buildStatementText(input);
  assert.match(text, /Nov 6 order \(11\/06 Live\):[^]*Order balance: ₱120/);
  assert.match(text, /Marketplace orders:\n1\. Ninetales - ₱120\n2\. Mystery Pack \(Pack #4\) - ₱50\nMarketplace balance: ₱170/);
  assert.match(text, /TOTAL TO PAY: ₱290/);
  assert.match(text, /GCash 0917 000 0000/);
});

test("cash on delivery orders are listed but never added to the total", () => {
  const input = { ...base, marketplace: { unpaid: [], cod: [{ title: "COD Card", packNumber: null, amount: 80 }] } };
  assert.equal(computeStatement(input).totalToPay, 120);
  const text = buildStatementText(input);
  assert.match(text, /TOTAL TO PAY: ₱120/);
  assert.match(text, /Cash on delivery \(pay the courier, not in the total\): COD Card - ₱80/);
});

test("a customer who only owes on the marketplace still gets a full statement", () => {
  const input = { ...base, orders: [], marketplace: { unpaid: [{ title: "Ninetales", packNumber: null, amount: 120 }], cod: [] } };
  const text = buildStatementText(input);
  assert.match(text, /Marketplace balance: ₱120/);
  assert.match(text, /TOTAL TO PAY: ₱120/);
  assert.doesNotMatch(text, /all settled/);
});

test("a customer with nothing unpaid is told so, and a cash-on-delivery order is still mentioned", () => {
  assert.match(buildStatementText({ ...base, orders: [] }), /all settled/);
  const withCod = buildStatementText({ ...base, orders: [], marketplace: { unpaid: [], cod: [{ title: "COD Card", packNumber: null, amount: 80 }] } });
  assert.match(withCod, /all settled/);
  assert.match(withCod, /Cash on delivery \(pay the courier\): COD Card - ₱80/);
});

const claim = (over: Partial<MarketClaim>): MarketClaim => ({
  id: "c", buyerId: "b", orderId: null, title: "Card", packNumber: null, image: null, amount: 100, status: "PENDING", paymentMethod: "PREPAID",
  fulfillment: "SHIP", shipped: false, shipRequestedAt: null, claimedAt: "2026-11-01T00:00:00Z", proofPath: null, proofNote: null, proofUploadedAt: null, ...over,
});

test("marketplace claims are split into pay-now unpaid and cash on delivery; paid ones are left out", () => {
  const items = marketplaceStatementItems([
    claim({ id: "1", title: "A", amount: 100 }),
    claim({ id: "2", title: "B", amount: 60, paymentMethod: "COD" }),
    claim({ id: "3", title: "C", amount: 70, status: "SOLD" }),
    claim({ id: "4", title: "Pack", packNumber: 3, amount: 50 }),
  ]);
  assert.deepEqual(items.unpaid.map((i) => i.title), ["A", "Pack"]);
  assert.equal(items.unpaid[1].packNumber, 3);
  assert.deepEqual(items.cod.map((i) => i.title), ["B"]);
});

test("statement orders: only lives with a pending card, limited to the ticked lives when given, with plan info", () => {
  const lives = [{ id: "L1", title: "Live 1", liveDate: "2026-11-01" }, { id: "L2", title: "Live 2", liveDate: "2026-11-02" }, { id: "L3", title: "Live 3", liveDate: "2026-11-03" }];
  const pendingCards = [
    { id: "s1", liveId: "L1", cardName: "A", amount: 100 },
    { id: "s2", liveId: "L2", cardName: "B", amount: 200 },
  ];
  const args = { lives, pendingCards, paidOf: (id: string) => (id === "s1" ? 40 : 0), planFor: (id: string) => (id === "s2" ? { dueNow: 50, next: { dueDate: "2026-12-01", amount: 150 } } : null) };
  const all = statementOrders(args);
  assert.deepEqual(all.map((o) => o.liveTitle), ["Live 1", "Live 2"]);
  assert.equal(all[0].cards[0].paid, 40);
  assert.deepEqual(all[1].cards[0].plan, { dueNow: 50, next: { dueDate: "2026-12-01", amount: 150 } });
  assert.deepEqual(statementOrders({ ...args, liveIds: new Set(["L2"]) }).map((o) => o.liveTitle), ["Live 2"]);
  assert.deepEqual(statementOrders({ ...args, liveIds: new Set() }).map((o) => o.liveTitle), ["Live 1", "Live 2"]);
});

test("an order being paid in installments owes only what is left after the confirmed ones", () => {
  const items = marketplaceStatementItems([claim({ id: "1", title: "Plan card", amount: 300, paid: 100 }), claim({ id: "2", title: "Plain", amount: 50 })]);
  assert.deepEqual(items.unpaid.map((i) => [i.title, i.amount]), [["Plan card", 200], ["Plain", 50]]);
  const input = { ...base, orders: [], marketplace: items };
  assert.match(buildStatementText(input), /TOTAL TO PAY: ₱250/);
});
