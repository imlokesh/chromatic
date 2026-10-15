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
