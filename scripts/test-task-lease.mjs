// Offline CAS contract tests. Optional PostgreSQL integration: TEST_DATABASE_URL=... npm run test:compute:lease:db
import assert from "node:assert/strict";
import { test } from "node:test";
import { acquireTaskLease, releaseTaskLease } from "../src/lib/task-lease.ts";

function memoryStore() {
  const rows = new Map();
  return {
    rows,
    encode: (s) => `enc:${crypto.randomUUID()}|${s}`,
    decode: (s) => { if (!s.startsWith("enc:")) throw Error("bad ciphertext"); return s.slice(s.indexOf("|") + 1); },
    read: async (key) => rows.get(key) ?? null,
    create: async (key, value) => {
      if (rows.has(key)) return false;
      rows.set(key, { value, updatedAt: new Date(1000) }); return true;
    },
    compareAndSet: async (key, expected, value) => {
      if (rows.get(key)?.value !== expected) return false;
      rows.set(key, { value, updatedAt: new Date(1000) }); return true;
    },
  };
}

test("concurrent missing/existing lock: exactly one owner wins", async () => {
  const store = memoryStore();
  for (const time of [1000, 3000]) {
    const attempts = await Promise.all(Array.from({ length: 20 }, () => acquireTaskLease(store, "planner", 1000, time)));
    assert.equal(attempts.filter(Boolean).length, 1);
  }
});

test("old owner cannot release a successor after expiry", async () => {
  const store = memoryStore();
  const old = await acquireTaskLease(store, "planner", 1000, 1000);
  assert.equal(await acquireTaskLease(store, "planner", 1000, 1500), null);
  const next = await acquireTaskLease(store, "planner", 1000, 2000);
  await releaseTaskLease(store, old);
  assert.equal(store.rows.get("planner").value, next.value);
  await releaseTaskLease(store, next);
  assert.ok(await acquireTaskLease(store, "planner", 1000, 2001));
});

test("legacy timestamp and corrupt lock recover conservatively", async () => {
  const store = memoryStore();
  store.rows.set("legacy", { value: store.encode(new Date(1000).toISOString()), updatedAt: new Date(1000) });
  assert.equal(await acquireTaskLease(store, "legacy", 1000, 1999), null);
  assert.ok(await acquireTaskLease(store, "legacy", 1000, 2000));
  store.rows.set("bad", { value: "broken", updatedAt: new Date(1000) });
  assert.equal(await acquireTaskLease(store, "bad", 1000, 1999), null);
  assert.ok(await acquireTaskLease(store, "bad", 1000, 2000));
});

test("database read/CAS errors propagate: caller must not run task", async () => {
  const store = memoryStore();
  store.read = async () => { throw Error("offline"); };
  await assert.rejects(acquireTaskLease(store, "x", 1000), /offline/);
  const existing = memoryStore();
  existing.rows.set("x", { value: existing.encode(new Date(0).toISOString()), updatedAt: new Date(0) });
  existing.compareAndSet = async () => { throw Error("offline"); };
  await assert.rejects(acquireTaskLease(existing, "x", 1000), /offline/);
});
