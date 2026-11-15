import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanHandleInput, handleProblem, HANDLE_REGEX, normalizeHandle } from "../../lib/handleFormat";

test("a handle is normalised with one leading @ and no stray spaces", () => {
  assert.equal(normalizeHandle("  @@juan_cards "), "@juan_cards");
  assert.equal(normalizeHandle("@"), "");
  assert.equal(normalizeHandle("juan"), "@juan");
});

test("a valid handle has no problem", () => {
  for (const h of ["@juan", "juan_cards", "ABC", "a".repeat(20), "@user_123"]) {
    assert.equal(handleProblem(h), null, h);
    assert.ok(HANDLE_REGEX.test(normalizeHandle(h)), h);
  }
});

test("each way a handle can be wrong gets its own plain message", () => {
  assert.match(handleProblem("")!, /Choose a handle/);
  assert.match(handleProblem("ab")!, /at least 3 characters \(it has 2\)/);
  assert.match(handleProblem("a".repeat(21))!, /at most 20 characters \(it has 21\)/);
  assert.match(handleProblem("juan cruz")!, /Remove spaces/);
  assert.match(handleProblem("juan.cruz")!, /Remove "\."/);
  assert.match(handleProblem("juan-cruz ñ")!, /Remove "-", spaces, "ñ"/);
});

test("typing into the handle box drops anything a handle can't hold", () => {
  assert.equal(cleanHandleInput("@Juan Dela.Cruz-1"), "JuanDelaCruz1");
  assert.equal(cleanHandleInput("@@a_b"), "a_b");
  assert.equal(cleanHandleInput("x".repeat(30)).length, 20);
});
