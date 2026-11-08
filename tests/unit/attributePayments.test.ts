import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateCardPayments, attributePayments, AttributablePayment, SplitSale } from "../../lib/tracker/split";

const sale = (id: string, customerId: string, liveId: string, amount: number, order: string, ownerTag: string | null = "A"): SplitSale => ({ id, customerId, liveId, amount, ownerTag, order });
const pay = (id: string, customerId: string, amount: number, liveId: string | null, order: string, allocations?: { saleId: string; amount: number }[]): AttributablePayment => ({
  id, customerId, amount, liveId, purpose: "CARDS", order, allocations,
});

const sales: SplitSale[] = [
  sale("s1", "c1", "L1", 100, "2026-10-01|a"),
  sale("s2", "c1", "L1", 200, "2026-10-01|b", "S"),
  sale("s3", "c1", "L2", 300, "2026-10-08|a"),
  sale("s4", "c2", "L1", 150, "2026-10-01|c"),
];

const perCard = (attr: Map<string, Map<string, number>>) => {
  const total = new Map<string, number>();
  for (const cards of attr.values()) for (const [id, amount] of cards) total.set(id, Math.round(((total.get(id) ?? 0) + amount) * 100) / 100);
  return total;
};

test("what each payment paid, added up per card, equals the normal allocation (strict and not)", () => {
  const payments: AttributablePayment[] = [
    pay("p1", "c1", 150, "L1", "2026-10-02|1"),
    pay("p2", "c1", 120, null, "2026-10-03|1"),
    pay("p3", "c1", 400, "L2", "2026-10-09|1"),
    pay("p4", "c1", 50, "L1", "2026-10-10|1", [{ saleId: "s3", amount: 50 }]),
    pay("p5", "c2", 500, null, "2026-10-02|2"),
  ];
  for (const strict of [false, true]) {
    const expected = allocateCardPayments(sales, payments, { strict });
    const got = perCard(attributePayments(sales, payments, { strict }));
    for (const s of sales) assert.equal(got.get(s.id) ?? 0, expected.get(s.id) ?? 0, `${s.id} strict=${strict}`);
  }
});

test("one payment is split across the cards it paid, so it can be split by owner", () => {
  const attr = attributePayments(sales, [pay("p1", "c1", 250, null, "2026-10-02|1")]);
  // Oldest cards first: s1 (100, owner A) then s2 (150 of 200, owner S).
  assert.deepEqual([...(attr.get("p1") ?? [])], [["s1", 100], ["s2", 150]]);
});

test("a payment ticked against cards pays exactly those cards", () => {
  const attr = attributePayments(sales, [pay("p1", "c1", 300, null, "2026-10-02|1", [{ saleId: "s3", amount: 300 }])]);
  assert.deepEqual([...(attr.get("p1") ?? [])], [["s3", 300]]);
});

test("money beyond what the customer owes is not attributed to any card; shipping payments are ignored", () => {
  const attr = attributePayments(sales, [pay("p1", "c2", 500, null, "2026-10-02|1"), { ...pay("p2", "c2", 80, null, "2026-10-03|1"), purpose: "SHIPPING" }]);
  assert.deepEqual([...(attr.get("p1") ?? [])], [["s4", 150]]);
  assert.equal(attr.has("p2"), false);
});
