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

import { computeDashboard, inRange, ownerProgress } from "../../lib/tracker/dashboard";
import { allocateCardPayments, attributeCardPayments, DEFAULT_OWNER_LABELS, liveBalances, liveSplit, normalizeOwnerTag, SplitPayment, SplitSale } from "../../lib/tracker/split";

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
  const d = computeDashboard({ customers, lives, sales, payments, ownerLabels: DEFAULT_OWNER_LABELS, payouts: [], shipments: [], totalsByCustomer }, { from: "2026-10-01" });
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

import { buildStatementText, computeStatement, formatShortDate, StatementInput } from "../../lib/tracker/statement";

function statement(overrides: Partial<StatementInput> = {}): StatementInput {
  return {
    customerName: "Maye",
    orders: [
      {
        liveTitle: "10/24 live",
        liveDate: "2026-10-24",
        cards: [
          { cardName: "Herdier", amount: 50, paid: 0 },
          { cardName: "Chimchar", amount: 40, paid: 0 },
        ],
      },
      { liveTitle: "10/25 live", liveDate: "2026-10-25", cards: [{ cardName: "Swinub", amount: 70, paid: 0 }] },
    ],
    shippingUnpaid: 0,
    awaitingShipCount: 0,
    shippingFee: null,
    islandGroup: null,
    prepaidCredit: 0,
    address: null,
    showAddress: true,
    paymentInstructions: "GCash 0900",
    ...overrides,
  };
}

test("statement: short dates are month-name based", () => {
  assert.equal(formatShortDate("2026-10-24"), "Oct 24");
  assert.equal(formatShortDate("2026-01-05"), "Jan 5");
});

test("statement: pending orders are grouped by date, oldest first, with their card lists", () => {
  const s = computeStatement(statement({ orders: [...statement().orders].reverse() }));
  assert.deepEqual(s.orders.map((o) => o.liveDate), ["2026-10-24", "2026-10-25"]);
  assert.equal(s.orders[0].lines.length, 2);
  assert.equal(s.cardsDue, 160);
  assert.equal(s.totalToPay, 160);
  const text = buildStatementText(statement());
  assert.match(text, /Oct 24 order \(10\/24 live\):\n1\. Herdier - ₱50\n2\. Chimchar - ₱40\nOrder balance: ₱90/);
  assert.match(text, /Oct 25 order \(10\/25 live\):\n1\. Swinub - ₱70/);
  assert.match(text, /TOTAL TO PAY: ₱160/);
});

test("statement: fully paid orders are left out entirely", () => {
  const input = statement();
  input.orders[0].cards = input.orders[0].cards.map((c) => ({ ...c, paid: c.amount }));
  const s = computeStatement(input);
  assert.equal(s.orders.length, 1);
  assert.equal(s.orders[0].liveDate, "2026-10-25");
  assert.equal(s.totalToPay, 70);
  assert.doesNotMatch(buildStatementText(input), /Oct 24/);
});

test("statement: partial payments show only what is left, per card", () => {
  const input = statement();
  input.orders[0].cards = [
    { cardName: "Herdier", amount: 50, paid: 50 },
    { cardName: "Chimchar", amount: 40, paid: 15 },
  ];
  const s = computeStatement(input);
  assert.deepEqual(s.orders[0].lines, [{ cardName: "Chimchar", amount: 40, left: 25 }]);
  assert.equal(s.orders[0].balance, 25);
  const text = buildStatementText(input);
  assert.match(text, /1\. Chimchar - ₱25 \(₱25 left of ₱40\)/);
  assert.doesNotMatch(text, /Herdier/);
  assert.equal(s.totalToPay, 95);
});

test("statement: nothing pending says so", () => {
  const input = statement();
  input.orders = input.orders.map((o) => ({ ...o, cards: o.cards.map((c) => ({ ...c, paid: c.amount })) }));
  assert.match(buildStatementText(input), /all settled/);
});

