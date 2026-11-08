import { test } from "node:test";
import assert from "node:assert/strict";
import { dayLabel, groupByDay } from "../../lib/tracker/proofDays";

const e = (date: string, person: string, total: number, owners: [string, number][], item = `${person}-${date}`) => ({
  date,
  item,
  total,
  person,
  owners: owners.map(([name, amount]) => ({ name, amount })),
});

test("proofs are grouped by day, newest day first, with totals split by owner and by person", () => {
  const days = groupByDay([
    e("2026-11-07", "Ana", 300, [["AC", 300]]),
    e("2026-11-08", "Ana", 500, [["AC", 200], ["Shane", 300]], "a1"),
    e("2026-11-08", "Ben", 100, [["Shane", 100]], "b1"),
    e("2026-11-08", "Ana", 50, [["AC", 50]], "a2"),
  ]);
  assert.deepEqual(days.map((d) => d.date), ["2026-11-08", "2026-11-07"]);
  const nov8 = days[0];
  assert.equal(nov8.total, 650);
  assert.deepEqual(nov8.owners, [{ name: "AC", amount: 250 }, { name: "Shane", amount: 400 }]);
  assert.deepEqual(nov8.people, [{ name: "Ana", amount: 550, proofs: 2 }, { name: "Ben", amount: 100, proofs: 1 }]);
  assert.deepEqual(nov8.items, ["a1", "b1", "a2"]);
});

test("day labels read the calendar day without shifting it", () => {
  assert.equal(dayLabel("2026-11-08"), "Sun, Nov 8, 2026");
  assert.equal(dayLabel("nonsense"), "nonsense");
});
