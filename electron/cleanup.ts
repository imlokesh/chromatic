import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Browser, CacheItem, Profile, SlimPreview, SlimResult } from '../shared/types';
import { processes } from './windows';

export function cacheTargets(profile: Profile, browser: Browser) {
  if (!path.isAbsolute(profile.dataDir)) throw new Error('Profile data path must be absolute.');
  const dir = profile.profileDir || 'Default';
  if (dir === '..' || dir === '.' || /[\\/:]/.test(dir)) throw new Error('Invalid Chromium profile directory.');
  const root = path.join(profile.dataDir, dir);
  return [{ root, relative: 'Cache', label: 'Disk cache' }, { root, relative: 'Code Cache', label: 'Code cache' }, { root, relative: 'GPUCache', label: 'GPU cache' }];
}
export async function noLinks(target: string) {
  const absolute = path.resolve(target); const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw new Error('Linked directories are not eligible for cleanup.');
  }
  const resolved = await fs.realpath(absolute);
  if (path.resolve(resolved).toLowerCase() !== absolute.toLowerCase()) throw new Error('Cache path resolved outside its expected location.');
}
export async function browserClosed(browser: Browser): Promise<void> {
  const basename = path.basename(browser.executable).toLowerCase();
  const list = await processes(basename);
  if (list.some(p => p.Name.toLowerCase() === basename)) throw new Error(`Close all ${browser.name} windows and background processes before slimming. No files were removed.`);
}
interface FileEntry { path: string; size: number; mtime: number; ino: number }
interface Plan { profileId: string; name: string; browser: Browser; expires: number; items: CacheItem[]; files: FileEntry[] }
async function scanDir(dir: string, output: FileEntry[]) {
  await noLinks(dir);
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    try {
      if (entry.isDirectory()) await scanDir(file, output);
      else if (entry.isFile()) { const stat = await fs.lstat(file); if (!stat.isSymbolicLink() && stat.nlink === 1) output.push({ path: file, size: stat.size, mtime: stat.mtimeMs, ino: stat.ino }); }
    } catch { /* Unreadable or changing entries are never cleanup candidates. */ }
  }
}
export class Cleaner {
  private plans = new Map<string, Plan>();
  readonly busy = new Set<string>();
  constructor(private ensureClosed: (browser: Browser) => Promise<void> = browserClosed) {}
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
    try {
      await this.ensureClosed(plan.browser);
      let lastCheck = 0;
      for (const file of plan.files) {
        if (Date.now() - lastCheck > 1000) { await this.ensureClosed(plan.browser); lastCheck = Date.now(); }
        try {
          await noLinks(file.path);
          const stat = await fs.lstat(file.path);
          if (!stat.isFile() || stat.nlink !== 1 || stat.size !== file.size || stat.mtimeMs !== file.mtime || stat.ino !== file.ino) { result.skipped++; continue; }
          // Delete only the individual unchanged file from the preview. Never recursively remove a directory.
          await fs.unlink(file.path); result.reclaimed += stat.size; result.removed++;
        } catch { result.skipped++; }
      }
    } catch (error: any) { result.message = error.message; result.skipped = plan.files.length - result.removed; }
    finally { this.busy.delete(plan.profileId); }
    return result;
  }
}