test("statement: unpaid shipping and an unshipped parcel are added once, net of prepaid", () => {
  const s = computeStatement(statement({ shippingUnpaid: 64, awaitingShipCount: 3, shippingFee: 94, islandGroup: "VISAYAS", prepaidCredit: 30 }));
  assert.equal(s.shippingUnpaid, 64);
  assert.equal(s.shippingDue, 64);
  assert.equal(s.totalToPay, 160 + 64 + 64);
  const text = buildStatementText(statement({ awaitingShipCount: 3, shippingFee: 94, islandGroup: "VISAYAS", address: "Cebu City" }));
  assert.match(text, /Shipping \(Visayas\): ₱94/);
  assert.match(text, /Ship to: Maye, Cebu City/);
});

test("statement: unknown island group asks for the address and adds no fee", () => {
  const s = computeStatement(statement({ awaitingShipCount: 2 }));
  assert.equal(s.shippingUnknown, true);
  assert.equal(s.totalToPay, 160);
  assert.match(buildStatementText(statement({ awaitingShipCount: 2 })), /to be confirmed/);
});

test("dashboard: payouts are summed per owner per live and don't touch other lives", () => {
  const lives = [
    { id: "a", title: "A live", liveDate: "2026-10-18" },
    { id: "b", title: "B live", liveDate: "2026-10-19" },
  ];
  const sales = [
    { id: "s1", customerId: "c1", liveId: "a", amount: 1000, ownerTag: "A", order: "1" },
    { id: "s2", customerId: "c1", liveId: "b", amount: 500, ownerTag: "S", order: "2" },
  ];
  const d = computeDashboard(
    {
      customers: [{ id: "c1", name: "Ana", islandGroup: null }],
      lives,
      sales,
      payments: [{ customerId: "c1", amount: 1500, method: "GCASH", purpose: "CARDS", paidOn: "2026-10-20", liveId: null }],
      ownerLabels: DEFAULT_OWNER_LABELS,
      payouts: [
        { liveId: "a", recipientTag: "A", amount: 600 },
        { liveId: "a", recipientTag: "A", amount: 100 },
        { liveId: "b", recipientTag: "S", amount: 500 },
      ],
      shipments: [],
      totalsByCustomer: { c1: computeCustomerTotals([sale(1000, "a"), sale(500, "b")], [{ amount: 1500, purpose: "CARDS" }], []) },
    },
    {},
  );
  const liveA = d.splitPerLive.find((l) => l.id === "a")!;
  const liveB = d.splitPerLive.find((l) => l.id === "b")!;
  assert.equal(liveA.rows.find((r) => r.code === "A")?.distributed, 700);
  assert.equal(liveA.rows.find((r) => r.code === "A")?.actual, 1000);
  assert.equal(liveA.rows.find((r) => r.code === "S")?.distributed, 0);
  assert.equal(liveA.distributedTotal, 700);
  assert.equal(liveB.rows.find((r) => r.code === "S")?.distributed, 500);
  assert.equal(liveB.distributedTotal, 500);
});

test("owner progress: only active owners get a bar, summed across lives; tables are unaffected", () => {
  const row = (code: string | null, expected: number, actual: number, distributed = 0) => ({ code, name: code ?? "Unassigned", expected, actual, distributed });
  const splits = [
    { rows: [row("A", 1000, 600, 500), row("S", 500, 500), row(null, 50, 0)] },
    { rows: [row("A", 300, 300), row("S", 200, 0)] },
  ];
  const labels = [
    { code: "A", name: "AC" },
    { code: "S", name: "Shane", active: false },
    { code: "J", name: "Jay", active: true },
  ];
  const progress = ownerProgress(splits, labels);
  assert.deepEqual(progress.map((p) => p.code), ["A", "J"]);
  assert.deepEqual(progress[0], { code: "A", name: "AC", expected: 1300, actual: 900, distributed: 500 });
  // A newly added owner with no cards yet still gets an (empty) bar.
  assert.deepEqual(progress[1], { code: "J", name: "Jay", expected: 0, actual: 0, distributed: 0 });
  // Turning Shane back on brings him back; nothing is lost.
  assert.deepEqual(ownerProgress(splits, [{ code: "S", name: "Shane" }]).map((p) => p.expected), [700]);
});

