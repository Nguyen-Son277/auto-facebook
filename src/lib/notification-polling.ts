// Browser-only polling state, kept independent of React for focused tests.
export type NotificationItem = {
  id: string;
  type: "ACTIVITY" | "ADMIN" | "SYSTEM";
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
};

export type NotificationSnapshot = {
  unread: number;
  items: NotificationItem[];
};

export const NOTIFICATION_POLL_MS = 30_000;
export const NOTIFICATION_FIRST_FETCH_MS = 3_000;

type PollingDependencies = {
  fetchSnapshot: (signal: AbortSignal) => Promise<NotificationSnapshot | null>;
  isVisible: () => boolean;
  onVisibilityChange: (listener: () => void) => () => void;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
};

export function createNotificationPolling(
  initialUnread: number,
  deps: PollingDependencies,
) {
  const initial: NotificationSnapshot = { unread: initialUnread, items: [] };
  let snapshot = initial;
  const listeners = new Set<() => void>();
  let active = false;
  let generation = 0;
  let revision = 0;
  let pendingMutations = 0;
  let inFlight: Promise<void> | null = null;
  let abort: AbortController | null = null;
  let requestTimeout: unknown = null;
  let cleanup: (() => void) | null = null;

  function publish(next: NotificationSnapshot) {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function refresh(): Promise<void> {
    if (!active || pendingMutations > 0 || !deps.isVisible()) return Promise.resolve();
    if (inFlight) return inFlight;
    const requestGeneration = generation;
    const requestRevision = revision;
    const requestAbort = new AbortController();
    abort = requestAbort;
    let timeout: unknown;
    const deadline = new Promise<null>((resolve) => {
      timeout = deps.setTimeout(() => {
        requestAbort.abort();
        resolve(null);
      }, 15_000);
      requestTimeout = timeout;
    });
    const request = (async () => {
      try {
        const next = await Promise.race([deps.fetchSnapshot(requestAbort.signal), deadline]);
        // Ignore late results after unmount/user change or an optimistic edit.
        if (next && active && generation === requestGeneration && revision === requestRevision) {
          publish(next);
        }
      } catch {
        // Retain the previous data on network errors; the next poll retries.
      } finally {
        deps.clearTimeout(timeout);
        if (requestTimeout === timeout) requestTimeout = null;
      }
    })();
    inFlight = request;
    void request.then(() => {
      if (inFlight === request) {
        inFlight = null;
        abort = null;
      }
    });
    return request;
  }

  function stop() {
    active = false;
    generation++;
    cleanup?.();
    cleanup = null;
    abort?.abort();
    if (requestTimeout !== null) deps.clearTimeout(requestTimeout);
    requestTimeout = null;
    abort = null;
    inFlight = null;
  }

  function start() {
    if (active) return stop;
    active = true;
    generation++;
    const first = deps.setTimeout(() => void refresh(), NOTIFICATION_FIRST_FETCH_MS);
    const interval = deps.setInterval(() => void refresh(), NOTIFICATION_POLL_MS);
    const offVisibility = deps.onVisibilityChange(() => {
      if (deps.isVisible()) void refresh();
    });
    cleanup = () => {
      deps.clearTimeout(first);
      deps.clearInterval(interval);
      offVisibility();
    };
    return stop;
  }

  function markRead(ids?: string[]) {
    pendingMutations++;
    revision++;
    const selected = ids ? new Set(ids) : null;
    const newlyRead = snapshot.items.filter((item) => !item.read && (!selected || selected.has(item.id))).length;
    publish({
      unread: selected ? Math.max(0, snapshot.unread - newlyRead) : 0,
      items: snapshot.items.map((item) => !selected || selected.has(item.id) ? { ...item, read: true } : item),
    });
  }

  async function reconcile() {
    // A pre-mutation request cannot overwrite the optimistic state. Wait for it
    // before fetching authoritative data, still sharing any concurrent refresh.
    revision++;
    pendingMutations = Math.max(0, pendingMutations - 1);
    if (pendingMutations > 0) return;
    if (inFlight) await inFlight;
    await refresh();
  }

  return {
    start,
    refresh,
    markRead,
    reconcile,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
