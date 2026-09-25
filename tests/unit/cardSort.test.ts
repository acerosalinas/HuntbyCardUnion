import { test } from "node:test";
import assert from "node:assert/strict";
import { sortCards } from "../../lib/cardFilter";
import { CardItem } from "../../types/marketplace";

function card(id: string, price: number, createdAt: number): CardItem {
  return { id, price, createdAt } as CardItem;
}

const cards = [card("mid", 500, 2000), card("cheap-old", 100, 1000), card("pricey-new", 900, 3000), card("mid-newer", 500, 2500)];
const ids = (list: CardItem[]) => list.map((c) => c.id);

test("newest first puts the most recently listed card at the top", () => {
  assert.deepEqual(ids(sortCards(cards, "NEWEST")), ["pricey-new", "mid-newer", "mid", "cheap-old"]);
});

test("oldest first is the exact reverse order by listing date", () => {
  assert.deepEqual(ids(sortCards(cards, "OLDEST")), ["cheap-old", "mid", "mid-newer", "pricey-new"]);
});

test("price low to high, with equal prices showing the newer listing first", () => {
  assert.deepEqual(ids(sortCards(cards, "PRICE_LOW")), ["cheap-old", "mid-newer", "mid", "pricey-new"]);
});

test("price high to low, with equal prices showing the newer listing first", () => {
  assert.deepEqual(ids(sortCards(cards, "PRICE_HIGH")), ["pricey-new", "mid-newer", "mid", "cheap-old"]);
});

test("sorting never mutates the list it was given", () => {
  const before = ids(cards);
  sortCards(cards, "PRICE_HIGH");
  assert.deepEqual(ids(cards), before);
});
