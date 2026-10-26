import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { noLinks } from './cleanup';
import { limiter, mapLimit } from '../shared/performance';
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
const io = limiter(16);
async function inventory(root: string, check: () => Promise<void>, excludeCache = false): Promise<Entry[]> {
  const out: Entry[] = [];
  async function walk(dir: string) {
    await check(); await noLinks(dir);
    const entries = await io(() => fs.readdir(dir, { withFileTypes: true }));
    await Promise.all(entries.map(async entry => {
      const full = path.join(dir, entry.name), relative = path.relative(root, full);
      if (excludeCache && (caches.has(relative.split(path.sep)[0]) || /^(Singleton.*|lockfile)$/i.test(entry.name))) return;
      if (entry.isSymbolicLink()) throw new Error('Linked files or folders cannot be forked.');
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) { const s = await io(() => fs.lstat(full)); if (s.nlink !== 1) throw new Error('Hard-linked files cannot be forked.'); out.push({ full, relative, size: s.size, mtime: s.mtimeMs, ino: s.ino }); }
    }));
  }
  // Parallel walks finish in any order; sort so inventories compare exactly.
  await walk(root); return out.sort((a, b) => a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0);
}
// A file must still be the same regular file: same identity, size and modification time.
// lstat never follows a link, so a replaced file or a swapped parent folder fails this check.
async function unchanged(entry: Entry) {
  const s = await fs.lstat(entry.full);
  return s.isFile() && s.nlink === 1 && s.size === entry.size && s.mtimeMs === entry.mtime && s.ino === entry.ino;
}
// `settle` runs after the final source verification and before the fork is published, for
// checks that must cover the whole copy (such as confirming the browser stayed closed).
export async function forkProfile(source: Profile, target: Profile, check: () => Promise<void>, progress: (done: number, total: number) => void, settle: () => Promise<void> = async () => {}) {
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
    const profileRoot = path.join(staging, target.profileDir || 'Default');
    await fs.mkdir(profileRoot);
    // Create each destination folder once, parents first, instead of once per file.
    for (const dir of [...new Set(entries.map(e => path.dirname(e.relative)))].filter(d => d !== '.').sort()) await fs.mkdir(path.join(profileRoot, dir), { recursive: true });
    // mapLimit stops starting copies after a failure and waits for those in flight, so the
    // staging folder is never removed while a copy is still writing into it.
    await mapLimit(entries, 8, async entry => {
      await check();
      if (!await unchanged(entry)) throw new Error('Source data changed. Close the browser and retry.');
      await fs.copyFile(entry.full, path.join(profileRoot, entry.relative), constants.COPYFILE_EXCL);
      if (!await unchanged(entry)) throw new Error('Source data changed during the fork. Retry with the browser closed.');
      done += entry.size; progress(done, total);
    });
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
    await settle();
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
      const entries = await io(() => fs.readdir(dir, { withFileTypes: true }));
      await Promise.all(entries.map(async e => {
        check(); const full = path.join(dir, e.name);
        if (e.isSymbolicLink()) { result.incomplete = true; return; }
        // Await first: `total += await …` would read total before siblings finish.
        if (e.isDirectory()) { const size = await walk(full, cache || (dir === root && caches.has(e.name))); total += size; }
        else if (e.isFile()) { const stat = await io(() => fs.lstat(full)); check(); if (stat.isSymbolicLink() || stat.nlink !== 1) { result.incomplete = true; return; } total += stat.size; if (cache) result.cacheBytes += stat.size; }
      }));
    } catch (e: any) { check(); if (e.code !== 'ENOENT') result.incomplete = true; }
    return total;
  }
  result.bytes = await walk(root, false);
  try {
    await noLinks(p.dataDir);
    const entries = (await fs.readdir(p.dataDir, { withFileTypes: true })).filter(e => e.isFile());
    await Promise.all(entries.map(async e => {
      check();
      const s = await io(() => fs.lstat(path.join(p.dataDir, e.name))); if (!s.isSymbolicLink() && s.nlink === 1) result.sharedBytes += s.size;
    }));
  } catch (e: any) { check(); if (e.code !== 'ENOENT') result.incomplete = true; }
  if (result.incomplete) result.message = 'Some linked, changing, or unreadable files were skipped.';
  return result;
}