test("a payment ticked against specific cards pays exactly those, not the oldest", () => {
  const sales = [sp("old", "c1", "L1", 300, "A", "2026-09-01"), sp("new", "c1", "L2", 100, "A", "2026-10-01")];
  const payment: SplitPayment = { ...pay("c1", 100), allocations: [{ saleId: "new", amount: 100 }] };
  const paid = allocateCardPayments(sales, [payment]);
  assert.equal(paid.get("new"), 100);
  assert.equal(paid.get("old"), 0);
});

test("a payment smaller than the ticked cards pays them in the order given and leaves the rest owing", () => {
  const sales = [sp("a", "c1", "L", 50, "A", "1"), sp("b", "c1", "L", 40, "S", "2"), sp("c", "c1", "L", 70, "A", "3")];
  const payment: SplitPayment = {
    ...pay("c1", 70),
    allocations: [
      { saleId: "a", amount: 50 },
      { saleId: "b", amount: 20 },
    ],
  };
  const paid = allocateCardPayments(sales, [payment]);
  assert.equal(paid.get("a"), 50);
  assert.equal(paid.get("b"), 20);
  assert.equal(paid.get("c"), 0);
});

test("money a ticked payment couldn't use falls through to the normal rules instead of vanishing", () => {
  // The card was already paid in full by an earlier payment, so the second payment's allocation has no room.
  const sales = [sp("a", "c1", "L", 100, "A", "1"), sp("b", "c1", "L", 100, "A", "2")];
  const first: SplitPayment = { ...pay("c1", 100), allocations: [{ saleId: "a", amount: 100 }] };
  const second: SplitPayment = { ...pay("c1", 100), allocations: [{ saleId: "a", amount: 100 }] };
  const paid = allocateCardPayments(sales, [first, second]);
  assert.equal(paid.get("a"), 100);
  assert.equal(paid.get("b"), 100);
});

test("a ticked payment's unallocated remainder follows the live it was made for", () => {
  const sales = [sp("old", "c1", "L1", 300, "A", "2026-09-01"), sp("x", "c1", "L2", 100, "A", "2026-10-01"), sp("y", "c1", "L2", 100, "A", "2026-10-02")];
  const payment: SplitPayment = { ...pay("c1", 150, "L2"), allocations: [{ saleId: "x", amount: 100 }] };
  const paid = allocateCardPayments(sales, [payment]);
  assert.equal(paid.get("x"), 100);
  assert.equal(paid.get("y"), 50); // the 50 left over stays inside L2, not the older live
  assert.equal(paid.get("old"), 0);
});

test("allocations to another customer's cards are ignored", () => {
  const sales = [sp("mine", "c1", "L", 100, "A", "1"), sp("theirs", "c2", "L", 100, "A", "2")];
  const payment: SplitPayment = { ...pay("c1", 100), allocations: [{ saleId: "theirs", amount: 100 }] };
  const paid = allocateCardPayments(sales, [payment]);
  assert.equal(paid.get("theirs"), 0);
  assert.equal(paid.get("mine"), 100); // the unusable allocation falls back to oldest-first for c1
});

test("shipping fee is left off an invoice unless it's switched on", () => {
  const totals = computeCustomerTotals([sale(1500, "L1", true), sale(800, "L1", true)], [], []);
  const base = invoice({ totals, shippingFee: 94, islandGroup: "VISAYAS", address: "Cebu City", shippingUnpaid: 64, otherLivesDue: 100 });

  const on = computeInvoice(base);
  assert.equal(on.shippingDue, 94);
  assert.equal(on.previousBalance, 164); // 100 + 64 unpaid fee of a parcel already sent
  assert.equal(on.totalToPay, 2300 + 164 + 94);

  const off = computeInvoice({ ...base, includeShipping: false });
  assert.equal(off.shippingFee, null);
  assert.equal(off.shippingDue, 0);
  assert.equal(off.previousBalance, 100);
  assert.equal(off.totalToPay, 2400);
  const text = buildInvoiceText({ ...base, includeShipping: false });
  assert.doesNotMatch(text, /Shipping/);
  assert.doesNotMatch(text, /Ship to/);
  assert.match(buildInvoiceText(base), /Shipping \(Visayas\): ₱94/);
});

