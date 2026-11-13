import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetLabel, parseBudget } from "../../lib/wantedBudget";

test("an empty budget means none; a real amount is kept with its direction", () => {
  assert.deepEqual(parseBudget("UNDER", "  "), { budget: null });
  assert.deepEqual(parseBudget("UNDER", "500"), { budget: { type: "UNDER", amount: 500 } });
  assert.deepEqual(parseBudget("OVER", "1,250.5"), { budget: { type: "OVER", amount: 1250.5 } });
  assert.deepEqual(parseBudget("anything else", "99"), { budget: { type: "UNDER", amount: 99 } });
});

test("a budget can't be 0 or negative, or not a number", () => {
  for (const bad of ["0", "0.00", "-5", "abc", "1e999"]) assert.ok(parseBudget("UNDER", bad).error, bad);
  assert.match(parseBudget("UNDER", "0").error ?? "", /more than ₱0/);
});

test("the label reads 'Under ₱500' / 'Over ₱500' and is empty without a budget", () => {
  assert.equal(budgetLabel("UNDER", 500), "Under ₱500");
  assert.equal(budgetLabel("OVER", "1200"), "Over ₱1,200");
  assert.equal(budgetLabel(null, null), null);
  assert.equal(budgetLabel("UNDER", 0), null);
});
