import { test } from "node:test";
import assert from "node:assert/strict";
import { daysBetween, dividerTitle, groupProofsByDay, isArchived } from "../../lib/tracker/proofArchive";

test("days between two calendar days, across month and year ends", () => {
  assert.equal(daysBetween("2026-11-20", "2026-11-27"), 7);
  assert.equal(daysBetween("2026-10-30", "2026-11-02"), 3);
  assert.equal(daysBetween("2025-12-31", "2026-01-01"), 1);
  assert.equal(daysBetween("2026-11-27", "2026-11-27"), 0);
});

test("a proof is archived once it is more than 7 days old - exactly 7 days still counts as recent", () => {
  assert.equal(isArchived("2026-11-27", "2026-11-27"), false);
  assert.equal(isArchived("2026-11-20", "2026-11-27"), false);
  assert.equal(isArchived("2026-11-19", "2026-11-27"), true);
});

test("dividers say Today and Yesterday, then just the date", () => {
  assert.match(dividerTitle("2026-11-27", "2026-11-27"), /^Today · .*Nov 27, 2026$/);
  assert.match(dividerTitle("2026-11-26", "2026-11-27"), /^Yesterday · /);
  assert.equal(dividerTitle("2026-11-20", "2026-11-27"), "Fri, Nov 20, 2026");
});

test("proofs are grouped by Philippine day, newest day first and newest proof first, with each day's total", () => {
  const e = (at: string, amount: number, node: string) => ({ at, amount, node });
  const days = groupProofsByDay([
    e("2026-11-26T20:00:00Z", 100, "late-evening-utc"), // 04:00 on the 27th in Manila
    e("2026-11-26T10:00:00Z", 50, "same-day-26"),
    e("2026-11-27T05:00:00Z", 25.5, "27-midday"),
    e("2026-11-20T01:00:00Z", 10, "old"),
  ]);
  assert.deepEqual(days.map((d) => d.day), ["2026-11-27", "2026-11-26", "2026-11-20"]);
  assert.deepEqual(days[0].entries.map((x) => x.node), ["27-midday", "late-evening-utc"]);
  assert.equal(days[0].total, 125.5);
  assert.equal(days[0].count, 2);
  assert.equal(days[1].count, 1);
});