test("statement: shipping fees are left off unless switched on", () => {
  const input = statement({ shippingUnpaid: 64, awaitingShipCount: 2, shippingFee: 94, islandGroup: "VISAYAS", address: "Cebu City" });
  assert.equal(computeStatement(input).totalToPay, 160 + 64 + 94);
  const off = { ...input, includeShipping: false };
  assert.equal(computeStatement(off).totalToPay, 160);
  const text = buildStatementText(off);
  assert.doesNotMatch(text, /Shipping/);
  assert.doesNotMatch(text, /Ship to/);
  assert.doesNotMatch(text, /to be confirmed/);
  assert.match(text, /TOTAL TO PAY: ₱160/);
});

import { buildPortalView, PortalInput } from "../../lib/tracker/portalView";

function portalInput(overrides: Partial<PortalInput> = {}): PortalInput {
  const card = (id: string, liveId: string, amount: number, extra: Partial<PortalInput["sales"][number]> = {}) => ({
    id,
    customerId: "c1",
    liveId,
    cardName: "Card " + id,
    amount,
    forShipping: false,
    shipmentId: null,
    distributedAt: null,
    createdAt: "2026-10-2" + id.length + "T00:00:00Z",
    ...extra,
  });
  return {
    sales: [card("a", "L1", 100), card("bb", "L1", 50), card("ccc", "L2", 200)],
    lives: [
      { id: "L2", title: "Second live", liveDate: "2026-10-24" },
      { id: "L1", title: "First live", liveDate: "2026-10-18" },
    ],
    payments: [],
    shipments: [],
    ...overrides,
  };
}

test("portal: lives are listed oldest first with totals and nothing paid yet", () => {
  const v = buildPortalView(portalInput());
  assert.deepEqual(v.lives.map((l) => l.title), ["First live", "Second live"]);
  assert.equal(v.cardsTotal, 350);
  assert.equal(v.cardsPaid, 0);
  assert.equal(v.amountDue, 350);
  assert.equal(v.progressPct, 0);
});

test("portal: only recorded payments move the progress line, oldest cards first", () => {
  const v = buildPortalView(portalInput({ payments: [{ customerId: "c1", amount: 175, purpose: "CARDS", liveId: null, allocations: [] }] }));
  assert.equal(v.cardsPaid, 175);
  assert.equal(v.cardsLeft, 175);
  assert.equal(v.progressPct, 50);
  assert.equal(v.lives[0].left, 0); // the first live (150) is cleared first
  assert.equal(v.lives[1].paid, 25);
});

test("portal: a payment ticked against specific cards pays exactly those", () => {
  const v = buildPortalView(
    portalInput({ payments: [{ customerId: "c1", amount: 200, purpose: "CARDS", liveId: null, allocations: [{ saleId: "ccc", amount: 200 }] }] }),
  );
  assert.equal(v.lives[1].left, 0);
  assert.equal(v.lives[0].left, 150);
});

test("portal: shipped and handed-over cards show their state and date", () => {
  const input = portalInput();
  input.sales[0] = { ...input.sales[0], shipmentId: "S1" };
  input.sales[1] = { ...input.sales[1], distributedAt: "2026-10-20T00:00:00Z" };
  input.sales[2] = { ...input.sales[2], forShipping: true };
  input.shipments = [{ id: "S1", fee: 64, shippedOn: "2026-10-20" }];
  const v = buildPortalView(input);
  const [a, bb] = v.lives[0].cards;
  assert.equal(a.state, "SHIPPED");
  assert.equal(a.shippedOn, "2026-10-20");
  assert.equal(bb.state, "HANDED_OVER");
  assert.equal(v.lives[1].cards[0].state, "PENDING");
  assert.equal(v.lives[1].cards[0].wantsShipping, true);
});

