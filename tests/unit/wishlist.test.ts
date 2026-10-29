import { test } from "node:test";
import assert from "node:assert/strict";
import { adminAlertText, buyerResultText, escapeHtml, MAX_WISHLIST_ALERTS_PER_HOUR, parseNotifyEmails } from "../../lib/wishlistText";

test("notify emails default to the admin account and ignore junk", () => {
  assert.deepEqual(parseNotifyEmails(undefined), ["acrosalinas@gmail.com"]);
  assert.deepEqual(parseNotifyEmails(""), ["acrosalinas@gmail.com"]);
  assert.deepEqual(parseNotifyEmails("  "), ["acrosalinas@gmail.com"]);
});

test("notify emails can be overridden, are lower-cased and de-duplicated", () => {
  assert.deepEqual(parseNotifyEmails("A@x.com, b@y.com ,a@x.com, not-an-email,"), ["a@x.com", "b@y.com"]);
});

test("buyer-typed text is escaped before it goes into an email", () => {
  assert.equal(escapeHtml('<script>alert("x")</script> & \'q\''), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;");
});

test("admin alert wording differs for a request and a hearted card", () => {
  assert.match(adminAlertText("wanted", "ash", "Charizard").title, /card request from @ash/);
  assert.match(adminAlertText("wishlist", "ash", "Charizard").body, /added "Charizard" to their wishlist/);
});

test("fulfilled tells the buyer the card is available and to message to claim it; not fulfilled says it isn't", () => {
  const ok = buyerResultText("FULFILLED", "Charizard");
  assert.match(ok.body, /now available/);
  assert.match(ok.body, /message us to claim it/);
  const no = buyerResultText("CLOSED", "Charizard");
  assert.match(no.body, /couldn't get "Charizard"/);
  assert.doesNotMatch(no.body, /available/);
});

test("the per-buyer hourly alert cap is a sane small number", () => {
  assert.ok(MAX_WISHLIST_ALERTS_PER_HOUR >= 3 && MAX_WISHLIST_ALERTS_PER_HOUR <= 20);
});
