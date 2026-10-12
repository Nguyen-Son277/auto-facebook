// Non-production, offline application tests + full-queue microbenchmark.
// Run: node --experimental-vm-modules scripts/test-compute-planner.mjs
// Optional: --tests-only; --bench-iterations=500 --bench-samples=5
// Only real planner TS files are evaluated; every IO/service boundary is mocked.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { loadTsModule } from "./lib/load-ts-module.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const autopilot = path.join(root, "src/lib/autopilot.ts");
const demandFile = path.join(root, "src/lib/planner-demand.ts");
const planFile = path.join(root, "src/lib/autopilot-plan.ts");
const now = new Date("2026-10-12T00:00:00.000Z"); // Monday 07:00 Vietnam.
const DAY = 86_400_000;
const TTL_HOURS = 24; // Deliberate stub of insights-core's service boundary constant.
const clean = (value) => JSON.parse(JSON.stringify(value));
const args = process.argv.slice(2);
const argument = (name, fallback) => Number(args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
function config(overrides = {}) {
  return {
    id: "autopilot-1", userId: "offline-user", pageId: "page-1", enabled: true,
    mode: "AUTO", postsPerDay: 3, windowStart: "09:00", windowEnd: "21:00",
    daysOfWeek: "1,2,3,4,5,6,7", minGapMinutes: 60, autoMedia: true,
    mediaPrimary: "PEXELS", mediaFallback: false, mediaKind: "IMAGE",
    mediaMix: "IMAGE_ONLY", videoPercent: 25, photosPerPost: 1,
    length: "medium", toneOverride: "friendly", useHashtags: true,
    planAheadDays: 7, startDate: null, lastPlannedAt: null, lastPlanError: null,
    lastPlanCount: 9, totalPlanned: 90, insightsEnabled: true, learningPhase: "EXPLOIT",
    lastReProbeAt: null, probeStartedAt: new Date(now.getTime() - DAY * 10),
    learningComputedAt: new Date(now.getTime() - 60_000), updatedAt: new Date(now.getTime() - DAY),
    page: { name: "Offline test page", isActive: true }, ...overrides,
  };
}
function fullQueue(configs) {
  return configs.flatMap((c) => Array.from({ length: c.planAheadDays }, (_, day) =>
    Array.from({ length: c.postsPerDay }, (_, slot) => ({
      id: `${c.pageId}-${day}-${slot}`, pageId: c.pageId, origin: "AUTOPILOT",
      status: "SCHEDULED", scheduledAt: new Date(now.getTime() + day * DAY + 3 * 3_600_000),
      publishedAt: null, pillarName: "Guides", topic: `Old topic ${slot}`, serviceArea: "Area A", content: "Product A guide",
    }))).flat());
}
function matches(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return expected.some((branch) => matches(row, branch));
    if (key === "media") return false; // Fixture has no video/media records.
    const actual = row[key];
    if (expected instanceof Date) return actual?.getTime() === expected.getTime();
    if (expected && typeof expected === "object") return Object.entries(expected).every(([op, value]) => {
      if (op === "in") return value.includes(actual);
      if (op === "gte") return actual != null && actual >= value;
      if (op === "lt") return actual != null && actual < value;
      if (op === "not") return actual !== value;
      throw new Error(`Unsupported offline where operator: ${op}`);
    });
    return actual === expected;
  });
}
function fixture({ configs = [config()], posts = fullQueue(configs), latestInsight = null, capture = true, raceDuplicate = false } = {}) {
  const calls = {}, trace = [], created = [], updates = [], aiInputs = [];
  const count = (name, input) => {
    calls[name] = (calls[name] ?? 0) + 1;
    if (capture) trace.push({ name, input: clean(input ?? null) });
  };
  const wrap = (name, fn) => async (...input) => { count(name, input); return fn(...input); };
  const query = ({ where, select, take } = {}) => {
    let rows = posts.filter((p) => matches(p, where));
    if (take) rows = rows.slice(0, take);
    return rows.map((p) => select ? Object.fromEntries(Object.keys(select).map((key) => [key, p[key] ?? null])) : p);
  };
  const models = {
    autoPilot: {
      findMany: wrap("autoPilot.findMany", () => configs),
      update: wrap("autoPilot.update", (input) => { if (capture) updates.push(clean(input)); return {}; }),
    },
    facebookPage: { findUnique: wrap("facebookPage.findUnique", () => ({ name: "Offline test page", isActive: true, workspaceId: "offline-workspace", brandId: "offline-brand" })) },
    brandDriveFolder: { findUnique: wrap("brandDriveFolder.findUnique", () => null) },
    driveConnection: { findUnique: wrap("driveConnection.findUnique", () => null) },
    media: { count: wrap("media.count", () => 0), create: wrap("media.create", () => ({})) },
    contentPillar: { findMany: wrap("contentPillar.findMany", () => [
      { id: "pillar-1", name: "Guides", description: "Useful guides", weight: 50, position: 0, goal: "engagement" },
      { id: "pillar-2", name: "Offers", description: "Useful offers", weight: 50, position: 1, goal: "engagement" },
    ]) },
    brandProfile: { findUnique: wrap("brandProfile.findUnique", () => ({ serviceAreas: "Area A\nArea B", description: "Offline business", products: "Product A\nProduct B" })) },
    probeEntry: { findMany: wrap("probeEntry.findMany", () => []), upsert: wrap("probeEntry.upsert", () => ({})) },
    usedMedia: { findMany: wrap("usedMedia.findMany", () => []), upsert: wrap("usedMedia.upsert", () => ({})) },
    postInsight: { findFirst: wrap("postInsight.findFirst", () => latestInsight) },
    post: {
      findMany: wrap("post.findMany", query),
      count: wrap("post.count", (input) => query(input).length),
      findFirst: wrap("post.findFirst", (input) => raceDuplicate ? { id: "concurrent-post" } : query(input)[0] ?? null),
      create: wrap("post.create", ({ data }) => {
        const row = { id: `new-${created.length + 1}`, publishedAt: null, ...data };
        posts.push(row); created.push(clean(row)); return row;
      }),
    },
  };
  // Unknown models/methods fail closed rather than reaching a real Prisma client.
  const prisma = new Proxy(models, { get(target, key) {
    if (!(key in target)) throw new Error(`Unexpected offline Prisma model ${String(key)}`);
    return new Proxy(target[key], { get(model, method) {
      if (!(method in model)) throw new Error(`Unexpected offline Prisma call ${String(key)}.${String(method)}`);
      return model[method];
    } });
  } });
  const service = (name, fn = () => undefined) => (...input) => { count(name, input); return fn(...input); };
  const stubs = {
    "server-only": {}, "./prisma": { prisma },
    "./settings": { userHasAiConfig: wrap("settings.ai", () => true), userHasPexelsKey: wrap("settings.pexels", () => true) },
    "./brand": {
      resolvePageBrand: wrap("brand.resolve", () => ({ brandId: "offline-brand" })),
      contentScopeForPage: service("brand.scope", (brandId) => ({ brandId })),
      loadBrandContext: wrap("brand.context", () => ({ industry: "Offline", products: "Product A\nProduct B", baseHashtags: "#Base #AI" })),
    },
    "./brand-scope": { minimalProfileProblem: ({ hasDescription, hasProducts }) => hasDescription && hasProducts ? null : "Incomplete profile" },
    "./format-date": { formatDateTime: (d) => d.toISOString() },
    "./ai": {
      AI_CALL_TIMEOUT_MS: 35_000,
      generatePostVariants: wrap("ai.generate", (input, options) => {
        aiInputs.push(clean({ input, options }));
        return { ok: true, variants: [{ content: `${input.brand.focusProduct} offline content`, hook: "Offline hook", hashtags: "#AI #Base", angle: "Offline angle" }] };
      }),
      suggestMediaKeywords: wrap("ai.keywords", () => ({ ok: true, keywords: [{ query: "offline" }] })),
    },
    "./ai-prompts": { GOALS: [{ value: "engagement" }], TONES: [{ value: "friendly" }], LENGTHS: [{ value: "medium" }], parseBrandProducts: (s) => s?.split("\n") ?? [] },
    "./notify": { notify: wrap("notify", () => undefined), notifyOncePer: wrap("notifyOncePer", () => undefined) },
    "./pexels": { MAX_PER_PAGE: 24, hasPexelsBudget: service("pexels.budget", () => true), getPexelsQuota: service("pexels.quota", () => ({ remaining: 100 })), searchMedia: wrap("pexels.search", () => ({ ok: true, items: [{ id: "offline-photo", type: "IMAGE", remoteUrl: "https://offline.invalid/image", previewUrl: "", width: 1600 }] })) },
    "./media-source": { blockerMessage: () => "Offline media blocked", fallbackNotice: () => null, mediaCandidates: service("media.candidates", () => ["PEXELS"]), noSourceReason: () => "Offline no source" },
    "./learning-cycle": { isExplorationSlot: () => false, pickProbeHint: () => null },
    "./insights-core": { LEARNING_SUMMARY_TTL_HOURS: TTL_HOURS, bandOfDate: () => "SANG" },
    "./insight-optimize": {
      computeLearningState: wrap("learning.compute", () => ({ phase: "EXPLOIT", probePlan: { batchId: "old-probe" }, explorePlan: { batchId: "old-explore" }, totalPublishedAutoPilot: 10, probePostsSoFar: 0, explorationRate: 0, hookSuggestion: { style: "QUESTION" }, performanceLines: ["Offline performance"], timeBias: null })),
      effectivePillars: (pillars) => pillars, exploitHookLines: () => ["Offline hook instruction"], optimizationNoteOf: () => "Offline optimization",
      probePromptLines: () => [], winningTopicLines: () => ["Offline winning topic"],
      runVerifier: wrap("learning.verify", () => ({ phaseChanged: false })),
    },
  };
  return { stubs, calls, trace, created, updates, aiInputs, configs, posts, resetCounts() { for (const key of Object.keys(calls)) delete calls[key]; } };
}
function baselineSource() {
  return execFileSync("git", ["show", "HEAD:src/lib/autopilot.ts"], { cwd: root, encoding: "utf8", maxBuffer: 5_000_000 });
}
async function load(f, version = "working") {
  return loadTsModule(autopilot, { allowedFiles: [autopilot, demandFile, planFile], stubs: f.stubs,
    sources: version === "baseline" ? { [autopilot]: baselineSource() } : {} });
}
function noHeavyCalls(f, { verifier = false } = {}) {
  const allowed = new Set(["autoPilot.findMany", "post.findMany", "postInsight.findFirst", ...(verifier ? ["learning.verify"] : [])]);
  assert.deepEqual(Object.keys(f.calls).filter((key) => !allowed.has(key)), []);
}
async function tests() {
  let passed = 0;
  async function test(name, body) { await body(); passed++; console.log(`PASS ${name}`); }
  await test("loadPlanningDemand batches exact OR/status/page projection; full queue is empty", async () => {
    const f = fixture(), api = await load(f);
    assert.deepEqual(clean(await api.loadPlanningDemand(f.configs[0], now)), []);
    assert.deepEqual(f.calls, { "post.findMany": 1 });
    const query = f.trace[0].input[0];
    assert.deepEqual(query.select, { scheduledAt: true, publishedAt: true });
    assert.equal(query.where.pageId, "page-1"); assert.equal(query.where.origin, "AUTOPILOT");
    assert.deepEqual(query.where.status.in, ["PENDING_REVIEW", "SCHEDULED", "PUBLISHING", "PUBLISHED"]);
    assert.deepEqual(query.where.OR, [
      { scheduledAt: { gte: "2026-10-11T17:00:00.000Z", lt: "2026-10-18T17:00:00.000Z" } },
      { publishedAt: { gte: "2026-10-11T17:00:00.000Z", lt: "2026-10-18T17:00:00.000Z" } },
    ]);
  });
  await test("planForAutoPilot full queue returns before media/brand/learning/AI/writes; preserves budget/config", async () => {
    const f = fixture(), api = await load(f), budget = { remaining: 12 }, before = clean(f.configs);
    const outcome = await api.planForAutoPilot(f.configs[0], now, "Offline test page", budget, () => 0);
    assert.equal(outcome.created, 0); assert.equal(outcome.skipped, 0);
    assert.deepEqual(f.calls, { "post.findMany": 1 }); assert.equal(budget.remaining, 12);
    assert.deepEqual(clean(f.configs), before);
  });
  await test("runAutopilotPlanner full queue keeps count metadata and avoids heavy work/writes", async () => {
    const f = fixture(), api = await load(f), before = clean(f.configs);
    const result = await api.runAutopilotPlanner(now, () => 0);
    assert.equal(result.pages.length, 1); assert.equal(result.created, 0); assert.equal(result.skipped, 0);
    assert.equal(f.calls["post.findMany"], 1); assert.equal(f.calls["learning.verify"] ?? 0, 0);
    noHeavyCalls(f); assert.deepEqual(clean(f.configs), before); assert.deepEqual(f.updates, []);
  });
  await test("no enabled days performs zero post reads and no heavy work or planning writes", async () => {
    const f = fixture({ configs: [config({ planAheadDays: 1, daysOfWeek: "2", insightsEnabled: false })], posts: [] });
    const api = await load(f);
    assert.deepEqual(clean(await api.loadPlanningDemand(f.configs[0], now)), []);
    assert.deepEqual(f.calls, {});
    const outcome = await api.planForAutoPilot(f.configs[0], now, "Offline test page", { remaining: 12 }, () => 0);
    assert.equal(outcome.created, 0); assert.deepEqual(f.calls, {});
    const result = await api.runAutopilotPlanner(now, () => 0);
    assert.equal(result.pages.length, 1); assert.deepEqual(f.calls, { "autoPilot.findMany": 1 });
  });
  for (const reason of ["new insight", "expired TTL", "never computed"]) {
    await test(`full queue still invokes verifier for ${reason} without planning context/writes`, async () => {
      const c = config({ learningComputedAt: reason === "never computed" ? null : new Date(now.getTime() - (reason === "expired TTL" ? TTL_HOURS * 3_600_000 + 1 : 60_000)) });
      const f = fixture({ configs: [c], latestInsight: reason === "new insight" ? { fetchedAt: new Date(now.getTime() - 1) } : null }), api = await load(f);
      await api.runAutopilotPlanner(now, () => 0);
      assert.equal(f.calls["learning.verify"], 1); noHeavyCalls(f, { verifier: true });
      assert.equal(f.calls["postInsight.findFirst"] ?? 0, reason === "new insight" ? 1 : 0);
      assert.deepEqual(f.updates, []); assert.equal(f.calls["learning.compute"] ?? 0, 0);
    });
  }
  await test("missing slots create correct posts/media, AI inputs and count writes equal HEAD baseline", async () => {
    const outputs = [];
    for (const version of ["baseline", "working"]) {
      const c = config({ planAheadDays: 1, postsPerDay: 3, insightsEnabled: false });
      const posts = fullQueue([c]).slice(0, 1); // Existing 10:00 VN; deterministic new slots 09:00 and 13:00.
      const f = fixture({ configs: [c], posts }), api = await load(f, version), before = clean(c);
      const result = await api.runAutopilotPlanner(now, () => 0);
      assert.equal(result.created, 2); assert.equal(result.skipped, 0); assert.equal(f.calls["ai.generate"], 2);
      assert.equal(f.calls["media.create"], 2); assert.equal(f.calls["autoPilot.update"], 1);
      assert.deepEqual(clean(c), before);
      assert.deepEqual(f.created.map((p) => p.scheduledAt), ["2026-10-12T02:00:00.000Z", "2026-10-12T06:00:00.000Z"]);
      for (const post of f.created) {
        assert.equal(post.status, "SCHEDULED"); assert.equal(post.origin, "AUTOPILOT");
        assert.equal(post.workspaceId, "offline-workspace"); assert.equal(post.brandId, "offline-brand");
        assert.equal(post.hashtags, "#AI #Base"); assert.equal(post.probeKind, "STANDARD");
      }
      assert.deepEqual(f.updates[0].data, { lastPlannedAt: now.toISOString(), lastPlanError: null, lastPlanCount: 2, totalPlanned: { increment: 2 } });
      assert.equal(f.aiInputs[0].input.brand.focusProduct, "Product B");
      assert.equal(f.aiInputs[0].input.brand.serviceArea, "Area B");
      assert.equal(f.aiInputs[0].input.recentTopics[0], "Old topic 0");
      outputs.push({ created: f.created, ai: f.aiInputs, updates: f.updates, result: clean(result) });
    }
    assert.deepEqual(outputs[1], outputs[0]);
  });
  await test("full old Pages cannot spend verifier budget before a Page with demand", async () => {
    const full = config({ pageId: "full", lastPlannedAt: null, learningComputedAt: null });
    const missing = config({ id: "missing-auto", pageId: "missing", planAheadDays: 1, postsPerDay: 1,
      insightsEnabled: false, autoMedia: false, lastPlannedAt: new Date(now.getTime() - 1000) });
    const f = fixture({ configs: [full, missing], posts: fullQueue([full]) });
    const api = await load(f);
    await api.runAutopilotPlanner(now, () => 0, { deadline: { at: Date.now() + 30000 } });
    const creation = f.trace.findIndex((call) => call.name === "ai.generate");
    const verification = f.trace.findIndex((call) => call.name === "learning.verify");
    assert.ok(creation >= 0);
    assert.ok(verification > creation, "new posts must get budget before full-queue learning");
    assert.equal(f.created[0].pageId, "missing");
  });
  await test("one Page preflight failure does not stop remaining Pages", async () => {
    const configs = [config(), config({ id: "autopilot-2", pageId: "page-2" })];
    const f = fixture({ configs });
    const original = f.stubs["./prisma"].prisma.post.findMany;
    // Replace the fixture model method through its underlying proxy target.
    f.stubs["./prisma"].prisma.post.findMany = async (query) => {
      if (query.where.pageId === "page-1") throw new Error("offline preflight");
      return original(query);
    };
    const api = await load(f);
    const result = await api.runAutopilotPlanner(now, () => 0);
    assert.equal(result.pages.length, 2);
    assert.match(result.pages[0].error, /offline preflight/);
    assert.equal(result.pages[1].error, undefined);
    assert.equal(f.calls["ai.generate"] ?? 0, 0);
  });
  await test("racing duplicate slot never invokes AI or creates post", async () => {
    const f = fixture({ configs: [config({ planAheadDays: 1, postsPerDay: 1, insightsEnabled: false, autoMedia: false })], posts: [], raceDuplicate: true });
    const api = await load(f), result = await api.runAutopilotPlanner(now, () => 0);
    assert.equal(result.created, 0); assert.equal(result.skipped, 0);
    assert.equal(f.calls["post.findFirst"], 1); assert.equal(f.calls["ai.generate"] ?? 0, 0); assert.deepEqual(f.created, []);
  });
  await test("REAL planner-demand matches per-day OR counts, same-day dedupe and Vietnam date boundary", async () => {
    const api = await loadTsModule(demandFile, { allowedFiles: [demandFile, planFile] });
    const window = api.planningWindow(config({ planAheadDays: 2 }), now);
    const rows = [
      { scheduledAt: new Date("2026-10-11T17:00:00Z"), publishedAt: new Date("2026-10-12T16:59:59Z") },
      { scheduledAt: new Date("2026-10-12T16:59:59Z"), publishedAt: new Date("2026-10-12T17:00:00Z") },
      { scheduledAt: null, publishedAt: new Date("2026-10-13T16:59:59Z") },
      { scheduledAt: new Date("2026-10-11T16:59:59Z"), publishedAt: null },
      { scheduledAt: new Date("2026-10-13T17:00:00Z"), publishedAt: null },
    ];
    const demand = clean(api.demandForWindow(window, rows, 3));
    const oldCounts = Array.from(window.days, (day) => rows.filter((row) => [row.scheduledAt, row.publishedAt].some((d) => d && d >= day && d < new Date(day.getTime() + DAY))).length);
    assert.deepEqual(oldCounts, [2, 2]); assert.deepEqual(demand.map((d) => d.existing), oldCounts);
    assert.deepEqual(demand.map((d) => d.needed), [1, 1]); assert.deepEqual(demand.map((d) => d.isToday), [true, false]);
    assert.equal(demand[0].day, "2026-10-11T17:00:00.000Z");
    assert.equal(api.demandForWindow(window, rows, 2).length, 0);
    const anchored = api.planningWindow(config({ startDate: new Date("2026-10-15T12:00:00+07:00"), planAheadDays: 99 }), now);
    assert.equal(anchored.from.toISOString(), "2026-10-14T17:00:00.000Z"); assert.equal(anchored.days.length, 7);
  });
  console.log(`\n${passed} offline application tests passed.`);
}
async function benchmarkChild(version, iterations) {
  const configs = Array.from({ length: 8 }, (_, i) => config({ id: `autopilot-${i}`, pageId: `page-${i}` }));
  const f = fixture({ configs, capture: false }), api = await load(f, version);
  // Transpilation/linking, git show, fixture creation and warmup excluded from timings.
  for (let i = 0; i < 30; i++) await api.runAutopilotPlanner(now, () => 0);
  f.resetCounts();
  const cpuStart = process.cpuUsage(), start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const result = await api.runAutopilotPlanner(now, () => 0);
    if (result.created !== 0 || result.pages.length !== configs.length || result.pages.some((p) => p.error)) throw new Error("Invalid full-queue benchmark outcome");
  }
  const wallMs = performance.now() - start, cpu = process.cpuUsage(cpuStart);
  const callsPerRun = Object.fromEntries(Object.entries(f.calls).map(([k, v]) => [k, v / iterations]));
  return { version, iterations, pages: 8, days: 7, postsPerDay: 3, wallMs, cpuMs: (cpu.user + cpu.system) / 1000, callsPerRun,
    totalCallsPerRun: Object.values(callsPerRun).reduce((a, b) => a + b, 0) };
}
function benchmark() {
  const iterations = argument("bench-iterations", 300), samples = argument("bench-samples", 3);
  assert.ok(Number.isInteger(iterations) && iterations > 0 && Number.isInteger(samples) && samples > 0);
  const results = { baseline: [], working: [] };
  // Alternate order to reduce systematic host/thermal bias. Each measurement gets a fresh process.
  for (let i = 0; i < samples; i++) for (const version of i % 2 ? ["working", "baseline"] : ["baseline", "working"]) {
    const child = spawnSync(process.execPath, ["--experimental-vm-modules", fileURLToPath(import.meta.url), `--bench-child=${version}`, `--bench-iterations=${iterations}`], {
      cwd: root, encoding: "utf8", env: { PATH: process.env.PATH, TZ: "UTC", NODE_ENV: "test" }, maxBuffer: 1_000_000,
    });
    if (child.status !== 0) throw new Error(`Benchmark child failed (${child.status}): ${child.stderr}\n${child.stdout}`);
    results[version].push(JSON.parse(child.stdout));
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  console.log("\nIsolated-process full-queue benchmark: 8 pages × 7 days × 3 posts/day; fresh mocks, no IO latency.");
  console.log(`Node ${process.version}; ${samples} samples/version × ${iterations} runs; 30 warmup runs/child; TZ=UTC.`);
  for (const [version, rows] of Object.entries(results)) {
    console.log(`${version}: wall ms/run samples=${rows.map((r) => (r.wallMs / iterations).toFixed(4)).join(", ")}; CPU ms/run samples=${rows.map((r) => (r.cpuMs / iterations).toFixed(4)).join(", ")}`);
    console.log(`  boundary calls/run=${rows[0].totalCallsPerRun}: ${JSON.stringify(rows[0].callsPerRun)}`);
  }
  const wallRatio = median(results.baseline.map((r) => r.wallMs)) / median(results.working.map((r) => r.wallMs));
  const cpuRatio = median(results.baseline.map((r) => r.cpuMs)) / median(results.working.map((r) => r.cpuMs));
  console.log(`Median baseline/working ratio: wall=${wallRatio.toFixed(2)}×; process CPU=${cpuRatio.toFixed(2)}× (not a production speedup estimate).`);
  console.log("Limits: CPU includes VM JS, mocks, assertions/GC/JIT, not Prisma/DB/network/provider costs; sequential samples share host load. HEAD autopilot only is substituted, helpers remain working tree. Verifier itself and learning/media services are stubbed; no DB transactions/concurrency guarantee tested. No environment files, servers, live services or application writes used.");
}
if (args.some((a) => a.startsWith("--bench-child="))) {
  const version = args.find((a) => a.startsWith("--bench-child="))?.split("=")[1];
  assert.ok(["baseline", "working"].includes(version));
  console.log(JSON.stringify(await benchmarkChild(version, argument("bench-iterations", 300))));
} else {
  assert.equal(Number(process.versions.node.split(".")[0]), 22, "Use Node 22");
  await tests();
  if (!args.includes("--tests-only")) benchmark();
}