test("portal: a shipped parcel's unpaid fee is owed until a shipping payment covers it", () => {
  const input = portalInput({ shipments: [{ id: "S1", fee: 64, shippedOn: "2026-10-20" }] });
  assert.equal(buildPortalView(input).shippingUnpaid, 64);
  assert.equal(buildPortalView(input).amountDue, 350 + 64);
  const paidFee = { ...input, payments: [{ customerId: "c1", amount: 64, purpose: "SHIPPING" as const, liveId: null, allocations: [] }] };
  assert.equal(buildPortalView(paidFee).shippingUnpaid, 0);
});

test("portal: the view exposes no owner tags, addresses, payment methods or other customers", () => {
  const v = buildPortalView(portalInput());
  const json = JSON.stringify(v);
  for (const forbidden of ["ownerTag", "owner_tag", "customerId", "address", "method", "recipient", "payout"]) {
    assert.ok(!json.includes(forbidden), `portal view must not contain ${forbidden}`);
  }
  assert.deepEqual(Object.keys(v.lives[0].cards[0]).sort(), ["amount", "id", "left", "name", "paid", "payNow", "plan", "shippedOn", "state", "underReview", "wantsShipping"]);
});

test("portal: cards under a pending proof are flagged and the claim list is newest first", () => {
  const input = portalInput({
    claims: [
      { id: "k1", status: "REJECTED", cardsAmount: 100, sfAmount: 0, createdAt: "2026-10-20T00:00:00Z", rejectReason: "Blurry screenshot", saleIds: ["a"] },
      { id: "k2", status: "PENDING", cardsAmount: 50, sfAmount: 64, createdAt: "2026-10-25T00:00:00Z", rejectReason: null, saleIds: ["bb"] },
    ],
  });
  const v = buildPortalView(input);
  const [a, bb] = v.lives[0].cards;
  assert.equal(a.underReview, false); // its claim was rejected, so it's free to claim again
  assert.equal(bb.underReview, true);
  assert.deepEqual(v.claims.map((c) => c.id), ["k2", "k1"]);
  assert.deepEqual(v.claims[1].cardNames, ["Card a"]);
  assert.equal(v.claims[1].rejectReason, "Blurry screenshot");
  // A pending claim does NOT move the progress line - only a confirmed payment does.
  assert.equal(v.cardsPaid, 0);
  assert.equal(v.progressPct, 0);
});

import { explicitlyPaid } from "../../lib/tracker/split";

test("explicitlyPaid: only card payments recorded against that card count toward 'Mark unpaid'", () => {
  const payments = [
    { purpose: "CARDS" as const, allocations: [{ saleId: "a", amount: 40 }, { saleId: "b", amount: 10 }] },
    { purpose: "CARDS" as const, allocations: [{ saleId: "a", amount: 25 }] },
    { purpose: "SHIPPING" as const, allocations: [{ saleId: "a", amount: 999 }] }, // shipping payments never pay cards
    { purpose: "CARDS" as const }, // an older automatic payment: nothing recorded against any card
  ];
  assert.equal(explicitlyPaid("a", payments), 65);
  assert.equal(explicitlyPaid("b", payments), 10);
  assert.equal(explicitlyPaid("zzz", payments), 0);
});

import { addDays, evaluatePlan, splitEvenly, validateSchedule } from "../../lib/tracker/installments";

const plan1500 = [
  { seq: 1, dueDate: "2026-10-27", amount: 750 },
  { seq: 2, dueDate: "2026-11-03", amount: 750 },
];

