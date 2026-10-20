import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCustomerTotals, round2 } from "../../lib/tracker/money";
import { buildInvoiceText, computeInvoice, InvoiceInput } from "../../lib/tracker/invoice";
import {
  islandGroupForRegion,
  islandGroupHintFromZip,
  shippingFeeFor,
  zipMismatchWarning,
} from "../../lib/tracker/regions";

const sale = (amount: number, liveId = "L1", forShipping = false, shipped = false) => ({ amount, liveId, forShipping, shipped });

test("round2 removes float drift", () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
});

test("balance = cards + shipping charged - payments", () => {
  const t = computeCustomerTotals(
    [sale(1500), sale(800)],
    [{ amount: 1000, purpose: "CARDS" }],
    [{ fee: 64 }],
  );
  assert.equal(t.cardsTotal, 2300);
  assert.equal(t.balance, 1364);
  assert.equal(t.cardCount, 2);
});

test("multiple payments over time reduce the balance each time", () => {
  const sales = [sale(2000)];
  const first = computeCustomerTotals(sales, [{ amount: 500, purpose: "CARDS" }], []);
  assert.equal(first.balance, 1500);
  const second = computeCustomerTotals(
    sales,
    [
      { amount: 500, purpose: "CARDS" },
      { amount: 1500, purpose: "CARDS" },
    ],
    [],
  );
  assert.equal(second.balance, 0);
});

test("prepaid shipping is credit until a shipment uses it", () => {
  const payments = [{ amount: 64, purpose: "SHIPPING" as const }];
  assert.equal(computeCustomerTotals([], payments, []).prepaidShippingCredit, 64);
  assert.equal(computeCustomerTotals([], payments, [{ fee: 64 }]).prepaidShippingCredit, 0);
  // Shipment fee is charged AND the prepaid payment offsets it: net zero owed.
  assert.equal(computeCustomerTotals([], payments, [{ fee: 64 }]).balance, 0);
});

test("awaiting-ship counts only unshipped for-shipping cards", () => {
  const t = computeCustomerTotals(
    [sale(100, "L1", true, false), sale(100, "L1", true, true), sale(100, "L1", false, false)],
    [],
    [],
  );
  assert.equal(t.forShippingCount, 2);
  assert.equal(t.awaitingShipCount, 1);
  assert.equal(t.shippedCount, 1);
});

test("region decides island group; unknown region is null, never guessed", () => {
  assert.equal(islandGroupForRegion("NCR"), "LUZON");
  assert.equal(islandGroupForRegion("VII"), "VISAYAS");
  assert.equal(islandGroupForRegion("NIR"), "VISAYAS");
  assert.equal(islandGroupForRegion("XI"), "MINDANAO");
  assert.equal(islandGroupForRegion("BARMM"), "MINDANAO");
  assert.equal(islandGroupForRegion(""), null);
  assert.equal(islandGroupForRegion(null), null);
});

test("shipping fee follows island group", () => {
  const rates = { luzonFee: 64, visayasMindanaoFee: 94 };
  assert.equal(shippingFeeFor("LUZON", rates), 64);
  assert.equal(shippingFeeFor("VISAYAS", rates), 94);
  assert.equal(shippingFeeFor("MINDANAO", rates), 94);
  assert.equal(shippingFeeFor(null, rates), null);
});

test("zip is a hint only; 5xxx is ambiguous and never warns", () => {
  assert.equal(islandGroupHintFromZip("1000"), "LUZON");
  assert.equal(islandGroupHintFromZip("6000"), "VISAYAS");
  assert.equal(islandGroupHintFromZip("8000"), "MINDANAO");
  assert.equal(islandGroupHintFromZip("5000"), null);
  assert.equal(islandGroupHintFromZip("abc"), null);
  assert.ok(zipMismatchWarning("NCR", "6000"));
  assert.equal(zipMismatchWarning("NCR", "1000"), null);
  assert.equal(zipMismatchWarning("VI", "5000"), null);
});

function invoice(overrides: Partial<InvoiceInput> = {}): InvoiceInput {
  const cards = [
    { cardName: "Charizard ex", amount: 1500 },
    { cardName: "Pikachu VMAX", amount: 800 },
  ];
  const base = {
    customerName: "Maria",
    liveTitle: "Oct 19 live",
    cards,
    totals: computeCustomerTotals([sale(1500), sale(800)], [], []),
    livePaid: 0,
    otherLivesDue: 0,
    shippingUnpaid: 0,
    shippingFee: null,
    islandGroup: null,
    address: null,
    showAddress: true,
    paymentInstructions: "GCash 0900",
    ...overrides,
  };
  // By default this live's shipping need follows the customer's totals, as when there's only one live.
  return { ...base, awaitingShipThisLive: overrides.awaitingShipThisLive ?? base.totals.awaitingShipCount };
}

