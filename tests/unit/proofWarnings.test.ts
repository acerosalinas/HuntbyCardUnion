import { test } from "node:test";
import assert from "node:assert/strict";
import { overlapText, PendingProofInfo, proofOverlap, proofsWaitingFor, waitingProofText } from "../../lib/tracker/proofWarnings";

const proof = (over: Partial<PendingProofInfo>): PendingProofInfo => ({ id: "p1", customerId: "c1", createdAt: "2026-11-07T14:09:00Z", cardsAmount: 500, saleIds: ["s1", "s2"], liveIds: ["L1"], ...over });

test("a waiting proof is found by a shared card, else by the live, else it applies to any payment", () => {
  const proofs = [proof({ id: "a", saleIds: ["s1"], liveIds: ["L1"] }), proof({ id: "b", saleIds: ["s9"], liveIds: ["L2"] })];
  assert.deepEqual(proofsWaitingFor(proofs, { saleIds: ["s1", "s5"] }).map((p) => p.id), ["a"]);
  assert.deepEqual(proofsWaitingFor(proofs, { liveId: "L2" }).map((p) => p.id), ["b"]);
  assert.deepEqual(proofsWaitingFor(proofs, {}).map((p) => p.id), ["a", "b"]);
  assert.deepEqual(proofsWaitingFor(proofs, { saleIds: ["nope"] }), []);
});

test("the waiting-proof warning names the customer, the amount and the day", () => {
  const text = waitingProofText("Jorge", [proof({ cardsAmount: 1800, createdAt: "2026-11-08T01:33:00Z" })]);
  assert.match(text, /Jorge already sent a payment proof/);
  assert.match(text, /₱1,800 sent Nov 8/);
  assert.match(text, /counted twice/);
});

const sales = new Map([["s1", { cardName: "Gengar", amount: 80 }], ["s2", { cardName: "Haunter", amount: 40 }], ["s3", { cardName: "Dragonair", amount: 20 }]]);

test("no overlap when the cards in the proof are still unpaid", () => {
  const o = proofOverlap({ claimCards: [{ saleId: "s1", amount: 80 }, { saleId: "s2", amount: 40 }], sales, paidBySale: {}, coveredBy: new Map() });
  assert.equal(o, null);
});

test("a proof for cards already paid shows how much would be double counted and by which payments", () => {
  const o = proofOverlap({
    claimCards: [{ saleId: "s1", amount: 80 }, { saleId: "s2", amount: 40 }, { saleId: "s3", amount: 20 }],
    sales,
    paidBySale: { s1: 80, s2: 40, s3: 0 },
    coveredBy: new Map([["s1", [{ paymentId: "x", paidOn: "2026-11-08", amount: 500 }]], ["s2", [{ paymentId: "x", paidOn: "2026-11-08", amount: 500 }]]]),
  });
  assert.equal(o?.amount, 120);
  assert.deepEqual(o?.cards.map((c) => c.name), ["Gengar", "Haunter"]);
  assert.deepEqual(o?.payments, [{ paidOn: "2026-11-08", amount: 500 }]);
  assert.match(overlapText("Jorge", o!), /₱120 of this proof is for cards Jorge has already paid for \(Gengar, Haunter\)\. They were already paid by ₱500 on 2026-11-08\. Confirming it would give Jorge a ₱120 credit\./);
});

test("a partly paid card only counts the part that is really extra", () => {
  const o = proofOverlap({ claimCards: [{ saleId: "s1", amount: 80 }], sales, paidBySale: { s1: 50 }, coveredBy: new Map() });
  // 30 is still owed, so 50 of the 80 claimed would be extra.
  assert.equal(o?.amount, 50);
});
