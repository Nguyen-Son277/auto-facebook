// Explicit, isolated PostgreSQL test only. Never reads .env or DATABASE_URL.
// Run with TEST_DATABASE_URL and COMPUTE_TEST_DB_CONFIRMED=1 after provisioning a test DB.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { acquireTaskLease, releaseTaskLease } from "../src/lib/task-lease.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url || process.env.COMPUTE_TEST_DB_CONFIRMED !== "1") {
  console.log("SKIP: set TEST_DATABASE_URL and COMPUTE_TEST_DB_CONFIRMED=1 for a dedicated test database. No DB was opened.");
  process.exit(0);
}
if (url === process.env.DATABASE_URL) throw Error("Refusing DATABASE_URL: use a separate test database.");
const pool = new pg.Pool({ connectionString: url, max: 8 });
const table = `compute_lease_test_${randomUUID().replaceAll("-", "")}`;
try {
  // Isolated table, no application table/data access.
  await pool.query(`CREATE TABLE "${table}" (key text PRIMARY KEY, value text NOT NULL, "updatedAt" timestamptz NOT NULL DEFAULT now())`);
  const store = {
    encode: (v) => `${randomUUID()}|${v}`,
    decode: (v) => v.slice(v.indexOf("|") + 1),
    read: async (key) => (await pool.query(`SELECT value, "updatedAt" FROM "${table}" WHERE key=$1`, [key])).rows[0] ?? null,
    create: async (key, value) => (await pool.query(`INSERT INTO "${table}" (key,value) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [key,value])).rowCount === 1,
    compareAndSet: async (key, expected, value) => (await pool.query(`UPDATE "${table}" SET value=$3, "updatedAt"=now() WHERE key=$1 AND value=$2`, [key,expected,value])).rowCount === 1,
  };
  const acquire = (time) => Promise.all(Array.from({ length: 20 }, () => acquireTaskLease(store, "planner", 1000, time)));
  const first = (await acquire(1000)).filter(Boolean);
  assert.equal(first.length, 1);
  assert.equal((await acquire(1500)).filter(Boolean).length, 0);
  const next = (await acquire(2000)).filter(Boolean);
  assert.equal(next.length, 1);
  await releaseTaskLease(store, first[0]);
  assert.equal((await store.read("planner")).value, next[0].value);
  await releaseTaskLease(store, next[0]);
  assert.ok(await acquireTaskLease(store, "planner", 1000, 2001));
  console.log("PASS: PostgreSQL concurrent create/CAS, expiry and stale-owner release.");
} finally {
  // Table identifier was generated locally from UUID, never from environment/user input.
  await pool.query(`DROP TABLE IF EXISTS "${table}"`);
  await pool.end();
}
