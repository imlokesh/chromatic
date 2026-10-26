// Collapse bursts without delaying terminal state or privacy notifications.
export function progressNotifier(notify: () => void, interval = 100) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    progress() { timer ??= setTimeout(() => { timer = undefined; notify(); }, interval); },
    flush() { if (timer) clearTimeout(timer); timer = undefined; notify(); }
  };
}

// At most one read in flight; changes during that read trigger a fresh read.
export function coalesceRefresh(read: () => Promise<void>) {
  let pending: Promise<void> | undefined;
  let dirty = false;
  return () => {
    dirty = true;
    if (!pending) {
      pending = Promise.resolve().then(async () => {
        try { while (dirty) { dirty = false; await read(); } }
        finally { pending = undefined; }
      });
    }
    return pending;
  };
}

// Structural sharing for JSON data: returns `next`, but with every part deep-equal to `prev`
// replaced by the previous object (or `prev` itself when nothing changed). Items in arrays
// are matched by `id` when they have one. Unchanged profiles keep their identity across
// snapshots, so memoized rows can skip rendering.
export function reuse<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next) || typeof prev !== 'object' || typeof next !== 'object' || prev === null || next === null) return next;
  if (Array.isArray(next)) {
    if (!Array.isArray(prev)) return next;
    const byId = new Map<unknown, unknown>();
    for (const item of prev) if (item && typeof item === 'object' && 'id' in item) byId.set((item as { id: unknown }).id, item);
    let same = prev.length === next.length;
    const out = next.map((item, i) => {
      const match = item && typeof item === 'object' && 'id' in item && byId.has(item.id) ? byId.get(item.id) : prev[i];
      const shared = reuse(match, item); if (shared !== prev[i]) same = false; return shared;
    });
    return (same ? prev : out) as T;
  }
  if (Array.isArray(prev)) return next;
  const before = prev as Record<string, unknown>, after = next as Record<string, unknown>;
  const keys = Object.keys(after); let same = keys.length === Object.keys(before).length;
  const out: Record<string, unknown> = {};
  for (const key of keys) { const shared = reuse(before[key], after[key]); if (shared !== before[key] || !(key in before)) same = false; out[key] = shared; }
  return (same ? prev : out) as T;
}

// Bound concurrent filesystem calls. Wrap single operations, never recursive walks, so a
// parent can't hold a slot while waiting on its children.
export function limiter(concurrency: number) {
  let active = 0; const queue: (() => void)[] = [];
  return <T>(task: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    const start = () => { active++; task().then(resolve, reject).finally(() => { active--; queue.shift()?.(); }); };
    if (active < concurrency) start(); else queue.push(start);
  });
}

// Like Promise.all over a bounded pool, but after the first failure it starts nothing new and
// settles only once in-flight work has finished, so callers can safely clean up afterwards.
export async function mapLimit<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>) {
  let next = 0; let failure: { error: unknown } | undefined;
  const worker = async () => {
    while (!failure && next < items.length) {
      const item = items[next++];
      try { await work(item); } catch (error) { failure ??= { error }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failure) throw failure.error;
}