test("plan: nothing paid on the day it starts - the first payment is due, the second is upcoming", () => {
  const e = evaluatePlan(plan1500, 0, "2026-10-27");
  assert.equal(e.rows[0].state, "DUE");
  assert.equal(e.rows[1].state, "UPCOMING");
  assert.equal(e.dueNow, 750);
  assert.deepEqual(e.next, { seq: 2, dueDate: "2026-11-03", amount: 750 });
  assert.equal(e.payNext, 750);
  assert.equal(e.left, 1500);
  assert.equal(e.complete, false);
});

test("plan: paying 750 fills the first installment, so nothing is due until next week", () => {
  const e = evaluatePlan(plan1500, 750, "2026-10-27");
  assert.equal(e.rows[0].state, "PAID");
  assert.equal(e.dueNow, 0);
  assert.equal(e.paid, 750);
  assert.equal(e.left, 750);
  assert.equal(e.payNext, 750); // the next installment is what to pre-fill
  assert.equal(e.paidCount, 1);
});

test("plan: a missed date is overdue, and a payment smaller than an installment part-fills it", () => {
  const e = evaluatePlan(plan1500, 400, "2026-11-05");
  assert.equal(e.rows[0].covered, 400);
  assert.equal(e.rows[0].state, "OVERDUE");
  assert.equal(e.rows[1].state, "OVERDUE");
  assert.equal(e.overdue, true);
  assert.equal(e.dueNow, 1100); // 350 left of the first + all of the second
});

test("plan: paying everything completes it; overpaying never exceeds the card", () => {
  const e = evaluatePlan(plan1500, 2000, "2026-10-27");
  assert.equal(e.complete, true);
  assert.equal(e.paid, 1500);
  assert.equal(e.left, 0);
  assert.equal(e.dueNow, 0);
  assert.equal(e.payNext, 0);
});

test("plan: payments fill installments in order regardless of how the rows are listed", () => {
  const e = evaluatePlan([...plan1500].reverse(), 750, "2026-10-20");
  assert.equal(e.rows[0].seq, 1);
  assert.equal(e.rows[0].state, "PAID");
});

test("schedule validation", () => {
  assert.equal(validateSchedule([{ dueDate: "2026-10-27", amount: 750 }, { dueDate: "2026-11-03", amount: 750 }], 1500), null);
  assert.match(validateSchedule([{ dueDate: "2026-10-27", amount: 1500 }], 1500) ?? "", /at least 2/);
  assert.match(validateSchedule([{ dueDate: "2026-10-27", amount: 700 }, { dueDate: "2026-11-03", amount: 700 }], 1500) ?? "", /add up to/);
  assert.match(validateSchedule([{ dueDate: "2026-11-03", amount: 750 }, { dueDate: "2026-10-27", amount: 750 }], 1500) ?? "", /date order/);
  assert.match(validateSchedule([{ dueDate: "2026-10-27", amount: 0 }, { dueDate: "2026-11-03", amount: 1500 }], 1500) ?? "", /more than zero/);
  assert.match(validateSchedule([{ dueDate: "", amount: 750 }, { dueDate: "2026-11-03", amount: 750 }], 1500) ?? "", /Pick a date/);
});

test("splitEvenly: odd centavos go on the first payment and the parts always add up", () => {
  const parts = splitEvenly(1000, 3, "2026-10-27", 7);
  assert.deepEqual(parts.map((p) => p.amount), [333.34, 333.33, 333.33]);
  assert.deepEqual(parts.map((p) => p.dueDate), ["2026-10-27", "2026-11-03", "2026-11-10"]);
  assert.equal(validateSchedule(parts, 1000), null);
  assert.deepEqual(splitEvenly(1500, 2, "2026-10-27", 7).map((p) => p.amount), [750, 750]);
});

test("addDays crosses month and year ends", () => {
  assert.equal(addDays("2026-12-28", 7), "2027-01-04");
  assert.equal(addDays("2026-02-25", 7), "2026-03-04");
});

