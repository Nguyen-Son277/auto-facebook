export type LeaseRow = { value: string; updatedAt: Date };
export type LeaseStore = {
  read: (key: string) => Promise<LeaseRow | null>;
  create: (key: string, value: string) => Promise<boolean>;
  compareAndSet: (key: string, expected: string, value: string) => Promise<boolean>;
  encode: (value: string) => string;
  decode: (value: string) => string;
};
export type TaskLease = { key: string; value: string; expiresAt: number };

/** Also respects timestamps written by deployments using the previous lease format. */
function expiresAt(row: LeaseRow, store: LeaseStore, ttlMs: number): number {
  try {
    const raw = store.decode(row.value);
    const legacy = Date.parse(raw);
    if (Number.isFinite(legacy)) return legacy + ttlMs;
    const data = JSON.parse(raw) as { expiresAt?: unknown };
    if (typeof data.expiresAt === "number" && Number.isFinite(data.expiresAt)) return data.expiresAt;
  } catch { /* Malformed locks recover only after a full lease duration. */ }
  return row.updatedAt.getTime() + ttlMs;
}

export async function acquireTaskLease(store: LeaseStore, key: string, ttlMs: number, now = Date.now()): Promise<TaskLease | null> {
  const row = await store.read(key);
  if (row && expiresAt(row, store, ttlMs) > now) return null;
  const expiry = now + ttlMs;
  // AES-GCM produces a fresh ciphertext (random IV) for each acquisition;
  // that exact value is the owner token. Keep the plaintext ISO timestamp so
  // older deployments also recognise an active lease during rollout.
  const value = store.encode(new Date(now).toISOString());
  const won = row ? await store.compareAndSet(key, row.value, value) : await store.create(key, value);
  return won ? { key, value, expiresAt: expiry } : null;
}

export async function releaseTaskLease(store: LeaseStore, lease: TaskLease): Promise<void> {
  // Exact encrypted value is the fencing token: old owners cannot unlock a successor.
  await store.compareAndSet(lease.key, lease.value, store.encode(new Date(0).toISOString()));
}
