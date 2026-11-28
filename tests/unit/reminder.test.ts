import { test } from "node:test";
import assert from "node:assert/strict";
import { owedBy, planReminders, ReminderPerson, reminderText } from "../../lib/tracker/reminder";

const person = (over: Partial<ReminderPerson>): ReminderPerson => ({ key: "k", name: "P", buyerId: "b", liveOwed: 0, liveCards: 0, marketOwed: 0, marketOrders: 0, ...over });
const NOW = new Date("2026-11-28T12:00:00Z");

test("what someone owes is their live cards plus their pay-now marketplace orders; a credit is never netted", () => {
  assert.equal(owedBy({ liveOwed: 100, marketOwed: 50 }), 150);
  assert.equal(owedBy({ liveOwed: -40, marketOwed: 50 }), 50);
  assert.equal(owedBy({ liveOwed: 0, marketOwed: 0 }), 0);
});

test("everyone who owes and can be reached is reminded; nobody who owes nothing is", () => {
  const plan = planReminders(
    [person({ key: "a", name: "A", buyerId: "a", liveOwed: 200, liveCards: 2 }), person({ key: "b", name: "B", buyerId: "b", marketOwed: 70, marketOrders: 1 }), person({ key: "c", name: "C", buyerId: "c" })],
    new Map(),
    NOW,
  );
  assert.deepEqual(plan.toNotify.map((p) => p.name), ["A", "B"]);
  assert.equal(plan.totalOwed, 270);
});

test("someone with no linked account can't be reached and is listed apart", () => {
  const plan = planReminders([person({ name: "NoAccount", buyerId: null, liveOwed: 100, liveCards: 1 })], new Map(), NOW);
  assert.deepEqual(plan.unreachable.map((p) => p.name), ["NoAccount"]);
  assert.equal(plan.toNotify.length, 0);
});

test("nobody is reminded twice within 24 hours, but is again after", () => {
  const owing = person({ buyerId: "x", name: "X", liveOwed: 50, liveCards: 1 });
  const recent = planReminders([owing], new Map([["x", "2026-11-28T00:00:01Z"]]), NOW); // 12 hours ago
  assert.equal(recent.toNotify.length, 0);
  assert.deepEqual(recent.recentlyReminded.map((p) => p.name), ["X"]);
  const old = planReminders([owing], new Map([["x", "2026-11-27T11:59:00Z"]]), NOW); // just over 24 hours ago
  assert.equal(old.toNotify.length, 1);
});

test("the reminder says what is owed and links to where it is paid", () => {
  const both = reminderText("Card Shop", { liveOwed: 200, liveCards: 2, marketOwed: 70, marketOrders: 1 });
  assert.equal(both.title, "Payment reminder from Card Shop");
  assert.match(both.body, /₱270/);
  assert.match(both.body, /2 cards from the lives/);
  assert.match(both.body, /1 marketplace order/);
  assert.equal(both.link, "/account/orders");
  assert.equal(reminderText("S", { liveOwed: 0, liveCards: 0, marketOwed: 70, marketOrders: 1 }).link, "/account/dibs");
});
