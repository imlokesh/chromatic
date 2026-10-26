import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Browser, CacheItem, Profile, SlimPreview, SlimResult } from '../shared/types';
import { limiter, mapLimit } from '../shared/performance';
import { processNames } from './windows';

export function cacheTargets(profile: Profile, browser: Browser) {
  if (!path.isAbsolute(profile.dataDir)) throw new Error('Profile data path must be absolute.');
  const dir = profile.profileDir || 'Default';
  if (dir === '..' || dir === '.' || /[\\/:]/.test(dir)) throw new Error('Invalid Chromium profile directory.');
  const root = path.join(profile.dataDir, dir);
  return [{ root, relative: 'Cache', label: 'Disk cache' }, { root, relative: 'Code Cache', label: 'Code cache' }, { root, relative: 'GPUCache', label: 'GPU cache' }];
}
// realpath resolves every symbolic link, junction and mount point on the path, so any link
// makes the result differ. One call replaces an lstat of each ancestor (about 0.2 ms vs 2 ms).
export async function noLinks(target: string) {
  const absolute = path.resolve(target);
  const resolved = path.resolve(await fs.realpath(absolute));
  if (resolved.toLowerCase() !== absolute.toLowerCase()) throw new Error('Linked directories are not eligible for cleanup.');
}
export async function browserClosed(browser: Browser, notBefore = 0): Promise<void> {
  const basename = path.basename(browser.executable).toLowerCase();
  const list = await processNames(basename, notBefore);
  if (list.some(p => p.Name.toLowerCase() === basename)) throw new Error(`Close all ${browser.name} windows and background processes before slimming. No files were removed.`);
}
// Keeps confirming in the background that a browser stays closed, so long copies and
// deletions never stall on a process query. Callers confirm closure before starting.
// check() throws once a confirmation has failed. settle() waits for a confirmation that
// started after the guarded work finished.
export function closureMonitor(confirm: (notBefore: number) => Promise<void>, pause = 250) {
  let failure: { error: unknown } | undefined; let stopped = false; let wake = () => {};
  const loop = (async () => {
    while (!stopped) {
      await new Promise<void>(resolve => { wake = resolve; setTimeout(resolve, pause); });
      if (!stopped) await confirm(0);
    }
  })().catch(error => { failure = { error }; });
  const check = () => { if (failure) throw failure.error; };
  const stop = () => { stopped = true; wake(); };
  return { check, stop, async settle() { const finished = Date.now(); stop(); await loop; check(); await confirm(finished); } };
}
interface FileEntry { path: string; size: number; mtime: number; ino: number }
interface Plan { profileId: string; name: string; browser: Browser; expires: number; items: CacheItem[]; files: FileEntry[] }
const io = limiter(16);
async function scanDir(dir: string, output: FileEntry[]) {
  await noLinks(dir);
  const entries = await io(() => fs.readdir(dir, { withFileTypes: true }));
  await Promise.all(entries.map(async entry => {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) return;
    try {
      if (entry.isDirectory()) await scanDir(file, output);
      else if (entry.isFile()) { const stat = await io(() => fs.lstat(file)); if (!stat.isSymbolicLink() && stat.nlink === 1) output.push({ path: file, size: stat.size, mtime: stat.mtimeMs, ino: stat.ino }); }
    } catch { /* Unreadable or changing entries are never cleanup candidates. */ }
  }));
}
export class Cleaner {
  private plans = new Map<string, Plan>();
  readonly busy = new Set<string>();
  constructor(private ensureClosed: (browser: Browser, notBefore?: number) => Promise<void> = browserClosed) {}
  async preview(profile: Profile, browser: Browser): Promise<SlimPreview> {
    for (const [key, plan] of this.plans) if (plan.expires < Date.now()) this.plans.delete(key);
    const token = randomUUID(); const items: CacheItem[] = []; const files: FileEntry[] = [];
    try {
      await this.ensureClosed(browser);
      for (const target of cacheTargets(profile, browser)) {
        const dir = path.resolve(target.root, target.relative);
        const relative = path.relative(path.resolve(target.root), dir);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe cache location.');
        try {
          await noLinks(dir);
          const entries: FileEntry[] = []; await scanDir(dir, entries);
          items.push({ path: dir, label: target.label, bytes: entries.reduce((s, f) => s + f.size, 0), files: entries.length }); files.push(...entries);
        } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      }
      this.plans.set(token, { profileId: profile.id, name: profile.name, browser, expires: Date.now() + 5 * 60_000, items, files });
      return { token, profileId: profile.id, name: profile.name, items, bytes: files.reduce((s, f) => s + f.size, 0) };
    } catch (error: any) { return { token, profileId: profile.id, name: profile.name, items: [], bytes: 0, skipped: error.message }; }
  }
  profileForToken(token: string) { return this.plans.get(token)?.profileId; }
  invalidate(profileId?: string) { for (const [token, p] of this.plans) if (!profileId || p.profileId === profileId) this.plans.delete(token); }
  async clean(token: string): Promise<SlimResult> {
    const plan = this.plans.get(token); this.plans.delete(token);
    if (!plan || plan.expires < Date.now()) throw new Error('This preview expired. Scan the profile again.');
    if (this.busy.has(plan.profileId)) throw new Error('Cleanup is already running.');
    this.busy.add(plan.profileId);
    const result: SlimResult = { name: plan.name, reclaimed: 0, removed: 0, skipped: 0 };
    let monitor: ReturnType<typeof closureMonitor> | undefined;
    try {
      await this.ensureClosed(plan.browser);
      monitor = closureMonitor(notBefore => this.ensureClosed(plan.browser, notBefore));
      // Each folder is checked for links once. A folder swapped afterwards cannot redirect a
      // deletion, because every file must still match its previewed identity and size.
      const folders = new Map<string, Promise<boolean>>();
      const folderSafe = (dir: string) => { let safe = folders.get(dir); if (!safe) folders.set(dir, safe = noLinks(dir).then(() => true, () => false)); return safe; };
      await mapLimit(plan.files, 16, async file => {
        monitor!.check();
        if (!await folderSafe(path.dirname(file.path))) { result.skipped++; return; }
        const stat = await fs.lstat(file.path).catch(() => undefined);
        if (!stat || !stat.isFile() || stat.nlink !== 1 || stat.size !== file.size || stat.mtimeMs !== file.mtime || stat.ino !== file.ino) { result.skipped++; return; }
        // Delete only the individual unchanged file from the preview. Never recursively remove a directory.
        monitor!.check();
        try { await fs.unlink(file.path); result.reclaimed += stat.size; result.removed++; } catch { result.skipped++; }
      });
    } catch (error: any) { result.message = error.message; result.skipped = plan.files.length - result.removed; }
    finally { monitor?.stop(); this.busy.delete(plan.profileId); }
    return result;
  }
}
