import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogSearchAttempts, parseCatalogQuery, rankCatalogMatches, searchTokens } from "../../lib/pokemonCatalog";

test("catalog search: a number typed the way it is printed on the card works", () => {
  assert.deepEqual(searchTokens("grimer 088/071"), ["grimer", "088"]);
  assert.deepEqual(searchTokens("grimer #088"), ["grimer", "088"]);
  assert.deepEqual(parseCatalogQuery("Grimer 088/071 JP"), { tokens: ["grimer", "088"], lang: "ja" });
});

test("catalog search: JP anywhere in the text asks for Japanese cards", () => {
  assert.equal(parseCatalogQuery("jp grimer 088").lang, "ja");
  assert.equal(parseCatalogQuery("grimer 088 japanese").lang, "ja");
  assert.equal(parseCatalogQuery("grimer 088").lang, "en");
});

test("catalog search: attempts go from exact, to no-leading-zeros, to the Pokemon without its number", () => {
  assert.deepEqual(catalogSearchAttempts("grimer 088 jp"), [
    { tokens: ["grimer", "088"], lang: "ja" },
    { tokens: ["grimer", "88"], lang: "ja" },
    { tokens: ["grimer"], lang: "ja" },
  ]);
});

test("catalog search: an English search also tries Japanese cards before giving up the number", () => {
  assert.deepEqual(catalogSearchAttempts("grimer 88"), [
    { tokens: ["grimer", "88"], lang: "en" },
    { tokens: ["grimer", "88"], lang: "ja" },
    { tokens: ["grimer"], lang: "en" },
    { tokens: ["grimer"], lang: "ja" },
  ]);
});

test("catalog search: nothing to try for an empty or JP-only search, and no pointless repeats", () => {
  assert.deepEqual(catalogSearchAttempts(""), []);
  assert.deepEqual(catalogSearchAttempts("jp"), []);
  assert.equal(catalogSearchAttempts("pikachu").length, 2); // en, then ja
});

test("catalog search: the card with the typed printed number is ranked first", () => {
  const rows = [
    { name: "Grimer", lang: "ja", local_id: "188" },
    { name: "Grimer", lang: "ja", local_id: "88" },
    { name: "Grimer", lang: "ja", local_id: "051" },
  ];
  assert.equal(rankCatalogMatches(rows, "grimer 088")[0].local_id, "88");
  assert.equal(rankCatalogMatches(rows, "grimer 51")[0].local_id, "051");
});
