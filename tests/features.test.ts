import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { Server } from 'proxy-chain';
import { duplicateProfile, forkProfile, scanProfileStorage } from '../electron/profile-data';
import { createBridge, protectProxy, revealProxy, upstreamUrl, testProxy } from '../electron/proxy';
import { migrateV1, proxySchema, Store } from '../electron/store';
import { emptyProxy, type Profile } from '../shared/types';

const folders: string[] = []; const closers: (() => Promise<unknown>)[] = [];
async function tmp() { const p = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'chromatic-v2-'))); folders.push(p); return p; }
async function write(root: string, relative: string, data = relative) { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, data); }
function profile(dataDir: string, patch: Partial<Profile> = {}): Profile { return { id: randomUUID(), name: 'Work', browserId: 'chrome', kind: 'managed', dataDir, labels: ['Work'], color: '#8070c6', favorite: true, hidden: false, urls: [], flags: [], extensions: [], proxy: emptyProxy(), noDefaultFlags: false, createdAt: 1, lastUsed: 2, ...patch }; }
afterEach(async () => { vi.restoreAllMocks(); for (const close of closers.splice(0).reverse()) await close(); for (const dir of folders.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });

describe('v2 migration', () => {
  it('archives Firefox without touching data and keeps the exact original configuration', async () => {
    const root = await tmp(), source = profile(root); const { labels, ...old } = source;
    const raw = { ...new Store(root).state, version: 1, profiles: [{ ...old, tags: ['Work', 'work'], proxy: 'socks5://localhost:1080' }, { ...old, id: randomUUID(), browserId: 'firefox', proxy: '' }], browsers: [{ id: 'chrome', name: 'Chrome', executable: 'chrome.exe', family: 'chromium', unpackedExtensions: false }, { id: 'firefox', name: 'Firefox', executable: 'firefox.exe', family: 'firefox', unpackedExtensions: false }] };
    const original = JSON.stringify(raw); await write(root, 'settings.json', original); await write(root, 'cookies.sqlite', 'keep');
    const store = new Store(root); await store.load();
    expect(store.state.version).toBe(2); expect(store.state.profiles).toHaveLength(1); expect(store.state.profiles[0].labels).toHaveLength(1);
    expect(store.state.profiles[0].proxy.protocol).toBe('socks5'); expect(await fs.readFile(path.join(root, 'settings.v1.backup.json'), 'utf8')).toBe(original);
    expect(JSON.parse(await fs.readFile(path.join(root, 'archived-firefox.json'), 'utf8')).profiles).toHaveLength(1);
    expect(await fs.readFile(path.join(root, 'cookies.sqlite'), 'utf8')).toBe('keep');
    await new Store(root).load();
  });
  it('marks unsupported proxy configurations for review and hides embedded credentials', () => {
    const p = profile('C:\\data'); const raw = { profiles: [{ ...p, proxy: 'http://user:secret@host:8080' }], browsers: [{ id: 'chrome', family: 'chromium' }], settings: { defaultFlags: { chromium: [] } } };
    const result = migrateV1(raw); expect(result.profiles[0].proxy.mode).toBe('review'); expect(JSON.stringify(result)).not.toContain('secret');
  });
});
describe('duplicate and fork', () => {
  it('duplicates settings into a fresh identity without creating or copying data', async () => {
    const root = await tmp(); const source = profile(path.join(root, 'source'), { hidden: true }); await write(source.dataDir, 'Default/Cookies', 'secret');
    const copy = duplicateProfile(source, root, 'New'); expect(copy.id).not.toBe(source.id); expect(copy.favorite).toBe(false); expect(copy.lastUsed).toBeUndefined(); expect(copy.hidden).toBe(true);
    expect(await fs.access(copy.dataDir).then(() => true, () => false)).toBe(false); copy.labels.push('Other'); expect(source.labels).toEqual(['Work']);
  });
  it('forks persistent data and encryption metadata, excluding caches and sibling profiles', async () => {
    const root = await tmp(); const source = profile(path.join(root, 'source'), { profileDir: 'Profile 2' });
    const persistent = ['Cookies', 'Network/Cookies', 'Login Data', 'Preferences', 'Secure Preferences', 'Sessions/session', 'Local Storage/db', 'IndexedDB/db', 'Service Worker/CacheStorage/db', 'Extensions/test/manifest.json'];
    for (const f of [...persistent, 'Cache/cache', 'Code Cache/cache', 'GPUCache/cache']) await write(source.dataDir, `Profile 2/${f}`);
    await write(source.dataDir, 'Profile 1/Cookies', 'sibling'); await write(source.dataDir, 'Local State', JSON.stringify({ os_crypt: { encrypted_key: 'preserved' }, profile: { info_cache: { 'Profile 1': { name: 'Sibling' }, 'Profile 2': { name: 'Work' } }, last_used: 'Profile 1' } }));
    const target = duplicateProfile(source, root, 'Fork'); await forkProfile(source, target, async () => {}, () => {});
    for (const f of persistent) expect(await fs.readFile(path.join(target.dataDir, 'Profile 2', f), 'utf8')).toBe(`Profile 2/${f}`);
    expect(await fs.readdir(path.join(target.dataDir, 'Profile 2'))).not.toContain('Cache'); expect(await fs.readdir(target.dataDir)).not.toContain('Profile 1');
    const state = JSON.parse(await fs.readFile(path.join(target.dataDir, 'Local State'), 'utf8')); expect(state.os_crypt.encrypted_key).toBe('preserved'); expect(Object.keys(state.profile.info_cache)).toEqual(['Profile 2']);
    await write(target.dataDir, 'Profile 2/Cookies', 'changed'); expect(await fs.readFile(path.join(source.dataDir, 'Profile 2/Cookies'), 'utf8')).not.toBe('changed');
  });
  it('cleans partial output on cancellation and rejects a changing source', async () => {
    const root = await tmp(); const source = profile(path.join(root, 'source')); await write(source.dataDir, 'Default/Cookies'); await write(source.dataDir, 'Default/History');
    const target = duplicateProfile(source, root, 'Fork'); let cancel = false;
    await expect(forkProfile(source, target, async () => { if (cancel) throw new Error('Cancelled'); }, () => { cancel = true; })).rejects.toThrow('Cancelled');
    expect(await fs.readdir(path.join(root, 'Profiles'))).toEqual([]);
    let changed = false;
    await expect(forkProfile(source, target, async () => { if (changed) await write(source.dataDir, 'Default/History', 'modified data'); }, () => { changed = true; })).rejects.toThrow('changed');
    expect(await fs.readdir(path.join(root, 'Profiles'))).toEqual([]);
  });
  it('copies a large nested profile exactly with parallel copies and checks before publishing', async () => {
    const root = await tmp(); const source = profile(path.join(root, 'source'));
    const files: string[] = [];
    for (let d = 0; d < 20; d++) for (let f = 0; f < 15; f++) { const rel = `Default/IndexedDB/site_${d}/leveldb/${f}.ldb`; files.push(rel); await write(source.dataDir, rel, `${rel}:${'x'.repeat(d * f)}`); }
    for (let f = 0; f < 30; f++) await write(source.dataDir, `Default/Cache/Cache_Data/${f}`);
    const target = duplicateProfile(source, root, 'Fork'); const events: string[] = []; let lastDone = 0, total = 0;
    await forkProfile(source, target, async () => {}, (done, all) => { expect(done).toBeGreaterThanOrEqual(lastDone); lastDone = done; total = all; }, async () => { events.push('settle'); expect(await fs.access(target.dataDir).then(() => true, () => false)).toBe(false); });
    expect(events).toEqual(['settle']); expect(lastDone).toBe(total);
    for (const rel of files) expect(await fs.readFile(path.join(target.dataDir, rel), 'utf8')).toBe(await fs.readFile(path.join(source.dataDir, rel), 'utf8'));
    expect(await fs.readdir(path.join(target.dataDir, 'Default'))).toEqual(['IndexedDB']);
  });
  it('does not publish a fork when the final check fails', async () => {
    const root = await tmp(); const source = profile(path.join(root, 'source')); await write(source.dataDir, 'Default/Cookies');
    const target = duplicateProfile(source, root, 'Fork');
    await expect(forkProfile(source, target, async () => {}, () => {}, async () => { throw new Error('Browser started'); })).rejects.toThrow('Browser started');
    expect(await fs.readdir(path.join(root, 'Profiles'))).toEqual([]);
  });
  it('rejects junctions without reading or deleting their targets', async () => {
    const root = await tmp(); const source = profile(path.join(root, 'source')); const outside = path.join(root, 'outside'); await write(source.dataDir, 'Default/Cookies'); await write(outside, 'keep');
    await fs.symlink(outside, path.join(source.dataDir, 'Default/linked'), 'junction');
    await expect(forkProfile(source, duplicateProfile(source, root, 'Fork'), async () => {}, () => {})).rejects.toThrow('Linked'); expect(await fs.readFile(path.join(outside, 'keep'), 'utf8')).toBe('keep');
  });
  it('stops before reading data when browser closure cannot be confirmed', async () => {
    const root = await tmp(); const source = profile(root);
    await expect(forkProfile(source, duplicateProfile(source, root, 'Fork'), async () => { throw new Error('Browser running'); }, () => {})).rejects.toThrow('Browser running');
  });
  it('refuses insufficient disk space without publishing partial data', async () => {
    const root = await tmp(); const source = profile(path.join(root, 'source')); await write(source.dataDir, 'Default/Cookies');
    vi.spyOn(fs, 'statfs').mockResolvedValue({ bavail: 0, bsize: 4096 } as any);
    const target = duplicateProfile(source, root, 'Fork');
    await expect(forkProfile(source, target, async () => {}, () => {})).rejects.toThrow('disk space');
    expect(await fs.readdir(path.join(root, 'Profiles'))).toEqual([]);
  });
});
describe('storage inventory', () => {
  it('measures persistent and cache data separately and leaves everything intact', async () => {
    const root = await tmp(); await write(root, 'Default/Cookies', '12345'); await write(root, 'Default/Cache/data', '123'); await write(root, 'Local State', '12'); await write(root, 'Profile 1/Cookies', 'sibling');
    const row = await scanProfileStorage(profile(root), () => {}); expect(row.bytes).toBe(8); expect(row.cacheBytes).toBe(3); expect(row.sharedBytes).toBe(2); expect(row.incomplete).toBe(false);
    expect(await fs.readFile(path.join(root, 'Default/Cookies'), 'utf8')).toBe('12345');
  });
  it('sums deeply nested folders exactly when walking in parallel', async () => {
    const root = await tmp(); let bytes = 0, cache = 0;
    for (let d = 0; d < 12; d++) for (let f = 0; f < 8; f++) { const data = 'y'.repeat(d + f + 1); await write(root, `Default/Deep/a${d}/b/c${f % 3}/file${f}`, data); bytes += data.length; }
    for (let f = 0; f < 10; f++) { await write(root, `Default/Code Cache/js/${f}`, '1234'); bytes += 4; cache += 4; }
    const row = await scanProfileStorage(profile(root), () => {}); expect(row.bytes).toBe(bytes); expect(row.cacheBytes).toBe(cache); expect(row.incomplete).toBe(false);
  });
  it('honors cancellation and skips junctions', async () => {
    const root = await tmp(); await write(root, 'Default/Cookies'); const out = await tmp(); await write(out, 'keep'); await fs.symlink(out, path.join(root, 'Default/link'), 'junction');
    const row = await scanProfileStorage(profile(root), () => {}); expect(row.incomplete).toBe(true);
    await expect(scanProfileStorage(profile(root), () => { throw new Error('Cancelled'); })).rejects.toThrow('Cancelled');
  });
});

describe('proxy forwarding', () => {
  const protector = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(`protected:${s}`), decryptString: (b: Buffer) => b.toString().slice(10) };
  const proxy = { ...emptyProxy(), mode: 'server' as const, host: '127.0.0.1', port: 8080, username: 'user' };
  it('keeps secrets outside public profile settings and supports replace/clear', () => {
    const saved = protectProxy({ ...proxy, password: 'p@ss:word' }, undefined, protector); expect(JSON.stringify(saved.proxy)).not.toContain('p@ss'); expect(revealProxy(saved.secret, protector)).toBe('p@ss:word');
    expect(protectProxy(proxy, saved.secret, protector).secret).toBe(saved.secret); expect(protectProxy({ ...proxy, clearPassword: true }, saved.secret, protector).secret).toBeUndefined();
    expect(() => protectProxy({ ...proxy, password: 'secret' }, undefined, { ...protector, isEncryptionAvailable: () => false })).toThrow('unavailable');
    expect(upstreamUrl({ ...proxy, protocol: 'socks5' }, 'p@ss')).toContain('socks5h://user:p%40ss@');
    expect(() => proxySchema.parse({ ...proxy, host: 'user:pass@host' })).toThrow();
  });
  it('forwards through authenticated HTTP and fails closed on rejected credentials', async () => {
    const target = http.createServer((_req, res) => res.end('through-proxy'));
    await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve)); closers.push(() => new Promise(resolve => target.close(resolve)));
    let accepted = 0; const upstream = new Server({ host: '127.0.0.1', port: 0, prepareRequestFunction: ({ username, password }) => { const ok = username === 'user' && password === 'secret'; if (ok) accepted++; return { requestAuthentication: !ok }; } });
    await upstream.listen(); closers.push(() => upstream.close(true));
    const request = (endpoint: string) => new Promise<{ status?: number; body: string }>((resolve, reject) => { const url = new URL(endpoint); const req = http.get({ hostname: url.hostname, port: url.port, path: `http://127.0.0.1:${(target.address() as net.AddressInfo).port}/` }, res => { let body = ''; res.on('data', c => body += c); res.on('end', () => resolve({ status: res.statusCode, body })); }); req.on('error', reject); });
    const good = await createBridge({ ...proxy, port: upstream.port! }, 'secret'); closers.push(good.close); expect((await request(good.endpoint)).body).toBe('through-proxy'); expect(accepted).toBe(1);
    const bad = await createBridge({ ...proxy, port: upstream.port! }, 'wrong'); closers.push(bad.close); expect((await request(bad.endpoint)).status).not.toBe(200); expect(accepted).toBe(1);
  });
  it('rejects untrusted upstream TLS certificates', async () => {
    const tlsServer = https.createServer({ key: await fs.readFile('tests/localhost-key.pem'), cert: await fs.readFile('tests/localhost-cert.pem') }, (_req, res) => res.end('should-not-reach'));
    await new Promise<void>(resolve => tlsServer.listen(0, '127.0.0.1', resolve)); closers.push(() => new Promise(resolve => tlsServer.close(resolve)));
    const bridge = await createBridge({ ...proxy, protocol: 'https', port: (tlsServer.address() as net.AddressInfo).port }, 'secret'); closers.push(bridge.close);
    const status = await new Promise(resolve => http.get({ hostname: '127.0.0.1', port: new URL(bridge.endpoint).port, path: 'http://example.invalid/' }, res => { res.resume(); resolve(res.statusCode); }));
    expect(status).not.toBe(200);
  });
  it('forwards through a trusted HTTPS upstream with credentials', async () => {
    const cert = await fs.readFile('tests/localhost-cert.pem'); const oldCa = https.globalAgent.options.ca;
    const tlsServer = https.createServer({ key: await fs.readFile('tests/localhost-key.pem'), cert }, (req, res) => { if (req.headers['proxy-authorization'] !== `Basic ${Buffer.from('user:secret').toString('base64')}`) res.writeHead(407); res.end('tls-proxy-ok'); });
    await new Promise<void>(resolve => tlsServer.listen(0, '127.0.0.1', resolve)); closers.push(() => new Promise(resolve => tlsServer.close(resolve)));
    https.globalAgent.options.ca = cert;
    try {
      const bridge = await createBridge({ ...proxy, protocol: 'https', port: (tlsServer.address() as net.AddressInfo).port }, 'secret'); closers.push(bridge.close);
      const response = await new Promise<{ status?: number; body: string }>(resolve => http.get({ hostname: '127.0.0.1', port: new URL(bridge.endpoint).port, path: 'http://example.invalid/' }, res => { let body = ''; res.on('data', c => body += c); res.on('end', () => resolve({ status: res.statusCode, body })); }));
      expect(response).toEqual({ status: 200, body: 'tls-proxy-ok' });
    } finally { https.globalAgent.options.ca = oldCa; }
  });
  it('cancels an in-flight test and closes the forwarding service', async () => {
    const sockets = new Set<net.Socket>(); const stalled = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise<void>(resolve => stalled.listen(0, '127.0.0.1', resolve)); closers.push(async () => { for (const s of sockets) s.destroy(); await new Promise(resolve => stalled.close(resolve)); });
    const controller = new AbortController(); const promise = testProxy({ ...proxy, port: (stalled.address() as net.AddressInfo).port }, '', controller.signal);
    setTimeout(() => controller.abort(), 100); await expect(promise).rejects.toThrow('Cancelled');
  });
  it('authenticates SOCKS5 and sends destination hostnames upstream', async () => {
    let seenHost = ''; let seenAuth = ''; const sockets = new Set<net.Socket>();
    const socks = net.createServer(socket => {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket)); let phase = 0; let buffer = Buffer.alloc(0);
      socket.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        if (phase === 0 && buffer.length >= 2 + buffer[1]) { buffer = buffer.subarray(2 + buffer[1]); socket.write(Buffer.from([5, 2])); phase = 1; }
        if (phase === 1 && buffer.length >= 2 + buffer[1] + 1) {
          const ulen = buffer[1], plen = buffer[2 + ulen]; if (buffer.length < 3 + ulen + plen) return;
          seenAuth = `${buffer.subarray(2, 2 + ulen)}:${buffer.subarray(3 + ulen, 3 + ulen + plen)}`;
          buffer = buffer.subarray(3 + ulen + plen); socket.write(Buffer.from([1, 0])); phase = 2;
        }
        if (phase === 2 && buffer.length >= 5 && buffer[3] === 3 && buffer.length >= 7 + buffer[4]) {
          seenHost = buffer.subarray(5, 5 + buffer[4]).toString(); buffer = buffer.subarray(7 + buffer[4]); socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80])); phase = 3;
        }
        if (phase === 3 && buffer.includes('\r\n\r\n')) { socket.end('HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\nsocks-ok'); phase = 4; }
      });
    });
    await new Promise<void>(resolve => socks.listen(0, '127.0.0.1', resolve)); closers.push(async () => { for (const s of sockets) s.destroy(); await new Promise(resolve => socks.close(resolve)); });
    const bridge = await createBridge({ ...proxy, protocol: 'socks5', port: (socks.address() as net.AddressInfo).port }, 'secret'); closers.push(bridge.close);
    const body = await new Promise<string>((resolve, reject) => { http.get({ hostname: '127.0.0.1', port: new URL(bridge.endpoint).port, path: 'http://only-upstream-can-resolve.invalid/' }, res => { let text = ''; res.on('data', c => text += c); res.on('end', () => resolve(text)); }).on('error', reject); });
    expect(body).toBe('socks-ok'); expect(seenHost).toBe('only-upstream-can-resolve.invalid'); expect(seenAuth).toBe('user:secret');
  });
});
