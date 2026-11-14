import { test } from "node:test";
import assert from "node:assert/strict";
import { isOptcgImage, mapOnePieceRarity, normalizeOnePieceCard, onePieceListingTitle, parseOnePieceName } from "../../lib/onepieceCatalog";

test("the card number in brackets is dropped and art variants are kept apart from the name", () => {
  assert.deepEqual(parseOnePieceName("Roronoa Zoro (001)"), { name: "Roronoa Zoro", variant: null });
  assert.deepEqual(parseOnePieceName("Monkey.D.Luffy (024) (Parallel)"), { name: "Monkey.D.Luffy", variant: "Parallel" });
  assert.deepEqual(parseOnePieceName("Nami (Alternate Art) (Manga)"), { name: "Nami", variant: "Alternate Art, Manga" });
  assert.deepEqual(parseOnePieceName("Radical Beam!!"), { name: "Radical Beam!!", variant: null });
});

test("a bracket that is part of a character's name stays in it", () => {
  assert.deepEqual(parseOnePieceName("Mr.3 (Galdino) (Parallel)"), { name: "Mr.3 (Galdino)", variant: "Parallel" });
  assert.deepEqual(parseOnePieceName("Mr.3 (Galdino)"), { name: "Mr.3 (Galdino)", variant: null });
});

test("a reprint's reference to another card code is a variant, not part of the name", () => {
  assert.deepEqual(parseOnePieceName("Kuma (OP05-082)"), { name: "Kuma", variant: "OP05-082" });
});

test("rarity: art variants outrank the plain code, and codes map to the site's tiers", () => {
  assert.equal(mapOnePieceRarity("L", null), "Leader");
  assert.equal(mapOnePieceRarity("C", null), "Common");
  assert.equal(mapOnePieceRarity("UC", null), "Uncommon");
  assert.equal(mapOnePieceRarity("R", null), "Rare");
  assert.equal(mapOnePieceRarity("SR", null), "Super Rare");
  assert.equal(mapOnePieceRarity("SEC", null), "Secret Rare");
  assert.equal(mapOnePieceRarity("TR", null), "Treasure Rare");
  assert.equal(mapOnePieceRarity("PR", null), "Other");
  assert.equal(mapOnePieceRarity("SR", "Parallel"), "Parallel Rare (Alternate Art)");
  assert.equal(mapOnePieceRarity("SR", "Alternate Art"), "Parallel Rare (Alternate Art)");
  assert.equal(mapOnePieceRarity("SR", "Super Alternate Art"), "Pirate Crew Super Parallel");
  assert.equal(mapOnePieceRarity("SR", "SP"), "Special Rare");
  assert.equal(mapOnePieceRarity("SEC", "Manga"), "Manga Rare");
  assert.equal(mapOnePieceRarity("SR", "Reprint"), "Super Rare");
});

test("a catalog row is built with a searchable lower-case line and the site's rarity", () => {
  const row = normalizeOnePieceCard({
    card_name: "Roronoa Zoro (001) (Parallel)", card_set_id: "OP01-001", set_name: "Romance Dawn", set_id: "OP-01", rarity: "L", card_color: "Red", card_type: "Leader",
    card_image_id: "OP01-001_p1", card_image: "https://optcgapi.com/media/static/Card_Images/OP01-001_p1.jpg",
  });
  assert.ok(row);
  assert.equal(row.id, "OP01-001_p1");
  assert.equal(row.card_code, "OP01-001");
  assert.equal(row.name, "Roronoa Zoro");
  assert.equal(row.variant, "Parallel");
  assert.equal(row.rarity, "Parallel Rare (Alternate Art)");
  assert.equal(row.search, "roronoa zoro parallel op01-001 op-01 romance dawn");
  assert.equal(normalizeOnePieceCard({ card_name: "  ", card_set_id: "x", set_name: "s", set_id: "s", rarity: "C", card_image_id: "x" }), null);
});

test("listing titles read name, code, then the variant", () => {
  assert.equal(onePieceListingTitle({ name: "Roronoa Zoro", number: "OP01-001", variant: "Parallel" }), "Roronoa Zoro OP01-001 (Parallel)");
  assert.equal(onePieceListingTitle({ name: "Perona", number: "OP01-077" }), "Perona OP01-077");
});

test("only the API's own card pictures may be copied into the shop's storage", () => {
  assert.equal(isOptcgImage("https://optcgapi.com/media/static/Card_Images/OP01-001.jpg"), true);
  assert.equal(isOptcgImage("https://evil.example/media/static/Card_Images/OP01-001.jpg"), false);
  assert.equal(isOptcgImage("https://optcgapi.com/media/static/Card_Images/../secret.jpg"), false);
  assert.equal(isOptcgImage("http://optcgapi.com/media/static/Card_Images/OP01-001.jpg"), false);
  assert.equal(isOptcgImage("https://optcgapi.com/media/static/Card_Images/page.html"), false);
});