test("invoice: simple live, no shipping", () => {
  const b = computeInvoice(invoice());
  assert.equal(b.liveTotal, 2300);
  assert.equal(b.totalToPay, 2300);
  assert.equal(b.shippingFee, null);
});

test("invoice: previous balance carries over from earlier lives", () => {
  const b = computeInvoice(invoice({ otherLivesDue: 500 }));
  assert.equal(b.previousBalance, 500);
  assert.equal(b.totalToPay, 2800);
});

test("invoice: unpaid shipping fees from parcels already sent are added to the previous balance", () => {
  const b = computeInvoice(invoice({ otherLivesDue: 500, shippingUnpaid: 64 }));
  assert.equal(b.previousBalance, 564);
  assert.equal(b.totalToPay, 2864);
});

test("invoice: money already paid for this live reduces its total", () => {
  const b = computeInvoice(invoice({ livePaid: 1000 }));
  assert.equal(b.paymentsApplied, 1000);
  assert.equal(b.totalToPay, 1300);
});

test("invoice: a fully paid live with nothing else owed comes to zero", () => {
  const b = computeInvoice(invoice({ livePaid: 2300 }));
  assert.equal(b.totalToPay, 0);
});

test("invoice: other lives can still be owed while this live is paid", () => {
  const b = computeInvoice(invoice({ livePaid: 2300, otherLivesDue: 400 }));
  assert.equal(b.paymentsApplied, 2300);
  assert.equal(b.totalToPay, 400);
});

test("invoice: shipping fee added once when cards are for shipping", () => {
  const totals = computeCustomerTotals([sale(1500, "L1", true), sale(800, "L1", true)], [], []);
  const b = computeInvoice(invoice({ totals, shippingFee: 94, islandGroup: "VISAYAS" }));
  assert.equal(b.shippingDue, 94);
  assert.equal(b.totalToPay, 2394);
});

test("invoice: prepaid shipping covers the fee and is not double counted", () => {
  const totals = computeCustomerTotals(
    [sale(1500, "L1", true), sale(800, "L1", true)],
    [{ amount: 64, purpose: "SHIPPING" }],
    [],
  );
  const b = computeInvoice(invoice({ totals, shippingFee: 64, islandGroup: "LUZON" }));
  assert.equal(b.prepaidCovered, 64);
  assert.equal(b.shippingDue, 0);
  assert.equal(b.totalToPay, 2300);
  assert.match(buildInvoiceText(invoice({ totals, shippingFee: 64, islandGroup: "LUZON" })), /already prepaid/);
});

test("invoice: partial prepaid credit nets against the fee", () => {
  const totals = computeCustomerTotals(
    [sale(100, "L1", true)],
    [{ amount: 30, purpose: "SHIPPING" }],
    [],
  );
  const b = computeInvoice(invoice({ cards: [{ cardName: "X", amount: 100 }], totals, shippingFee: 94, islandGroup: "VISAYAS" }));
  assert.equal(b.shippingDue, 64);
  assert.equal(b.totalToPay, 164);
});

test("invoice: unknown island group says to confirm and adds no fee", () => {
  const totals = computeCustomerTotals([sale(1500, "L1", true), sale(800, "L1", true)], [], []);
  const input = invoice({ totals, shippingFee: null });
  const b = computeInvoice(input);
  assert.equal(b.shippingUnknown, true);
  assert.equal(b.totalToPay, 2300);
  assert.match(buildInvoiceText(input), /to be confirmed/);
});

test("invoice text: address only when shipping applies and enabled", () => {
  const totals = computeCustomerTotals([sale(1500, "L1", true), sale(800, "L1", true)], [], []);
  const withAddr = invoice({ totals, shippingFee: 64, islandGroup: "LUZON", address: "Brgy. X, Manila" });
  assert.match(buildInvoiceText(withAddr), /Ship to: Maria, Brgy\. X, Manila/);
  assert.doesNotMatch(buildInvoiceText({ ...withAddr, showAddress: false }), /Ship to/);
  assert.doesNotMatch(buildInvoiceText(invoice({ address: "Brgy. X, Manila" })), /Ship to/);
});

import { computeDashboard, inRange } from "../../lib/tracker/dashboard";
import { allocateCardPayments, DEFAULT_OWNER_LABELS, liveBalances, liveSplit, normalizeOwnerTag, SplitPayment, SplitSale } from "../../lib/tracker/split";

