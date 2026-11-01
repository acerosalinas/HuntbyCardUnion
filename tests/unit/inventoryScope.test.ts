import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveInventoryScope, scopeParam } from "../../lib/inventoryScope";

const others = ["admin-b", "admin-c"];

test("inventory scope: a super admin starts on their own listings", () => {
  assert.deepEqual(resolveInventoryScope(undefined, true, others), { kind: "mine" });
  assert.deepEqual(resolveInventoryScope("", true, others), { kind: "mine" });
  assert.deepEqual(resolveInventoryScope("mine", true, others), { kind: "mine" });
});

test("inventory scope: a super admin can pick another shop or all listings", () => {
  assert.deepEqual(resolveInventoryScope("admin-b", true, others), { kind: "store", adminId: "admin-b" });
  assert.deepEqual(resolveInventoryScope("all", true, others), { kind: "all" });
});

test("inventory scope: an unknown shop id falls back to the person's own listings", () => {
  assert.deepEqual(resolveInventoryScope("someone-else", true, others), { kind: "mine" });
});

test("inventory scope: a regular admin can never widen the view, whatever the link says", () => {
  assert.deepEqual(resolveInventoryScope("all", false, others), { kind: "mine" });
  assert.deepEqual(resolveInventoryScope("admin-b", false, others), { kind: "mine" });
});

test("inventory scope: the link value round-trips, and 'mine' leaves the URL clean", () => {
  assert.equal(scopeParam({ kind: "mine" }), null);
  assert.equal(scopeParam({ kind: "all" }), "all");
  assert.equal(scopeParam({ kind: "store", adminId: "admin-b" }), "admin-b");
});
