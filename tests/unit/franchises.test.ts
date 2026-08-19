import { test } from "node:test";
import assert from "node:assert/strict";
import { FRANCHISES, getFranchiseBySlug } from "../../lib/franchises";

test("getFranchiseBySlug finds a known franchise", () => {
  assert.deepEqual(getFranchiseBySlug("pokemon"), { slug: "pokemon", label: "Pokémon" });
});

test("getFranchiseBySlug returns undefined for an unknown slug", () => {
  assert.equal(getFranchiseBySlug("yugioh"), undefined);
});

test("every franchise has a non-empty slug and label", () => {
  for (const f of FRANCHISES) {
    assert.ok(f.slug.length > 0);
    assert.ok(f.label.length > 0);
  }
});
