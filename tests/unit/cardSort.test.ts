import { test } from "node:test";
import assert from "node:assert/strict";
import { pinnedFirst, sortCards } from "../../lib/cardFilter";
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

test("pinned listings stay first (latest pin on top) whatever the sort, and the rest keep their order", () => {
  const pin = (c: CardItem, at: number): CardItem => ({ ...c, pinnedAt: at });
  const list = [card("new", 100, 3000), pin(card("old-pin", 900, 1000), 10), card("mid", 500, 2000), pin(card("new-pin", 800, 500), 20)];
  assert.deepEqual(ids(pinnedFirst(sortCards(list, "NEWEST"))), ["new-pin", "old-pin", "new", "mid"]);
  assert.deepEqual(ids(pinnedFirst(sortCards(list, "PRICE_LOW"))), ["new-pin", "old-pin", "new", "mid"]);
  assert.deepEqual(ids(pinnedFirst(sortCards(cards, "NEWEST"))), ids(sortCards(cards, "NEWEST")));
});
