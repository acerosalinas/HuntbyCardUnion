import { test } from "node:test";
import assert from "node:assert/strict";
import { selectIn } from "../../lib/chunkedIn";

test("a long id list is looked up in batches and the results are joined", async () => {
  const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
  const sizes: number[] = [];
  const rows = await selectIn<{ id: string }>(ids, async (batch) => {
    sizes.push(batch.length);
    return { data: batch.map((id) => ({ id })), error: null };
  });
  assert.deepEqual(sizes, [100, 100, 50]);
  assert.equal(rows.length, 250);
});

test("duplicates are looked up once, and nothing is asked when there are no ids", async () => {
  let calls = 0;
  const run = async (b: string[]) => {
    calls++;
    return { data: b.map((id) => ({ id })), error: null };
  };
  assert.equal((await selectIn(["a", "a", "b"], run)).length, 2);
  assert.equal((await selectIn([], run)).length, 0);
  assert.equal(calls, 1);
});

test("a failed batch is an error, never silently empty", async () => {
  await assert.rejects(selectIn(["a"], async () => ({ data: null, error: { message: "Bad Request" } })), /Bad Request/);
});
