import { emptyProxy } from '../shared/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { cacheTargets, Cleaner, noLinks } from '../electron/cleanup';
import { launchArgs, validateFlags } from '../electron/browsers';
import { PinGate } from '../electron/security';
import { referenceSchema, requireProfile, Store, visibleProfiles } from '../electron/store';
import { searchProfiles } from '../shared/search';
import type { Browser, Profile } from '../shared/types';
const folders: string[] = [];
async function tmp() { const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'chromatic-unit-'))); folders.push(dir); return dir; }
afterEach(async () => { vi.useRealTimers(); for (const dir of folders.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
const chromium: Browser = { id: 'chrome', name: 'Chromium', executable: 'C:\\Browser\\chrome.exe', family: 'chromium', unpackedExtensions: true };
function profile(dir: string, patch: Partial<Profile> = {}): Profile { return { id: randomUUID(), name: 'Test profile', browserId: chromium.id, kind: 'managed', dataDir: dir, labels: [], color: '#8070c6', favorite: false, hidden: false, urls: [], flags: [], extensions: [], proxy: emptyProxy(), noDefaultFlags: false, createdAt: Date.now(), ...patch }; }
describe('profile routing and references', () => {
  it('preserves spaced directories as single arguments and keeps browser identity explicit', () => {
    const p = profile('C:\\My Profiles\\Work', { urls: ['https://example.com/path?a=b&c=d'], profileDir: 'Profile 2' });
    const args = launchArgs(chromium, p, new Store('unused').state.settings);
    expect(args).toContain('--user-data-dir=C:\\My Profiles\\Work'); expect(args).toContain('--profile-directory=Profile 2'); expect(args.at(-1)).toBe(p.urls[0]);
  });
  it.each(['--user-data-dir=x', '-profile C:\\x', '-P=x', '--profile-directory=Default', '--load-extension=x', '--remote-debugging-port=9222', '--proxy-server=x'])('rejects reserved arguments: %s', flag => { expect(() => validateFlags([flag])).toThrow(); });
  it('rejects executable URLs and malformed flags', () => { expect(() => launchArgs(chromium, profile('C:\\x', { urls: ['javascript:alert(1)'] }), new Store('x').state.settings)).toThrow(); expect(() => validateFlags(['https://example.com'])).toThrow(); });
  it('refuses unsupported extension loading', () => { expect(() => launchArgs({ ...chromium, unpackedExtensions: false }, profile('C:\\x', { extensions: ['C:\\ext'] }), new Store('x').state.settings)).toThrow(); });
  it('accepts only a versioned UUID reference, never executable overrides', () => { const ref = { version: 1, profileId: randomUUID() }; expect(referenceSchema.parse(ref)).toEqual(ref); expect(() => referenceSchema.parse({ ...ref, executable: 'evil.exe' })).toThrow(); expect(() => referenceSchema.parse({ ...ref, version: 2 })).toThrow(); });
  it('filters hidden profiles from every launcher list, even while unlocked', () => { const p = profile('C:\\x', { hidden: true }); expect(visibleProfiles([p], false)).toEqual([]); expect(visibleProfiles([p], true, true)).toEqual([]); expect(visibleProfiles([p], true)).toEqual([p]); expect(() => requireProfile([p], p.id, false)).toThrow(); });
  it('finds names, labels and browsers quickly in a 1000-profile collection', () => { const profiles = Array.from({ length: 1000 }, (_, i) => profile('C:\\x', { name: `Profile ${i}`, labels: i === 88 ? ['research'] : [] })); const start = performance.now(); expect(searchProfiles(profiles, 'research')[0].name).toBe('Profile 88'); expect(searchProfiles(profiles, 'Profile 12')[0].name).toBe('Profile 12'); expect(searchProfiles(profiles, 'Chromium', { chrome: 'Chromium' })).toHaveLength(1000); expect(performance.now() - start).toBeLessThan(500); });
});
describe('cache slimming preserves persistent data', () => {
  it('removes only Chromium allowlisted cache files and byte-preserves persistent files', async () => {
    const dir = await tmp(); const persistent = ['Cookies', 'Network/Cookies', 'Login Data', 'Bookmarks', 'History', 'Preferences', 'Sessions/session', 'Local Storage/leveldb/db', 'IndexedDB/site/db', 'Service Worker/CacheStorage/site/body', 'Extensions/addon/manifest.json', 'unknown-cache/keep'];
    for (const file of [...persistent, 'Cache/Cache_Data/cache', 'Code Cache/js/cache', 'GPUCache/data']) { const full = path.join(dir, 'Default', file); await fs.mkdir(path.dirname(full), { recursive: true }); await fs.writeFile(full, `unique:${file}`); }
    const before = await Promise.all(persistent.map(file => fs.readFile(path.join(dir, 'Default', file))));
    const cleaner = new Cleaner(async () => {}); const preview = await cleaner.preview(profile(dir), chromium); expect(preview.skipped).toBeUndefined(); expect(preview.items).toHaveLength(3);
    const result = await cleaner.clean(preview.token); expect(result.removed).toBe(3); expect(result.reclaimed).toBe(preview.bytes);
    for (let i = 0; i < persistent.length; i++) expect(await fs.readFile(path.join(dir, 'Default', persistent[i]))).toEqual(before[i]);
  });
  it('fails closed when browser closure cannot be established', async () => { const cleaner = new Cleaner(async () => { throw new Error('Browser is running'); }); const p = await cleaner.preview(profile(await tmp()), chromium); expect(p.skipped).toBe('Browser is running'); expect(cleaner.profileForToken(p.token)).toBeUndefined(); });
  it('rechecks running state after preview before deletion', async () => { const dir = await tmp(); await fs.mkdir(path.join(dir, 'Default/Cache'), { recursive: true }); const file = path.join(dir, 'Default/Cache/keep'); await fs.writeFile(file, 'keep'); let running = false; const cleaner = new Cleaner(async () => { if (running) throw new Error('running'); }); const preview = await cleaner.preview(profile(dir), chromium); running = true; expect((await cleaner.clean(preview.token)).reclaimed).toBe(0); expect(await fs.readFile(file, 'utf8')).toBe('keep'); });
  it('skips files changed after preview', async () => { const dir = await tmp(); await fs.mkdir(path.join(dir, 'Default/Cache'), { recursive: true }); const file = path.join(dir, 'Default/Cache/data'); await fs.writeFile(file, 'old'); const cleaner = new Cleaner(async () => {}); const p = await cleaner.preview(profile(dir), chromium); await fs.writeFile(file, 'new and larger'); expect((await cleaner.clean(p.token)).skipped).toBe(1); expect(await fs.readFile(file, 'utf8')).toBe('new and larger'); });
  it('does not follow a junction outside the selected profile', async () => { const dir = await tmp(); const outside = await tmp(); await fs.mkdir(path.join(dir, 'Default'), { recursive: true }); await fs.writeFile(path.join(outside, 'keep'), 'outside'); await fs.symlink(outside, path.join(dir, 'Default/Cache'), 'junction'); const p = await new Cleaner(async () => {}).preview(profile(dir), chromium); expect(p.skipped).toMatch(/Linked/); expect(await fs.readFile(path.join(outside, 'keep'), 'utf8')).toBe('outside'); });
  it('refuses traversal profile paths and expired cleanup plans', async () => { expect(() => cacheTargets(profile('C:\\x', { profileDir: '..' }), chromium)).toThrow(); const dir = await tmp(); const cleaner = new Cleaner(async () => {}); const p = await cleaner.preview(profile(dir), chromium); vi.useFakeTimers(); vi.setSystemTime(Date.now() + 301_000); await expect(cleaner.clean(p.token)).rejects.toThrow('expired'); });
});
describe('PIN and storage', () => {
  const protector = { encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString(), isEncryptionAvailable: () => true };
  it('requires exactly four digits, enforces persistent delays, and expires on idle', async () => {
    const store = new Store(await tmp()); await store.load(); const gate = new PinGate(store, protector);
    await expect(gate.set('123')).rejects.toThrow(); await gate.set('1234'); expect(gate.unlocked).toBe(true); gate.lock(); expect(gate.unlocked).toBe(false);
    await expect(gate.unlock('9999')).rejects.toThrow('Incorrect'); const reloaded = new Store(store.root); await reloaded.load(); expect(reloaded.state.attempts).toBe(1); await expect(gate.unlock('1234')).rejects.toThrow('Try again');
    store.state.blockedUntil = 0; await gate.unlock('1234'); vi.useFakeTimers(); vi.setSystemTime(Date.now() + 301_000); expect(gate.unlocked).toBe(false);
  });
  it('requires current PIN to change credentials and refuses unavailable secure storage', async () => { const store = new Store(await tmp()); const gate = new PinGate(store, protector); await gate.set('1234'); await expect(gate.set('5678', '9876')).rejects.toThrow(); await expect(new PinGate(new Store(await tmp()), { ...protector, isEncryptionAvailable: () => false }).set('1234')).rejects.toThrow('unavailable'); });
  it('does not overwrite corrupted settings', async () => { const dir = await tmp(); const file = path.join(dir, 'settings.json'); await fs.writeFile(file, '{bad'); await expect(new Store(dir).load()).rejects.toThrow('preserved'); expect(await fs.readFile(file, 'utf8')).toBe('{bad'); });
});
