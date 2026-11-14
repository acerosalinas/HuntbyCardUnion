import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSchedule, maxInstallmentPayment, readPlan } from "../../lib/claimInstallments";

test("a plan is equal weekly installments that add up exactly, the last absorbing rounding", () => {
  const r = buildSchedule(100, 3, "2026-11-10");
  assert.deepEqual(r.installments, [
    { seq: 1, dueDate: "2026-11-10", amount: 33.33 },
    { seq: 2, dueDate: "2026-11-17", amount: 33.33 },
    { seq: 3, dueDate: "2026-11-24", amount: 33.34 },
  ]);
  assert.equal(r.installments!.reduce((n, i) => Math.round((n + i.amount) * 100) / 100, 0), 100);
});

test("two installments, and a plan always ends within 4 weeks of its start", () => {
  const two = buildSchedule(300, 2, "2026-11-10").installments!;
  assert.deepEqual(two.map((i) => i.amount), [150, 150]);
  const four = buildSchedule(1000, 4, "2026-11-10").installments!;
  assert.equal(four[3].dueDate, "2026-12-01");
  const spanDays = (new Date(`${four[3].dueDate}T00:00:00Z`).getTime() - new Date(`${four[0].dueDate}T00:00:00Z`).getTime()) / 86400000;
  assert.ok(spanDays <= 28);
});

test("a plan can't have fewer than 2 or more than 4 installments, or installments under the minimum", () => {
  assert.ok(buildSchedule(300, 1, "2026-11-10").error);
  assert.ok(buildSchedule(300, 5, "2026-11-10").error);
  assert.match(buildSchedule(50, 4, "2026-11-10").error ?? "", /under ₱20/);
  assert.ok(buildSchedule(0, 2, "2026-11-10").error);
  assert.equal(buildSchedule(40, 2, "2026-11-10").error, undefined);
});

test("confirmed payments fill the installments in order; what's due now and next are read from the dates", () => {
  const { installments } = buildSchedule(300, 3, "2026-11-10");
  const none = readPlan(installments!, 0, "2026-11-10");
  assert.equal(none.evaluation.dueNow, 100);
  assert.equal(none.left, 300);
  const part = readPlan(installments!, 150, "2026-11-18");
  assert.equal(part.paid, 150);
  assert.equal(part.left, 150);
  // The 2nd installment (₱100, due Nov 17) is only half covered by Nov 18, so it is late.
  assert.equal(part.evaluation.overdue, true);
  assert.equal(readPlan(installments!, 200, "2026-11-18").evaluation.overdue, false);
  const late = readPlan(installments!, 100, "2026-11-25");
  assert.equal(late.evaluation.overdue, true);
  const done = readPlan(installments!, 300, "2026-11-25");
  assert.equal(done.evaluation.complete, true);
});

test("a buyer can't send more than is still unpaid, counting payments the seller hasn't reviewed yet", () => {
  assert.equal(maxInstallmentPayment(300, 100, 0), 200);
  assert.equal(maxInstallmentPayment(300, 100, 150), 50);
  assert.equal(maxInstallmentPayment(300, 300, 0), 0);
  assert.equal(maxInstallmentPayment(300, 200, 150), 0);
});
