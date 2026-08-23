import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// This test proves the core safety property of the claim/queue system: when
// several buyers hit the same card's limited stock at once, the sum of
// units successfully claimed never exceeds the card's total quantity - never
// oversold, and every individual claim is fully satisfied or fully queued
// (never partially fulfilled).
//
// It runs against a real Supabase project (RPC concurrency can't be
// meaningfully faked with mocks), so it needs its own TEST project - never
// point it at production. Configure SUPABASE_TEST_URL,
// SUPABASE_TEST_ANON_KEY, and SUPABASE_TEST_SERVICE_ROLE_KEY (in .env.test,
// or the environment) to enable it; otherwise it skips cleanly.
//
// place_order() identifies the buyer via auth.uid(), not a client-supplied
// handle - so each concurrent "buyer" needs its own signed-in session
// (a single shared anon client can't represent 5 different people at once).

const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY;
const TEST_SERVICE_ROLE_KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const configured = Boolean(TEST_URL && TEST_ANON_KEY && TEST_SERVICE_ROLE_KEY);

const STOCK = 3;
// Sums to 9 against 3 units of stock - deliberately more demand than supply,
// with varying per-buyer request sizes, so no fixed winner set is possible.
const REQUESTED_QUANTITIES = [1, 2, 2, 1, 3];

test(
  "place_order: concurrent claims against limited stock never oversell and never partially fulfil",
  { skip: !configured && "SUPABASE_TEST_* env vars not set - see tests/integration/concurrency.test.ts" },
  async () => {
    const admin = createClient(TEST_URL!, TEST_SERVICE_ROLE_KEY!);

    const { data: card, error: insertError } = await admin
      .from("cards")
      .insert({
        title: "Concurrency Test Card",
        set_name: "Test",
        price: 100,
        list_price: 100,
        condition_grade: "Raw NM",
        seller_handle: "@test",
        seller_messenger: "test",
        franchise: "pokemon",
        quantity: STOCK,
        quantity_available: STOCK,
      })
      .select()
      .single();
    assert.equal(insertError, null, insertError?.message);

    const buyerCount = REQUESTED_QUANTITIES.length;
    const buyerIds: string[] = [];
    const buyerClients: SupabaseClient[] = [];
    const orderIds = new Set<string>();
    const runId = Date.now();

    try {
      for (let i = 0; i < buyerCount; i++) {
        const email = `concurrency-test-buyer-${i}-${runId}@example.com`;
        const password = "test-password-1234";
        const handle = `@conc_test_${i}_${runId}`;

        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { handle, full_name: `Test Buyer ${i}` },
        });
        assert.equal(createError, null, createError?.message);
        buyerIds.push(created.user!.id);

        const client = createClient(TEST_URL!, TEST_ANON_KEY!);
        const { error: signInError } = await client.auth.signInWithPassword({ email, password });
        assert.equal(signInError, null, signInError?.message);
        buyerClients.push(client);
      }

      const results = await Promise.all(
        buyerClients.map((client, i) =>
          client.rpc("place_order", {
            p_items: [{ card_id: card.id, quantity: REQUESTED_QUANTITIES[i] }],
            p_ship_name: `Test Buyer ${i}`,
            p_ship_phone: "09170000000",
            p_ship_address: "",
            p_ship_zip: "",
            p_fulfillment_method: "STASH",
          }),
        ),
      );

      for (const r of results) {
        assert.equal(r.error, null, r.error?.message);
      }

      const outcomes = results.map((r, i) => {
        const parsed = r.data as { orderId: string | null; items: { result: string; quantity?: number }[] };
        if (parsed.orderId) orderIds.add(parsed.orderId);
        const item = parsed.items[0];
        return { result: item.result, quantity: item.quantity ?? REQUESTED_QUANTITIES[i], requested: REQUESTED_QUANTITIES[i] };
      });

      // Never partially fulfilled - every outcome's quantity matches exactly
      // what that buyer asked for, whether claimed or queued.
      for (const o of outcomes) {
        assert.equal(o.quantity, o.requested, `expected quantity ${o.requested}, got ${o.quantity}`);
      }

      const claimed = outcomes.filter((o) => o.result === "claimed");
      const queued = outcomes.filter((o) => o.result === "queued");
      assert.equal(claimed.length + queued.length, buyerCount, "every buyer should either claim or queue");

      const claimedTotal = claimed.reduce((sum, o) => sum + o.quantity, 0);
      assert.ok(claimedTotal <= STOCK, `oversold: claimed ${claimedTotal} units against ${STOCK} in stock`);

      const { data: finalCard } = await admin
        .from("cards")
        .select("quantity, quantity_available, status")
        .eq("id", card.id)
        .single();
      assert.equal(finalCard!.quantity_available, STOCK - claimedTotal);
      assert.equal(finalCard!.status, finalCard!.quantity_available > 0 ? "AVAILABLE" : "SOLD");

      const { data: claimRows } = await admin
        .from("card_claims")
        .select("quantity, buyer_id")
        .eq("card_id", card.id)
        .eq("status", "PENDING");
      assert.equal(claimRows!.length, claimed.length);
      assert.equal(
        claimRows!.reduce((sum, r) => sum + r.quantity, 0),
        claimedTotal,
      );
      for (const row of claimRows!) {
        assert.ok(buyerIds.includes(row.buyer_id));
      }

      const { data: queueRows } = await admin
        .from("dibs_queue")
        .select("requested_quantity")
        .eq("card_id", card.id)
        .eq("status", "WAITING");
      assert.equal(queueRows!.length, queued.length);
    } finally {
      // card_claims/dibs_queue rows cascade-delete with the card.
      await admin.from("cards").delete().eq("id", card.id);
      for (const orderId of orderIds) {
        await admin.from("orders").delete().eq("id", orderId);
      }
      for (const id of buyerIds) {
        await admin.auth.admin.deleteUser(id);
      }
    }
  },
);
