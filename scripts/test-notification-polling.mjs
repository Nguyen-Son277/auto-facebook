// Run: node --experimental-strip-types --no-warnings scripts/test-notification-polling.mjs
// No database, browser, or server needed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createNotificationPolling } from "../src/lib/notification-polling.ts";

const item = (id, read = false) => ({
  id, read, type: "ACTIVITY", title: id, body: null, link: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function harness(initialUnread = 3) {
  let now = 0;
  let visible = true;
  let seq = 0;
  const timers = new Map();
  const visibilityListeners = new Set();
  const requests = [];
  const schedule = (callback, delay, repeat) => {
    const id = ++seq;
    timers.set(id, { callback, at: now + delay, repeat });
    return id;
  };
  const polling = createNotificationPolling(initialUnread, {
    fetchSnapshot: (signal) => new Promise((resolve, reject) => requests.push({ signal, resolve, reject })),
    isVisible: () => visible,
    onVisibilityChange: (listener) => {
      visibilityListeners.add(listener);
      return () => visibilityListeners.delete(listener);
    },
    setTimeout: (callback, ms) => schedule(callback, ms, 0),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (callback, ms) => schedule(callback, ms, ms),
    clearInterval: (id) => timers.delete(id),
  });
  return {
    polling, requests, timers, visibilityListeners,
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        now = timer.at;
        if (timer.repeat) timer.at += timer.repeat;
        else timers.delete(id);
        timer.callback();
        await flush();
      }
      now = end;
    },
    visibility(value) {
      visible = value;
      for (const listener of visibilityListeners) listener();
    },
    async resolve(index, snapshot) {
      requests[index].resolve(snapshot);
      await flush();
    },
  };
}

test("server unread seed, first fetch after 3s, then one 30s poll", async () => {
  const h = harness();
  assert.deepEqual(h.polling.getServerSnapshot(), { unread: 3, items: [] });
  const stop = h.polling.start();
  await h.advance(2999);
  assert.equal(h.requests.length, 0);
  await h.advance(1);
  assert.equal(h.requests.length, 1);
  await h.resolve(0, { unread: 2, items: [item("a")] });
  await h.advance(26999);
  assert.equal(h.requests.length, 1);
  await h.advance(1);
  assert.equal(h.requests.length, 2);
  stop();
});

test("hidden tabs do not fetch; becoming visible refreshes immediately", async () => {
  const h = harness();
  h.visibility(false);
  const stop = h.polling.start();
  await h.advance(90000);
  await h.polling.refresh();
  assert.equal(h.requests.length, 0);
  h.visibility(true);
  assert.equal(h.requests.length, 1);
  await h.resolve(0, { unread: 0, items: [] });
  stop();
});

test("two bells, visibility and timer share the same in-flight request", async () => {
  const h = harness();
  const stop = h.polling.start();
  const desktop = h.polling.refresh();
  const mobile = h.polling.refresh();
  assert.equal(desktop, mobile);
  h.visibility(true);
  await h.advance(10000);
  assert.equal(h.requests.length, 1);
  await h.resolve(0, { unread: 1, items: [item("a")] });
  await desktop;
  stop();
});

test("optimistic item read reaches both subscribers once; stale GET cannot undo it", async () => {
  const h = harness();
  const stop = h.polling.start();
  const desktop = [], mobile = [];
  const offDesktop = h.polling.subscribe(() => desktop.push(h.polling.getSnapshot()));
  const offMobile = h.polling.subscribe(() => mobile.push(h.polling.getSnapshot()));
  void h.polling.refresh();
  await h.resolve(0, { unread: 3, items: [item("a"), item("b")] });
  void h.polling.refresh();
  h.polling.markRead(["a"]);
  assert.equal(desktop.at(-1), mobile.at(-1));
  assert.equal(h.polling.getSnapshot().unread, 2);
  assert.equal(h.polling.getSnapshot().items[0].read, true);
  await h.polling.refresh();
  assert.equal(h.requests.length, 2, "no GET while mutation is pending");
  const reconcile = h.polling.reconcile();
  await h.resolve(1, { unread: 3, items: [item("a"), item("b")] });
  assert.equal(h.polling.getSnapshot().unread, 2, "pre-mutation GET ignored");
  assert.equal(h.requests.length, 3, "fresh GET after mutation");
  await h.resolve(2, { unread: 2, items: [item("a", true), item("b")] });
  await reconcile;
  offDesktop(); offMobile(); stop();
});

