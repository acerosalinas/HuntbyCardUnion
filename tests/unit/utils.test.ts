import { test } from "node:test";
import assert from "node:assert/strict";
import { cn, formatCurrency, formatCountdown, buildMessengerUrl } from "../../lib/utils";

test("formatCurrency renders whole pesos without decimals", () => {
  assert.equal(formatCurrency(2400), "₱2,400");
});

test("formatCurrency keeps decimals for fractional amounts", () => {
  assert.equal(formatCurrency(199.5), "₱199.50");
});

test("formatCountdown pads minutes and seconds under an hour", () => {
  assert.equal(formatCountdown(65_000), "01:05");
});

test("formatCountdown includes hours once remaining exceeds 3600s", () => {
  assert.equal(formatCountdown(3_661_000), "1:01:01");
});

test("formatCountdown floors negative/zero remaining to 00:00", () => {
  assert.equal(formatCountdown(-5000), "00:00");
});

test("buildMessengerUrl encodes the message and targets m.me/<username>", () => {
  const url = buildMessengerUrl("CardUnion1", "Hi there!");
  assert.equal(url, "https://m.me/CardUnion1?text=Hi%20there!");
});

test("cn merges conflicting Tailwind classes, keeping the last one", () => {
  assert.equal(cn("px-2", "px-4"), "px-4");
});

test("cn drops falsy values", () => {
  assert.equal(cn("a", false, null, undefined, "b"), "a b");
});
