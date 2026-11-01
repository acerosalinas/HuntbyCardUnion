import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeCardPayments } from "../../lib/tracker/installmentLog";

const pay = (paidOn: string, allocations: { saleId: string; amount: number }[], purpose = "CARDS") => ({ purpose, paidOn, allocations });

test("installment log: two recorded payments on one card = partially paid, two parts, latest date", () => {
  const out = summarizeCardPayments(
    [{ id: "A", amount: 1000 }],
    [pay("2026-10-01", [{ saleId: "A", amount: 400 }]), pay("2026-10-08", [{ saleId: "A", amount: 100 }])],
    { A: 500 },
  );
  assert.deepEqual(out, [{ saleId: "A", paid: 500, left: 500, paymentCount: 2, lastPaidOn: "2026-10-08", parts: 2 }]);
});

test("installment log: paid off with one recorded payment is one part (not an installment)", () => {
  const [row] = summarizeCardPayments([{ id: "A", amount: 300 }], [pay("2026-10-01", [{ saleId: "A", amount: 300 }])], { A: 300 });
  assert.equal(row.left, 0);
  assert.equal(row.parts, 1);
});

test("installment log: money from a general payment counts as one more part", () => {
  const [row] = summarizeCardPayments([{ id: "A", amount: 1000 }], [pay("2026-10-05", [{ saleId: "A", amount: 600 }])], { A: 1000 });
  assert.equal(row.paymentCount, 1);
  assert.equal(row.parts, 2); // 600 recorded against the card + 400 from general payments
  assert.equal(row.left, 0);
});

test("installment log: a card with no money on it is left out, and shipping payments are ignored", () => {
  const out = summarizeCardPayments(
    [{ id: "A", amount: 100 }, { id: "B", amount: 100 }],
    [pay("2026-10-01", [{ saleId: "B", amount: 100 }], "SHIPPING")],
    { A: 0 },
  );
  assert.deepEqual(out, []);
});

test("installment log: one payment split across two cards counts once per card", () => {
  const out = summarizeCardPayments(
    [{ id: "A", amount: 500 }, { id: "B", amount: 500 }],
    [pay("2026-10-02", [{ saleId: "A", amount: 500 }, { saleId: "B", amount: 200 }])],
    { A: 500, B: 200 },
  );
  assert.equal(out.find((r) => r.saleId === "B")?.left, 300);
  assert.equal(out.find((r) => r.saleId === "B")?.paymentCount, 1);
});
