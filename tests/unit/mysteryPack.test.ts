import { test } from "node:test";
import assert from "node:assert/strict";
import { MYSTERY_MAX_PACKS, packNumbers } from "../../lib/mysteryPack";
import { matchesCardFilter } from "../../lib/cardFilter";
import type { CardItem } from "../../types/marketplace";

test("packNumbers lists 1..count and never goes past the cap", () => {
  assert.deepEqual(packNumbers(3), [1, 2, 3]);
  assert.equal(packNumbers(99).length, MYSTERY_MAX_PACKS);
  assert.deepEqual(packNumbers(0), []);
});

const mystery = { title: "Fun Mystery Pack", setName: "Unknown Set", conditionGrade: "Sealed", rarity: "Other", productType: "MYSTERY", isFlashSale: false, pokemonType: null, sellerHandle: "@s" } as unknown as CardItem;
const filter = (category: Parameters<typeof matchesCardFilter>[1]["category"]) => matchesCardFilter(mystery, { query: "", category, rarity: "ALL" });

test("a mystery pack only shows under All and Mystery Packs, never Raw or Graded", () => {
  assert.equal(filter("ALL"), true);
  assert.equal(filter("MYSTERY"), true);
  assert.equal(filter("RAW"), false);
  assert.equal(filter("GRADED"), false);
  assert.equal(filter("SEALED"), false);
});
