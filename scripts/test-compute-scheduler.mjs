// Real scheduler module, mocked IO only. No .env, DB, servers or external API calls.
import assert from "node:assert/strict";
import path from "node:path";
import { loadTsModule } from "./lib/load-ts-module.mjs";
const file = path.resolve("src/lib/scheduler.ts");
const root = path.resolve("src/lib");
let due = [], lockWrites = 0, refreshed = 0, metrics = 0;
const settings = new Map();
const prisma = {
  appSetting: {
    findUnique: async ({ where }) => settings.get(where.key) ?? null,
    create: async ({ data }) => {
      lockWrites++;
      if (settings.has(data.key)) throw Object.assign(Error("unique"), { code: "P2002" });
      settings.set(data.key, { ...data, updatedAt: new Date() }); return data;
    },
    updateMany: async ({ where, data }) => {
      lockWrites++;
      if (settings.get(where.key)?.value !== where.value) return { count: 0 };
      settings.set(where.key, { ...settings.get(where.key), ...data }); return { count: 1 };
    },
  },
};
const noop = async () => {};
const api = await loadTsModule(file, {
  allowedFiles: [file, path.join(root, "autopilot-plan.ts")],
  globals: { process: { env: {} } },
  stubs: {
    "server-only": {}, "@/lib/prisma": { prisma },
    "./notify": Object.fromEntries(["notify", "notifyAdmins", "notifyAdminsOncePer", "notifyMany", "notifyOncePer"].map((key) => [key, noop])),
    "@/lib/deliver": { buildMessage: () => "", deliverToFacebook: noop },
    "@/lib/settings": { encryptValue: (v) => `enc:${crypto.randomUUID()}|${v}`, decryptValue: (v) => v.slice(v.indexOf("|") + 1), getSetting: noop, setSetting: noop },
    "./task-lease": await import("../src/lib/task-lease.ts"),
    "./task-metrics": { startTaskMetrics: () => () => { metrics++; } },
    "@/lib/posts": { attachedFromDbMedia: () => {}, validateAttachments: () => ({ ok: true }) },
    "./fb-insights": {
      pagesDueForInsights: async () => due,
      MAX_API_CALLS_PER_RUN: 60,
      refreshInsightsForPage: async () => { refreshed++; due = []; return { updated: 2 }; },
    },
  },
});
await api.runInsightsRefreshTask();
assert.equal(lockWrites, 0); assert.equal(refreshed, 0);
console.log("PASS insights with no due work writes no locks and calls no Graph service");
due = ["offline-page"];
await api.runInsightsRefreshTask({ at: Date.now() - 1 });
assert.equal(lockWrites, 0); assert.equal(refreshed, 0);
console.log("PASS insufficient budget does not acquire lock or refresh");
await Promise.all([api.runInsightsRefreshTask(), api.runInsightsRefreshTask()]);
assert.equal(refreshed, 1); assert.equal(lockWrites, 3); // two create attempts, winner releases
console.log("PASS two concurrent Insights tasks: one refresh; losing create does not run heavy work");
assert.equal(metrics, 4);
console.log("PASS task metrics recorded for work and skipped runs");
