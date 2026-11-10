import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNotificationEmail } from "../../lib/emailAddress";

test("a valid address is trimmed and lower-cased", () => {
  assert.deepEqual(parseNotificationEmail("  Shop.Alerts@Example.COM "), { email: "shop.alerts@example.com" });
});

test("an empty box means 'use my sign-in email'", () => {
  assert.deepEqual(parseNotificationEmail("   "), { email: null });
});

test("things that aren't addresses are refused", () => {
  for (const bad of ["plain", "a@b", "a b@c.com", "@x.com", "a@@x.com", `${"a".repeat(250)}@x.com`]) {
    assert.ok(parseNotificationEmail(bad).error, bad);
  }
});