test("statement: a card on a plan is billed only what's due now, and later installments are announced", () => {
  const input = statement({
    orders: [
      {
        liveTitle: "10/24 live",
        liveDate: "2026-10-24",
        cards: [
          { cardName: "Charizard", amount: 1500, paid: 0, plan: { dueNow: 750, next: { dueDate: "2026-11-03", amount: 750 } } },
          { cardName: "Pikachu", amount: 100, paid: 0 },
        ],
      },
    ],
  });
  const s = computeStatement(input);
  assert.equal(s.cardsDue, 850); // 750 now + the whole 100, NOT 1,500 + 100
  assert.deepEqual(s.upcoming, [{ cardName: "Charizard", amount: 750, dueDate: "2026-11-03" }]);
  const text = buildStatementText(input);
  assert.match(text, /Charizard - ₱750 due now \(installment plan - ₱750 more later\)/);
  assert.match(text, /Pikachu - ₱100/);
  assert.match(text, /Coming up:\n- Charizard: ₱750 on Nov 3/);
  assert.match(text, /TOTAL TO PAY: ₱850/);
});

test("statement: a plan card with nothing due yet isn't billed, just announced", () => {
  const input = statement({
    orders: [{ liveTitle: "L", liveDate: "2026-10-24", cards: [{ cardName: "Charizard", amount: 1500, paid: 750, plan: { dueNow: 0, next: { dueDate: "2026-11-03", amount: 750 } } }] }],
  });
  const s = computeStatement(input);
  assert.equal(s.orders.length, 0);
  assert.equal(s.totalToPay, 0);
  assert.match(buildStatementText(input), /Nothing is due right now[\s\S]*Charizard - ₱750 on Nov 3/);
});

test("statement: an overdue plan card is billed everything that's overdue", () => {
  const s = computeStatement(
    statement({ orders: [{ liveTitle: "L", liveDate: "2026-10-24", cards: [{ cardName: "Charizard", amount: 1500, paid: 0, plan: { dueNow: 1500, next: null } }] }] }),
  );
  assert.equal(s.cardsDue, 1500);
  assert.equal(s.upcoming.length, 0);
});

test("portal: an approved plan shows its schedule, and the pay form pre-fills the installment due, not the whole card", () => {
  const input = portalInput({
    today: "2026-10-27",
    plans: [{ saleId: "ccc", status: "ACTIVE", declineReason: null, installments: [{ seq: 1, dueDate: "2026-10-27", amount: 100 }, { seq: 2, dueDate: "2026-11-03", amount: 100 }] }],
  });
  const v = buildPortalView(input);
  const card = v.lives[1].cards[0];
  assert.equal(card.left, 200);
  assert.equal(card.payNow, 100);
  assert.equal(card.plan?.status, "ACTIVE");
  assert.equal(card.plan?.dueNow, 100);
  assert.deepEqual(card.plan?.installments.map((i) => i.state), ["DUE", "UPCOMING"]);
  // After the first 100 is paid, the next installment is what's pre-filled.
  const paid = buildPortalView({ ...input, payments: [{ customerId: "c1", amount: 100, purpose: "CARDS", liveId: null, allocations: [{ saleId: "ccc", amount: 100 }] }] });
  const after = paid.lives[1].cards[0];
  assert.equal(after.plan?.installments[0].state, "PAID");
  assert.equal(after.payNow, 100);
  assert.equal(after.plan?.paid, 100);
});

test("portal: a pending request shows what was asked, and a declined one shows the reason; neither changes what's owed", () => {
  const requested = buildPortalView(
    portalInput({ plans: [{ saleId: "a", status: "REQUESTED", declineReason: null, installments: [{ seq: 1, dueDate: "2026-10-30", amount: 50 }, { seq: 2, dueDate: "2026-11-06", amount: 50 }] }] }),
  );
  const card = requested.lives[0].cards[0];
  assert.equal(card.plan?.status, "REQUESTED");
  assert.equal(card.payNow, 100); // not an approved plan yet - pay in full as usual
  assert.equal(requested.amountDue, 350);
  const declined = buildPortalView(portalInput({ plans: [{ saleId: "a", status: "DECLINED", declineReason: "Please pay in full", installments: [] }] }));
  assert.equal(declined.lives[0].cards[0].plan?.declineReason, "Please pay in full");
});

