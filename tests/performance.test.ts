import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { LaunchQueue, spawnBrowser } from '../electron/launch';
import { coalesceRefresh, progressNotifier } from '../shared/performance';
import { groupProfiles, searchProfiles } from '../shared/search';
import { emptyProxy, type Profile } from '../shared/types';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('launch scheduling', () => {
  it('deduplicates a profile, serializes a root, and allows unrelated roots', async () => {
    const queue = new LaunchQueue(), gate = deferred(); const events: string[] = [];
    const first = queue.run('a', 'root', async () => { events.push('a'); await gate.promise; });
    expect(queue.run('a', 'root', async () => { throw new Error('duplicate'); })).toBe(first);
    const second = queue.run('b', 'root', async () => { events.push('b'); });
    await queue.run('c', 'other', async () => { events.push('c'); });
    expect(events).toEqual(['a', 'c']); expect(queue.hasRoot('root')).toBe(true);
    gate.resolve(); await Promise.all([first, second]); await Promise.resolve();
    expect(events).toEqual(['a', 'c', 'b']); expect(queue.hasRoot('root')).toBe(false);
  });
  it('releases reservations after failure and runs the next request', async () => {
    const queue = new LaunchQueue();
    const failed = queue.run('a', 'root', async () => { throw new Error('missing'); });
    const next = vi.fn(async () => {}); const done = queue.run('b', 'root', next);
    await expect(failed).rejects.toThrow('missing'); await done; await Promise.resolve();
    expect(next).toHaveBeenCalledOnce(); expect(queue.hasRoot('root')).toBe(false);
  });
});

describe('nonblocking spawn', () => {
  function child() { const c = Object.assign(new EventEmitter(), { unref: vi.fn() }); mocks.spawn.mockReturnValue(c); return c; }
  it('resolves at spawn, unreferences immediately, and reports early failure separately', async () => {
    vi.useFakeTimers(); const c = child(), failure = vi.fn();
    const promise = spawnBrowser('browser.exe', ['--user-data-dir=test'], failure);
    c.emit('spawn'); await promise;
    expect(c.unref).toHaveBeenCalledOnce(); expect(failure).not.toHaveBeenCalled();
    c.emit('exit', 2); expect(failure).toHaveBeenCalledOnce();
    expect(failure.mock.calls[0][0].message).toContain('code 2');
    expect(mocks.spawn.mock.calls[0][2]).toMatchObject({ detached: true, stdio: 'ignore', shell: false });
  });
  it('rejects spawn failure and treats clean handoff as success', async () => {
    vi.useFakeTimers(); let c = child(); const failure = vi.fn();
    const rejected = spawnBrowser('missing.exe', [], failure); c.emit('error', new Error('ENOENT'));
    await expect(rejected).rejects.toThrow('ENOENT'); expect(failure).not.toHaveBeenCalled();
    c = child(); const accepted = spawnBrowser('browser.exe', [], failure); c.emit('spawn'); c.emit('exit', 0);
    await accepted; expect(failure).not.toHaveBeenCalled();
  });
  it('does not turn a later browser exit into a launch error', async () => {
    vi.useFakeTimers(); const c = child(), failure = vi.fn();
    const accepted = spawnBrowser('browser.exe', [], failure); c.emit('spawn'); await accepted;
    vi.advanceTimersByTime(900); c.emit('exit', 3); expect(failure).not.toHaveBeenCalled();
  });
});

describe('refresh scheduling', () => {
  it('collapses thousands of file updates and flushes terminal state immediately', () => {
    vi.useFakeTimers(); const notify = vi.fn(); const updates = progressNotifier(notify);
    for (let i = 0; i < 1000; i++) updates.progress();
    expect(notify).not.toHaveBeenCalled(); vi.advanceTimersByTime(100); expect(notify).toHaveBeenCalledOnce();
    updates.progress(); updates.flush(); expect(notify).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(100); expect(notify).toHaveBeenCalledTimes(2);
  });
  it('allows only one snapshot in flight and reads again after a burst', async () => {
    const gate = deferred(); let reads = 0, active = 0, maximum = 0;
    const refresh = coalesceRefresh(async () => { reads++; maximum = Math.max(maximum, ++active); if (reads === 1) await gate.promise; active--; });
    const first = refresh(); await Promise.resolve();
    for (let i = 0; i < 1000; i++) expect(refresh()).toBe(first);
    gate.resolve(); await first; expect(reads).toBe(2); expect(maximum).toBe(1);
    await refresh(); expect(reads).toBe(3);
  });
  it('can refresh again after a failed snapshot', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const refresh = coalesceRefresh(read); await expect(refresh()).rejects.toThrow('offline'); await refresh();
    expect(read).toHaveBeenCalledTimes(2);
  });
});

function profile(i: number): Profile {
  return { id: String(i), browserId: 'chrome', name: `Profile ${i}`, kind: 'managed', dataDir: `C:\\test\\${i}`, labels: [`Label ${i % 100}`, `Team ${i % 10}`], color: '#8070c6', favorite: i % 5 === 0, hidden: false, urls: [], flags: [], extensions: [], proxy: emptyProxy(), noDefaultFlags: false, createdAt: i };
}
describe('profile grouping', () => {
  it('preserves label order, profile order, case folding, and unlabeled profiles', () => {
    const a = { ...profile(1), labels: ['Work', 'work', 'Research'] }, b = { ...profile(2), labels: [] }, c = { ...profile(3), labels: ['work'] };
    expect(groupProfiles([a, b, c], ['Research', 'Work'], '')).toEqual([{ label: 'Research', profiles: [a] }, { label: 'Work', profiles: [a, c] }, { label: 'Unlabeled', profiles: [b] }]);
    expect(groupProfiles([a, c], ['Research', 'Work'], 'WORK')).toEqual([{ label: 'Work', profiles: [a, c] }]);
  });
  it('matches the previous grouping result for a 1000-profile collection', () => {
    const profiles = searchProfiles(Array.from({ length: 1000 }, (_, i) => profile(i)), '');
    const labels = [...new Set(profiles.flatMap(p => p.labels))].sort();
    const before = performance.now();
    const old = labels.filter(label => profiles.some(p => p.labels.some(l => l.toLocaleLowerCase() === label.toLocaleLowerCase())))
      .map(label => ({ label, profiles: profiles.filter(p => p.labels.some(l => l.toLocaleLowerCase() === label.toLocaleLowerCase())) }));
    const oldMs = performance.now() - before; const start = performance.now();
    const grouped = groupProfiles(profiles, labels, ''); const newMs = performance.now() - start;
    expect(grouped).toEqual(old);
    console.log(`1000 profiles / ${labels.length} labels grouping: ${oldMs.toFixed(1)} ms to ${newMs.toFixed(1)} ms`);
  });
});
