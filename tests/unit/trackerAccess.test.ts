import { test } from "node:test";
import assert from "node:assert/strict";
import { canUseTracker } from "../../lib/tracker/accessList";

test("every Super Admin can use the Live Tracker, whatever their email", () => {
  assert.equal(canUseTracker({ email: "owner@example.com", role: "SUPER_ADMIN" }), true);
  assert.equal(canUseTracker({ email: "someone.else@example.com", role: "SUPER_ADMIN" }), true);
});

test("nobody else can: regular admins, buyers, signed-out visitors, or an account without an email", () => {
  assert.equal(canUseTracker({ email: "admin@example.com", role: "ADMIN" }), false);
  assert.equal(canUseTracker({ email: "buyer@example.com", role: null }), false);
  assert.equal(canUseTracker({ email: "buyer@example.com", role: undefined }), false);
  assert.equal(canUseTracker({ email: null, role: "SUPER_ADMIN" }), false);
  assert.equal(canUseTracker(null), false);
});
