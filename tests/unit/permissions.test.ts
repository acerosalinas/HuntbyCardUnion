import { test } from "node:test";
import assert from "node:assert/strict";
import { hasPermission, permissionsFromMetadata, PERMISSIONS } from "../../lib/permissions";
import { canUseTracker } from "../../lib/tracker/accessList";
import { ALIAS_MAX_LENGTH, cleanAlias } from "../../lib/buyerAlias";

test("a Super Admin always has every permission; a regular admin only the ones ticked; nobody else any", () => {
  for (const p of PERMISSIONS) {
    assert.equal(hasPermission({ role: "SUPER_ADMIN" }, p), true);
    assert.equal(hasPermission({ role: "ADMIN", permissions: [] }, p), false);
    assert.equal(hasPermission({ role: "ADMIN" }, p), false);
    assert.equal(hasPermission({ role: "ADMIN", permissions: [p] }, p), true);
    assert.equal(hasPermission({ role: null, permissions: [p] }, p), false);
    assert.equal(hasPermission(null, p), false);
  }
});

test("permissions are read from the account's metadata, dropping anything unknown or malformed", () => {
  assert.deepEqual(permissionsFromMetadata({ permissions: ["live_tracker", "nonsense", 5] }), ["live_tracker"]);
  assert.deepEqual(permissionsFromMetadata({ permissions: "live_tracker" }), []);
  assert.deepEqual(permissionsFromMetadata({}), []);
  assert.deepEqual(permissionsFromMetadata(undefined), []);
});

test("the Live Tracker: Super Admins, plus admins who were given it - and always needs an email", () => {
  assert.equal(canUseTracker({ email: "a@x.com", role: "SUPER_ADMIN" }), true);
  assert.equal(canUseTracker({ email: "a@x.com", role: "ADMIN" }), false);
  assert.equal(canUseTracker({ email: "a@x.com", role: "ADMIN", permissions: [] }), false);
  assert.equal(canUseTracker({ email: "a@x.com", role: "ADMIN", permissions: ["live_tracker"] }), true);
  assert.equal(canUseTracker({ email: null, role: "ADMIN", permissions: ["live_tracker"] }), false);
  assert.equal(canUseTracker({ email: "a@x.com", role: null, permissions: ["live_tracker"] }), false);
  assert.equal(canUseTracker(null), false);
});

test("a sub username is tidied before it is stored", () => {
  assert.equal(cleanAlias("  Maria   FB \n"), "Maria FB");
  assert.equal(cleanAlias("a\u0000b\tc"), "a b c");
  assert.equal(cleanAlias("   "), "");
  assert.equal(cleanAlias("x".repeat(100)).length, ALIAS_MAX_LENGTH);
});
