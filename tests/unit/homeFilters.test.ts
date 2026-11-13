import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChips, suggestCards } from "../../lib/homeFilters";
import type { CardItem } from "../../types/marketplace";

const card = (over: Partial<CardItem>): CardItem =>
  ({ id: "c", title: "Card", setName: "Set", price: 200, conditionGrade: "Raw NM", rarity: "Other", productType: "CARD", isFlashSale: false, franchise: "pokemon", sellerHandle: "@s", createdAt: 1, ...over }) as CardItem;

test("chips only appear when they would show at least one card, with counts", () => {
  const chips = buildChips([
    card({ id: "1", price: 80 }),
    card({ id: "2", conditionGrade: "PSA 10" }),
    card({ id: "3", franchise: "one-piece", productType: "MYSTERY", price: 50 }),
  ]);
  const byId = Object.fromEntries(chips.map((c) => [c.id, c]));
  assert.equal(chips[0].id, "all");
  assert.equal(byId.all.count, 3);
  assert.equal(byId["franchise:pokemon"].count, 2);
  assert.equal(byId["franchise:one-piece"].label, "One Piece");
  assert.equal(byId.budget.count, 2);
  assert.equal(byId.graded.count, 1);
  assert.equal(byId.mystery.count, 1);
  assert.equal(byId.sealed, undefined);
  assert.equal(byId.flash, undefined);
});

test("a chip's test picks exactly its cards", () => {
  const cards = [card({ id: "1", price: 80 }), card({ id: "2", price: 500 })];
  const budget = buildChips(cards).find((c) => c.id === "budget")!;
  assert.deepEqual(cards.filter(budget.test).map((c) => c.id), ["1"]);
});

test("suggestions need 2+ letters, put titles that start with the search first, and cap the list", () => {
  const cards = [
    card({ id: "a", title: "Charizard ex", createdAt: 1 }),
    card({ id: "b", title: "Mega Charizard", createdAt: 5 }),
    card({ id: "c", title: "Pikachu", createdAt: 9 }),
    ...Array.from({ length: 10 }, (_, i) => card({ id: `x${i}`, title: `Charmander ${i}`, createdAt: 2 })),
  ];
  assert.deepEqual(suggestCards(cards, "c"), []);
  assert.deepEqual(suggestCards(cards, "  "), []);
  const out = suggestCards(cards, "charizard");
  assert.deepEqual(out.map((c) => c.id), ["a", "b"]);
  assert.equal(suggestCards(cards, "char", 4).length, 4);
});
