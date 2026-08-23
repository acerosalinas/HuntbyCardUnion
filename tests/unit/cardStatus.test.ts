import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransitionCardStatus } from "../../lib/cardStatus";
import { CardStatus } from "../../types/marketplace";

const ALL_STATUSES: CardStatus[] = ["DRAFT", "AVAILABLE", "PENDING", "SOLD"];

test("DRAFT can only move to AVAILABLE (publishing)", () => {
  assert.equal(canTransitionCardStatus("DRAFT", "AVAILABLE"), true);
  assert.equal(canTransitionCardStatus("DRAFT", "PENDING"), false);
  assert.equal(canTransitionCardStatus("DRAFT", "SOLD"), false);
});

test("nothing can transition back into DRAFT", () => {
  for (const from of ALL_STATUSES) {
    assert.equal(canTransitionCardStatus(from, "DRAFT"), false, `${from} -> DRAFT should be rejected`);
  }
});

test("AVAILABLE can move to SOLD (stock exhausted), not to PENDING", () => {
  assert.equal(canTransitionCardStatus("AVAILABLE", "SOLD"), true);
  assert.equal(canTransitionCardStatus("AVAILABLE", "PENDING"), false);
});

test("PENDING is no longer a row-level status - no transitions in or out", () => {
  for (const target of ALL_STATUSES) {
    assert.equal(canTransitionCardStatus("PENDING", target), false, `PENDING -> ${target} should be rejected`);
  }
  for (const from of ALL_STATUSES) {
    assert.equal(canTransitionCardStatus(from, "PENDING"), false, `${from} -> PENDING should be rejected`);
  }
});

test("SOLD can move back to AVAILABLE (a cancelled claim frees stock)", () => {
  assert.equal(canTransitionCardStatus("SOLD", "AVAILABLE"), true);
  assert.equal(canTransitionCardStatus("SOLD", "DRAFT"), false);
  assert.equal(canTransitionCardStatus("SOLD", "PENDING"), false);
});

test("no status can transition to itself", () => {
  for (const status of ALL_STATUSES) {
    assert.equal(canTransitionCardStatus(status, status), false, `${status} -> ${status} should be rejected`);
  }
});
