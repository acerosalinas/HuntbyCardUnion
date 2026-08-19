import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// This test proves the core safety property of the claim/queue system: when
// several buyers hit the same AVAILABLE card at once, exactly one wins and
// everyone else lands in the queue - never zero winners, never two.
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

test(
  "place_order: N concurrent claims on one card yield exactly one winner",
  { skip: !configured && "SUPABASE_TEST_* env vars not set - see tests/integration/concurrency.test.ts" },
  async () => {
    const admin = createClient(TEST_URL!, TEST_SERVICE_ROLE_KEY!);

    const { data: card, error: insertError } = await admin
      .from("cards")
      .insert({
        title: "Concurrency Test Card",
        set_name: "Test",
        price: 100,
        condition_grade: "Raw NM",
        seller_handle: "@test",
        seller_messenger: "test",
        franchise: "pokemon",
      })
      .select()
      .single();
    assert.equal(insertError, null, insertError?.message);

    const buyerCount = 5;
    const buyerIds: string[] = [];
    const buyerClients: SupabaseClient[] = [];
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
        buyerClients.map((client) => client.rpc("place_order", { p_card_ids: [card.id] })),
      );

      for (const r of results) {
        assert.equal(r.error, null, r.error?.message);
      }

      const outcomes = results.map((r) => (r.data as { items: { result: string }[] }).items[0].result);
      const claimedCount = outcomes.filter((o) => o === "claimed").length;
      const queuedCount = outcomes.filter((o) => o === "queued").length;

      assert.equal(claimedCount, 1, `expected exactly 1 winner, got ${claimedCount}`);
      assert.equal(queuedCount, buyerCount - 1, `expected ${buyerCount - 1} queued, got ${queuedCount}`);

      const { data: finalCard } = await admin.from("cards").select("*").eq("id", card.id).single();
      assert.equal(finalCard!.status, "PENDING");
      assert.ok(buyerIds.includes(finalCard!.claimant_id));

      const { data: queueRows } = await admin
        .from("dibs_queue")
        .select("*")
        .eq("card_id", card.id)
        .eq("status", "WAITING");
      assert.equal(queueRows!.length, buyerCount - 1);
    } finally {
      const { data: cardBeforeDelete } = await admin
        .from("cards")
        .select("order_id")
        .eq("id", card.id)
        .single();
      await admin.from("cards").delete().eq("id", card.id);
      if (cardBeforeDelete?.order_id) {
        await admin.from("orders").delete().eq("id", cardBeforeDelete.order_id);
      }
      for (const id of buyerIds) {
        await admin.auth.admin.deleteUser(id);
      }
    }
  },
);
