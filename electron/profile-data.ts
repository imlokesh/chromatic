import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { noLinks } from './cleanup';
import type { Profile, StorageUsage } from '../shared/types';

const caches = new Set(['Cache', 'Code Cache', 'GPUCache']);
export function profilePath(p: Profile) {
  const dir = p.profileDir || 'Default';
  if (!path.isAbsolute(p.dataDir) || /[\\/:]/.test(dir) || dir === '.' || dir === '..') throw new Error('Invalid browser profile folder.');
  return path.join(p.dataDir, dir);
}
export function duplicateProfile(source: Profile, root: string, name: string): Profile {
  const id = randomUUID();
  return { ...structuredClone(source), id, name, dataDir: path.join(root, 'Profiles', id), profileDir: source.profileDir || 'Default', kind: 'managed', favorite: false, lastUsed: undefined, createdAt: Date.now() };
}
type Entry = { full: string; relative: string; size: number; mtime: number; ino: number };
async function inventory(root: string, check: () => Promise<void>, excludeCache = false): Promise<Entry[]> {
  const out: Entry[] = [];
  async function walk(dir: string) {
    await check(); await noLinks(dir);
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name), relative = path.relative(root, full);
      if (excludeCache && (caches.has(relative.split(path.sep)[0]) || /^(Singleton.*|lockfile)$/i.test(entry.name))) continue;
      if (entry.isSymbolicLink()) throw new Error('Linked files or folders cannot be forked.');
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) { const s = await fs.lstat(full); if (s.nlink !== 1) throw new Error('Hard-linked files cannot be forked.'); out.push({ full, relative, size: s.size, mtime: s.mtimeMs, ino: s.ino }); }
    }
  }
  await walk(root); return out;
}
export async function forkProfile(source: Profile, target: Profile, check: () => Promise<void>, progress: (done: number, total: number) => void) {
  const from = profilePath(source), destination = target.dataDir;
  // The caller supplies a newly allocated managed destination. Never replace a directory.
  await check(); await noLinks(source.dataDir);
  const entries = await inventory(from, check, true);
  const localState = path.join(source.dataDir, 'Local State');
  let state: Buffer | undefined;
  try { await noLinks(localState); state = await fs.readFile(localState); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  const total = entries.reduce((n, e) => n + e.size, state?.length || 0);
  await fs.mkdir(path.dirname(destination), { recursive: true }); await noLinks(path.dirname(destination));
  const space = await fs.statfs(path.dirname(destination));
  if (space.bavail * space.bsize < total + 16 * 1024 * 1024) throw new Error('Not enough disk space for this fork. Free some space and try again.');
  const staging = await fs.mkdtemp(path.join(path.dirname(destination), '.fork-'));
  let done = 0;
  try {
    await fs.mkdir(path.join(staging, target.profileDir || 'Default'));
    for (const entry of entries) {
      await check(); await noLinks(entry.full);
      const before = await fs.stat(entry.full);
      if (before.size !== entry.size || before.mtimeMs !== entry.mtime || before.ino !== entry.ino) throw new Error('Source data changed. Close the browser and retry.');
      const to = path.join(staging, target.profileDir || 'Default', entry.relative);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(entry.full, to, constants.COPYFILE_EXCL);
      const after = await fs.stat(entry.full);
      if (after.size !== entry.size || after.mtimeMs !== entry.mtime || after.ino !== entry.ino) throw new Error('Source data changed during the fork. Retry with the browser closed.');
      done += entry.size; progress(done, total);
    }
    if (state) {
      const parsed = JSON.parse(state.toString('utf8'));
      // Keep key material and browser-wide settings; remove sibling profile identities.
      if (parsed.profile) {
        const dir = source.profileDir || 'Default';
        parsed.profile.info_cache = parsed.profile.info_cache?.[dir] ? { [dir]: parsed.profile.info_cache[dir] } : {};
        parsed.profile.last_used = dir; parsed.profile.last_active_profiles = [dir];
      }
      await fs.writeFile(path.join(staging, 'Local State'), JSON.stringify(parsed));
    }
    await check();
    const final = await inventory(from, check, true);
    if (JSON.stringify(final) !== JSON.stringify(entries) || (state && !state.equals(await fs.readFile(localState)))) throw new Error('Source data changed. The fork was not saved.');
    try { await fs.access(destination); throw new Error('The destination already exists.'); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    await fs.rename(staging, destination); progress(total, total);
  } catch (e) {
    // Only remove the exact staging directory allocated above, under the checked parent.
    await noLinks(staging); await fs.rm(staging, { recursive: true, force: true }); throw e;
  }
}

export async function scanProfileStorage(p: Profile, check: () => void): Promise<StorageUsage> {
  const result: StorageUsage = { profileId: p.id, rootKey: path.resolve(p.dataDir).toLowerCase(), bytes: 0, cacheBytes: 0, sharedBytes: 0, scannedAt: Date.now(), incomplete: false };
  const root = profilePath(p);
  async function walk(dir: string, cache: boolean): Promise<number> {
    check(); let total = 0;
    try {
      await noLinks(dir);
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        check(); const full = path.join(dir, e.name);
        if (e.isSymbolicLink()) { result.incomplete = true; continue; }
        if (e.isDirectory()) total += await walk(full, cache || (dir === root && caches.has(e.name)));
        else if (e.isFile()) { const stat = await fs.lstat(full); if (stat.isSymbolicLink() || stat.nlink !== 1) { result.incomplete = true; continue; } total += stat.size; if (cache) result.cacheBytes += stat.size; }
      }
    } catch (e: any) { check(); if (e.code !== 'ENOENT') result.incomplete = true; }
    return total;
  }
  result.bytes = await walk(root, false);
  try {
    await noLinks(p.dataDir);
    for (const e of await fs.readdir(p.dataDir, { withFileTypes: true })) {
      check();
      if (e.isFile()) { const s = await fs.lstat(path.join(p.dataDir, e.name)); if (!s.isSymbolicLink() && s.nlink === 1) result.sharedBytes += s.size; }
    }
  } catch (e: any) { check(); if (e.code !== 'ENOENT') result.incomplete = true; }
  if (result.incomplete) result.message = 'Some linked, changing, or unreadable files were skipped.';
  return result;
}