const paymentWith = (id: string, customerId: string, amount: number, liveId: string | null = null, allocations: { saleId: string; amount: number }[] = []) => ({
  id,
  customerId,
  amount,
  liveId,
  purpose: "CARDS" as const,
  allocations,
});

test("attribution: automatic payments are traced to the cards they paid, oldest first", () => {
  const sales = [sp("a", "c1", "L1", 500, "A", "1"), sp("b", "c1", "L1", 500, "A", "2")];
  const payments = [paymentWith("p1", "c1", 300), paymentWith("p2", "c1", 400)];
  const attr = attributeCardPayments(sales, payments);
  assert.deepEqual(attr.get("a"), [{ paymentId: "p1", amount: 300 }, { paymentId: "p2", amount: 200 }]);
  assert.deepEqual(attr.get("b"), [{ paymentId: "p2", amount: 200 }]);
});

test("attribution: per-card totals always equal allocateCardPayments, across explicit, live-targeted and automatic payments", () => {
  const sales = [
    sp("old", "c1", "L1", 300, "A", "2026-09-01|1"),
    sp("x", "c1", "L2", 100, "S", "2026-10-01|1"),
    sp("y", "c1", "L2", 200, "A", "2026-10-01|2"),
    sp("z", "c1", "L3", 150, "A", "2026-10-05|1"),
    sp("other", "c2", "L2", 80, "A", "2026-10-01|3"),
  ];
  const payments = [
    paymentWith("p1", "c1", 120, "L2", [{ saleId: "x", amount: 100 }]),
    paymentWith("p2", "c1", 90),
    paymentWith("p3", "c1", 250, "L2"),
    paymentWith("p4", "c1", 70, null, [{ saleId: "z", amount: 70 }]),
    paymentWith("p5", "c2", 80),
  ];
  const paid = allocateCardPayments(sales, payments);
  const attr = attributeCardPayments(sales, payments);
  for (const s of sales) {
    const fromAttr = (attr.get(s.id) ?? []).reduce((n, c) => n + c.amount, 0);
    assert.equal(Math.round(fromAttr * 100) / 100, paid.get(s.id), `card ${s.id}`);
  }
  // No payment is ever credited with more than it was worth.
  for (const p of payments) {
    const used = [...attr.values()].flat().filter((c) => c.paymentId === p.id).reduce((n, c) => n + c.amount, 0);
    assert.ok(used <= p.amount + 0.001, `payment ${p.id} used ${used} of ${p.amount}`);
  }
});

test("attribution: taking one card back and freezing the rest keeps every other card paid (the 'Unpaid' guarantee)", () => {
  // Two automatic payments paid cards A (oldest) then B. Un-paying A must NOT let B's money slide back onto A.
  const sales = [sp("a", "c1", "L", 500, "A", "1"), sp("b", "c1", "L", 500, "A", "2")];
  const payments = [paymentWith("p1", "c1", 500), paymentWith("p2", "c1", 500)];
  const attr = attributeCardPayments(sales, payments);

  // What the action does: freeze every OTHER card's coverage as explicit allocations, then remove A's share from its payments.
  const frozen = [...attr.entries()].filter(([saleId]) => saleId !== "a").flatMap(([saleId, list]) => list.map((c) => ({ paymentId: c.paymentId, saleId, amount: c.amount })));
  const reductions = new Map((attr.get("a") ?? []).map((c) => [c.paymentId, c.amount]));
  const after = payments
    .map((p) => ({ ...p, amount: p.amount - (reductions.get(p.id) ?? 0), allocations: frozen.filter((f) => f.paymentId === p.id).map((f) => ({ saleId: f.saleId, amount: f.amount })) }))
    .filter((p) => p.amount > 0);

  const paidAfter = allocateCardPayments(sales, after);
  assert.equal(paidAfter.get("a"), 0); // A is unpaid again
  assert.equal(paidAfter.get("b"), 500); // B did not lose its payment, and A did not steal it
});
