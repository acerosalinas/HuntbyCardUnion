import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransitionDispute, isDisputeResolved, TERMINAL_DISPUTE_STATUSES } from "../../lib/disputeStatus";
import { DisputeStatus } from "../../types/marketplace";

const ALL_STATUSES: DisputeStatus[] = [
  "OPEN",
  "SELLER_RESPONDED",
  "UNDER_REVIEW",
  "RESOLVED_REFUND",
  "RESOLVED_DISMISSED",
];

test("OPEN can move to any of the seller/review/resolution states", () => {
  assert.equal(canTransitionDispute("OPEN", "SELLER_RESPONDED"), true);
  assert.equal(canTransitionDispute("OPEN", "UNDER_REVIEW"), true);
  assert.equal(canTransitionDispute("OPEN", "RESOLVED_REFUND"), true);
  assert.equal(canTransitionDispute("OPEN", "RESOLVED_DISMISSED"), true);
});

test("SELLER_RESPONDED can move to review or either resolution, but not back to OPEN", () => {
  assert.equal(canTransitionDispute("SELLER_RESPONDED", "UNDER_REVIEW"), true);
  assert.equal(canTransitionDispute("SELLER_RESPONDED", "RESOLVED_REFUND"), true);
  assert.equal(canTransitionDispute("SELLER_RESPONDED", "RESOLVED_DISMISSED"), true);
  assert.equal(canTransitionDispute("SELLER_RESPONDED", "OPEN"), false);
});

test("UNDER_REVIEW can only move to a resolution, not back to earlier states", () => {
  assert.equal(canTransitionDispute("UNDER_REVIEW", "RESOLVED_REFUND"), true);
  assert.equal(canTransitionDispute("UNDER_REVIEW", "RESOLVED_DISMISSED"), true);
  assert.equal(canTransitionDispute("UNDER_REVIEW", "OPEN"), false);
  assert.equal(canTransitionDispute("UNDER_REVIEW", "SELLER_RESPONDED"), false);
});

test("resolved statuses are terminal - no transition out, in either direction", () => {
  for (const resolved of TERMINAL_DISPUTE_STATUSES) {
    for (const target of ALL_STATUSES) {
      assert.equal(canTransitionDispute(resolved, target), false, `${resolved} -> ${target} should be rejected`);
    }
  }
});

test("no status can transition to itself", () => {
  for (const status of ALL_STATUSES) {
    assert.equal(canTransitionDispute(status, status), false, `${status} -> ${status} should be rejected`);
  }
});

test("isDisputeResolved matches the terminal statuses", () => {
  assert.equal(isDisputeResolved("RESOLVED_REFUND"), true);
  assert.equal(isDisputeResolved("RESOLVED_DISMISSED"), true);
  assert.equal(isDisputeResolved("OPEN"), false);
  assert.equal(isDisputeResolved("SELLER_RESPONDED"), false);
  assert.equal(isDisputeResolved("UNDER_REVIEW"), false);
});