test("dashboard: range-based figures follow the date range, outstanding does not", () => {
  const lives = [
    { id: "a", title: "Old live", liveDate: "2026-09-01" },
    { id: "b", title: "New live", liveDate: "2026-10-18" },
  ];
  const sales = [
    { id: "s1", customerId: "c1", liveId: "a", amount: 1000, ownerTag: "A", order: "2026-09-01|1" },
    { id: "s2", customerId: "c1", liveId: "b", amount: 500, ownerTag: "S", order: "2026-10-18|1" },
    { id: "s3", customerId: "c2", liveId: "b", amount: 300, ownerTag: null, order: "2026-10-18|2" },
  ];
  const payments = [
    { customerId: "c1", amount: 400, method: "GCASH" as const, purpose: "CARDS" as const, paidOn: "2026-09-05", liveId: null },
    { customerId: "c2", amount: 100, method: "MARIBANK" as const, purpose: "CARDS" as const, paidOn: "2026-10-19", liveId: null },
  ];
  const customers = [
    { id: "c1", name: "Ana", islandGroup: null },
    { id: "c2", name: "Ben", islandGroup: null },
  ];
  const totalsByCustomer = {
    c1: computeCustomerTotals([sale(1000, "a"), sale(500, "b", true)], [{ amount: 400, purpose: "CARDS" }], []),
    c2: computeCustomerTotals([sale(300, "b")], [{ amount: 100, purpose: "CARDS" }], []),
  };
  const d = computeDashboard({ customers, lives, sales, payments, ownerLabels: DEFAULT_OWNER_LABELS, shipments: [], totalsByCustomer }, { from: "2026-10-01" });
  assert.equal(d.soldInRange, 800); // only the October live
  assert.equal(d.collectedInRange, 100); // only the October payment
  assert.equal(d.byMethod.MARIBANK, 100);
  assert.equal(d.byMethod.GCASH, 0);
  assert.equal(d.perLive.length, 1);
  // Outstanding is "right now": (1500-400) + (300-100) regardless of the range.
  assert.equal(d.outstandingNow, 1300);
  assert.equal(d.owingCount, 2);
  assert.equal(d.topOwing[0].name, "Ana");
  assert.equal(d.awaitingShipCards, 1);
  assert.equal(d.shipQueue[0].name, "Ana");
});

test("dashboard: inRange is inclusive and open-ended when unset", () => {
  assert.equal(inRange("2026-10-01", { from: "2026-10-01", to: "2026-10-01" }), true);
  assert.equal(inRange("2026-09-30", { from: "2026-10-01" }), false);
  assert.equal(inRange("2030-01-01", {}), true);
});

const sp = (id: string, customerId: string, liveId: string, amount: number, ownerTag: string | null, order: string): SplitSale => ({
  id,
  customerId,
  liveId,
  amount,
  ownerTag,
  order,
});

test("owner tags are normalised", () => {
  assert.equal(normalizeOwnerTag(" a "), "A");
  assert.equal(normalizeOwnerTag(""), null);
  assert.equal(normalizeOwnerTag(null), null);
});

const pay = (customerId: string, amount: number, liveId: string | null = null, purpose: "CARDS" | "SHIPPING" = "CARDS"): SplitPayment => ({
  customerId,
  amount,
  liveId,
  purpose,
});
const paidOf = (sales: SplitSale[], payments: SplitPayment[]) => allocateCardPayments(sales, payments);

test("split: expected per owner is the sum of that owner's cards in the live", () => {
  const sales = [sp("1", "c1", "L", 1000, "A", "1"), sp("2", "c1", "L", 500, "S", "2"), sp("3", "c2", "L", 245, "A", "3"), sp("4", "c2", "OTHER", 999, "A", "4")];
  const split = liveSplit("L", sales, paidOf(sales, []), DEFAULT_OWNER_LABELS);
  assert.equal(split.rows.find((r) => r.code === "A")?.expected, 1245);
  assert.equal(split.rows.find((r) => r.code === "S")?.expected, 500);
  assert.equal(split.expectedTotal, 1745);
  assert.equal(split.actualTotal, 0);
});

test("split: general payments settle a customer's oldest cards first", () => {
  // c1 bought 1000 (A, older) then 500 (S, newer) and paid 1200 -> the A card is fully paid, 200 lands on the S card.
  const sales = [sp("1", "c1", "L", 1000, "A", "1"), sp("2", "c1", "L", 500, "S", "2")];
  const split = liveSplit("L", sales, paidOf(sales, [pay("c1", 1200)]), DEFAULT_OWNER_LABELS);
  assert.equal(split.rows.find((r) => r.code === "A")?.actual, 1000);
  assert.equal(split.rows.find((r) => r.code === "S")?.actual, 200);
  assert.equal(split.actualTotal, 1200);
});

