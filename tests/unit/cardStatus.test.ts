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

test("AVAILABLE can move to PENDING (claimed), not directly to SOLD", () => {
  assert.equal(canTransitionCardStatus("AVAILABLE", "PENDING"), true);
  assert.equal(canTransitionCardStatus("AVAILABLE", "SOLD"), false);
});

test("PENDING can move to AVAILABLE (released) or SOLD (confirmed paid)", () => {
  assert.equal(canTransitionCardStatus("PENDING", "AVAILABLE"), true);
  assert.equal(canTransitionCardStatus("PENDING", "SOLD"), true);
});

test("SOLD is terminal - no transition out", () => {
  for (const target of ALL_STATUSES) {
    assert.equal(canTransitionCardStatus("SOLD", target), false, `SOLD -> ${target} should be rejected`);
  }
});

test("no status can transition to itself", () => {
  for (const status of ALL_STATUSES) {
    assert.equal(canTransitionCardStatus(status, status), false, `${status} -> ${status} should be rejected`);
  }
});