test("mark all is optimistic and reconciliation restores state on failed mutation", async () => {
  const h = harness();
  const stop = h.polling.start();
  void h.polling.refresh();
  await h.resolve(0, { unread: 3, items: [item("a"), item("b")] });
  h.polling.markRead();
  assert.equal(h.polling.getSnapshot().unread, 0);
  assert.ok(h.polling.getSnapshot().items.every((n) => n.read));
  const reconciliation = h.polling.reconcile();
  await h.resolve(1, { unread: 3, items: [item("a"), item("b")] });
  await reconciliation;
  assert.equal(h.polling.getSnapshot().unread, 3);
  stop();
});

test("overlapping mutations wait for both before reconciling", async () => {
  const h = harness();
  const stop = h.polling.start();
  void h.polling.refresh();
  await h.resolve(0, { unread: 2, items: [item("a"), item("b")] });
  h.polling.markRead(["a"]);
  h.polling.markRead(["b"]);
  await h.polling.reconcile();
  assert.equal(h.requests.length, 1);
  assert.equal(h.polling.getSnapshot().unread, 0);
  const finalReconcile = h.polling.reconcile();
  await h.resolve(1, { unread: 0, items: [item("a", true), item("b", true)] });
  await finalReconcile;
  stop();
});

test("stalled GET times out, releases shared request and ignores late response", async () => {
  const h = harness();
  const stop = h.polling.start();
  const stalled = h.polling.refresh();
  await h.advance(15000);
  await stalled;
  assert.equal(h.requests[0].signal.aborted, true);
  const next = h.polling.refresh();
  assert.equal(h.requests.length, 2);
  await h.resolve(1, { unread: 1, items: [item("fresh")] });
  await next;
  await h.resolve(0, { unread: 99, items: [] });
  assert.equal(h.polling.getSnapshot().unread, 1);
  stop();
});

test("network/non-OK failures retain data and next poll retries", async () => {
  const h = harness();
  const stop = h.polling.start();
  const first = h.polling.refresh();
  h.requests[0].reject(new Error("offline"));
  await first;
  assert.equal(h.polling.getSnapshot().unread, 3);
  void h.polling.refresh();
  await h.resolve(1, null);
  assert.equal(h.polling.getSnapshot().unread, 3);
  await h.advance(3000);
  assert.equal(h.requests.length, 3);
  await h.resolve(2, { unread: 0, items: [] });
  await h.advance(27000);
  assert.equal(h.requests.length, 4);
  stop();
});

test("unmount/Strict Mode cleanup clears timers, listeners and ignores late data", async () => {
  const h = harness();
  const stop = h.polling.start();
  void h.polling.refresh();
  stop();
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.visibilityListeners.size, 0);
  const secondStop = h.polling.start();
  void h.polling.refresh();
  await h.resolve(0, { unread: 99, items: [] });
  assert.equal(h.polling.getSnapshot().unread, 3);
  await h.resolve(1, { unread: 1, items: [] });
  assert.equal(h.polling.getSnapshot().unread, 1);
  secondStop();
  await h.advance(60000);
  assert.equal(h.requests.length, 2);
});

test("integration guards: one keyed provider, limit8 fetch, toast slice5 and existing selectors", () => {
  const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const provider = source("../src/components/notification-provider.tsx");
  const bell = source("../src/components/notification-bell.tsx");
  const toast = source("../src/components/notification-toast.tsx");
  const layout = source("../src/app/(dashboard)/layout.tsx");
  assert.match(provider, /fetch\("\/api\/notifications\?limit=8"/);
  assert.match(provider, /cache: "no-store"/);
  assert.match(layout, /<NotificationProvider key=\{user.id\} initialUnread=\{unread\}>/);
  assert.equal((layout.match(/<NotificationProvider /g) ?? []).length, 1);
  for (const consumer of [bell, toast]) {
    assert.match(consumer, /useNotifications\(\)/);
    assert.doesNotMatch(consumer, /fetch\(|setInterval\(|visibilitychange/);
  }
  assert.match(toast, /items.slice\(0, 5\)/);
  assert.match(toast, /n.read \|\| seen.has\(n.id\)/);
  assert.match(toast, /dsh-notification-toast-seen/);
  assert.match(toast, /slice\(-200\)/);
  assert.match(toast, /testId: `toast-item-\$\{n.id\}`/);
  for (const id of ["notification-bell", "notification-count", "notification-panel"]) {
    assert.ok(bell.includes(`\`${id}\${testIdSuffix}\``));
  }
});
