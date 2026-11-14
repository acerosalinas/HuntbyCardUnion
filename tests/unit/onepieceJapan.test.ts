import { test } from "node:test";
import assert from "node:assert/strict";
import { jpColorToEnglish, normalizeJpCard, parseJpCards, parseJpSeries, setIdOfCode } from "../../lib/onepieceJapan";

const page = `
<select name="series" id="x">
  <option value="" >All</option>
  <option value="550101" >ブースターパック &lt;br class=&quot;spInline&quot;&gt;ROMANCE DAWN【OP-01】</option>
  <option value="550901" >プロモーションカード</option>
</select>
<div class="resultCol">
<dl class="modalCol" id="OP01-001"><dt><div class="infoCol"><span>OP01-001</span> | <span>L</span> | <span>LEADER</span></div><div class="cardName">ロロノア・ゾロ</div></dt>
<dd><div class="frontCol"><img data-src="../images/cardlist/card/OP01-001.png?261113"></div><div class="color"><h3>色</h3>赤</div>
<div class="getInfo"><h3>入手情報</h3>ROMANCE DAWN【OP-01】   <div class="x"></div></div></dd></dl>
<dl class="modalCol" id="OP01-001_p2"><dt><div class="infoCol"><span>OP01-001</span> | <span>L</span> | <span>LEADER</span></div><div class="cardName">ロロノア・ゾロ</div></dt>
<dd><img data-src="../images/cardlist/card/OP01-001_p2.png?1"><div class="color"><h3>色</h3>赤/緑</div></dd></dl>
</div>`;

test("the set list and each set's cards are read from the official page", () => {
  const series = parseJpSeries(page);
  assert.deepEqual(series.map((s) => s.value), ["550101", "550901"]);
  assert.equal(series[0].title, "ブースターパック ROMANCE DAWN【OP-01】");
  const cards = parseJpCards(page);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].code, "OP01-001");
  assert.equal(cards[0].rarityCode, "L");
  assert.equal(cards[0].imageUrl, "https://www.onepiece-cardgame.com/images/cardlist/card/OP01-001.png");
  assert.equal(cards[0].setLine, "ROMANCE DAWN【OP-01】");
  assert.equal(cards[1].code, "OP01-001");
  assert.equal(cards[1].id, "OP01-001_p2");
});

test("a Japanese card is stored under its own id, keeps its Japanese name searchable and takes the English name when known", () => {
  const [plain, parallel] = parseJpCards(page);
  const series = parseJpSeries(page)[0];
  const row = normalizeJpCard(plain, series, { name: "Roronoa Zoro", setName: "Romance Dawn" });
  assert.equal(row.id, "jp:OP01-001");
  assert.equal(row.name, "Roronoa Zoro");
  assert.equal(row.set_name, "Romance Dawn (Japanese)");
  assert.equal(row.color, "Red");
  assert.ok(row.search.includes("ロロノア・ゾロ") && row.search.includes("roronoa zoro") && row.search.includes("japanese"));
  const p = normalizeJpCard(parallel, series, null);
  assert.equal(p.name, "ロロノア・ゾロ");
  assert.equal(p.variant, "Parallel");
  assert.equal(p.rarity, "Parallel Rare (Alternate Art)");
  assert.equal(p.color, "Red/Green");
  assert.equal(normalizeJpCard({ ...plain, id: "OP01-001_r1" }, series).variant, "Reprint");
});

test("set ids and colours", () => {
  assert.equal(setIdOfCode("OP01-001"), "OP-01");
  assert.equal(setIdOfCode("ST05-003"), "ST-05");
  assert.equal(setIdOfCode("P-012"), "P");
  assert.equal(jpColorToEnglish("紫"), "Purple");
});