test("split: a general payment clears the older live before the newer one", () => {
  const sales = [sp("old", "c1", "L1", 300, "A", "2026-09-01"), sp("new", "c1", "L2", 300, "A", "2026-10-01")];
  const paid = paidOf(sales, [pay("c1", 300)]);
  assert.equal(paid.get("old"), 300);
  assert.equal(paid.get("new"), 0);
});

test("payments for a specific live settle THAT live, not the older one", () => {
  const sales = [sp("old", "c1", "L1", 300, "A", "2026-09-01"), sp("new", "c1", "L2", 300, "A", "2026-10-01")];
  const paid = paidOf(sales, [pay("c1", 300, "L2")]);
  assert.equal(paid.get("new"), 300);
  assert.equal(paid.get("old"), 0);
  const balances = liveBalances(sales, paid);
  assert.deepEqual(balances.c1.L1, { cards: 300, paid: 0 });
  assert.deepEqual(balances.c1.L2, { cards: 300, paid: 300 });
});

test("a live-specific payment bigger than that live spills onto the oldest unpaid cards", () => {
  const sales = [sp("old", "c1", "L1", 300, "A", "2026-09-01"), sp("new", "c1", "L2", 100, "A", "2026-10-01")];
  const paid = paidOf(sales, [pay("c1", 250, "L2")]);
  assert.equal(paid.get("new"), 100);
  assert.equal(paid.get("old"), 150);
});

test("a partial payment for a live leaves that live partly unpaid", () => {
  const sales = [sp("a", "c1", "L2", 300, "A", "2026-10-01"), sp("b", "c1", "L2", 200, "S", "2026-10-01|2")];
  const balances = liveBalances(sales, paidOf(sales, [pay("c1", 350, "L2")]));
  assert.deepEqual(balances.c1.L2, { cards: 500, paid: 350 });
});

test("shipping-fee payments never reduce what's owed for cards", () => {
  const sales = [sp("a", "c1", "L", 300, "A", "1")];
  assert.equal(paidOf(sales, [pay("c1", 64, null, "SHIPPING")]).get("a"), 0);
  assert.equal(paidOf(sales, [pay("c1", 64, "L", "SHIPPING")]).get("a"), 0);
});

test("split: overpayment never exceeds the card total; untagged cards get an Unassigned row", () => {
  const sales = [sp("1", "c1", "L", 100, null, "1")];
  const split = liveSplit("L", sales, paidOf(sales, [pay("c1", 500)]), DEFAULT_OWNER_LABELS);
  const unassigned = split.rows.find((r) => r.code === null);
  assert.equal(unassigned?.expected, 100);
  assert.equal(unassigned?.actual, 100);
  // Configured owners still get a zero row.
  assert.equal(split.rows.find((r) => r.code === "A")?.expected, 0);
});

test("split: a tag that isn't in the labels still shows up under its own code", () => {
  const sales = [sp("1", "c1", "L", 100, "Z", "1")];
  const split = liveSplit("L", sales, paidOf(sales, []), DEFAULT_OWNER_LABELS);
  assert.equal(split.rows.find((r) => r.code === "Z")?.expected, 100);
});

test("invoice text: QR links appended only when set", () => {
  const withQr = buildInvoiceText(invoice({ qrLinks: [{ label: "GCash", url: "https://img.example/g.png" }, { label: "Maribank", url: "https://img.example/m.png" }] }));
  assert.match(withQr, /Scan to pay:/);
  assert.match(withQr, /GCash QR: https:\/\/img\.example\/g\.png/);
  assert.match(withQr, /Maribank QR: https:\/\/img\.example\/m\.png/);
  assert.doesNotMatch(buildInvoiceText(invoice()), /Scan to pay/);
  assert.doesNotMatch(buildInvoiceText(invoice({ qrLinks: [{ label: "GCash", url: "" }] })), /Scan to pay/);
});

test("distribution counts: hand-over cards are tracked separately from shipping cards", () => {
  const t = computeCustomerTotals(
    [
      { amount: 100, liveId: "L1", forShipping: false, shipped: false, distributed: false },
      { amount: 100, liveId: "L1", forShipping: false, shipped: false, distributed: true },
      { amount: 100, liveId: "L1", forShipping: true, shipped: false },
    ],
    [],
    [],
  );
  assert.equal(t.toDistributeCount, 1);
  assert.equal(t.distributedCount, 1);
  assert.equal(t.awaitingShipCount, 1);
});
