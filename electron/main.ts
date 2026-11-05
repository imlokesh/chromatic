import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, powerMonitor, safeStorage, screen, shell, Tray } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LaunchQueue, spawnBrowser } from './launch';
import { progressNotifier } from '../shared/performance';
import { z } from 'zod';
import { Store, draftSchema, referenceSchema, requireProfile, settingsSchema, visibleProfiles, proxySchema, labelList } from './store';
import { browserId, canonical, discoverProfiles, exists, installedBrowsers, launchArgs, mergeBrowsers, validateFlags } from './browsers';
import { Cleaner, browserClosed, closureMonitor, noLinks } from './cleanup';
import { PinGate } from './security';
import { dataDirInUse, processes } from './windows';
import { duplicateProfile, forkProfile, scanProfileStorage } from './profile-data';
import { createBridge, protectProxy, requireFreshPassword, revealProxy, testProxy } from './proxy';
import type { Browser, Candidate, Profile, Snapshot, Operation } from '../shared/types';

const root = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'Chromatic');
app.setPath('userData', root);
const store = new Store(root); const cleaner = new Cleaner(); const gate = new PinGate(store, safeStorage);
let manager: BrowserWindow | undefined; let launcher: BrowserWindow | undefined; let tray: Tray;
let quitting = false; let hotkeyError: string | undefined; let pending: Snapshot['pending'];
let discovered: Candidate[] = []; let wasUnlocked = false;
const uuid = z.string().uuid(); const idsSchema = z.array(uuid).max(1000);
class LaunchError extends Error { constructor(public code: string, message: string, public profileId: string) { super(message); } }
const operations = new Map<string, { value: Operation; controller: AbortController; fromLauncher?: boolean }>();
const launchQueue = new LaunchQueue();
const launched = new Map<string, { config: string; spawnedAt: number; bridge?: Awaited<ReturnType<typeof createBridge>> }>();
let browsersReady: Promise<void> = Promise.resolve();
function beginOperation(type: Operation['type'], profileIds: string[], work: (o: Operation, signal: AbortSignal) => Promise<void>) {
  for (const [id, op] of operations) if (op.value.status !== 'running' && operations.size >= 30) operations.delete(id);
  const value: Operation = { id: randomUUID(), type, profileIds, status: 'running', done: 0, total: 0, message: 'Preparing…' };
  const controller = new AbortController(); operations.set(value.id, { value, controller });
  void work(value, controller.signal).then(() => { value.status = 'complete'; }, error => { value.status = controller.signal.aborted ? 'cancelled' : 'error'; value.message = controller.signal.aborted ? 'Cancelled. No new profile was registered.' : error.name === 'AbortError' ? 'Cancelled.' : error.message || 'The operation failed. Please try again.'; }).finally(() => operationChanges.flush());
  operationChanges.flush(); return value.id;
}
function cancelPrivateOperations() { for (const o of operations.values()) if (o.value.profileIds.some(id => store.state.profiles.find(p => p.id === id)?.hidden)) o.controller.abort(); }
function publicProfile(p: Profile): Profile { return { ...p, proxy: { ...p.proxy, hasPassword: !!store.state.proxySecrets[p.id] } }; }
const asset = (name: string) => path.join(app.getAppPath(), 'assets', name);
const changed = () => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('changed'); };
const refreshWindow = (window?: BrowserWindow) => { if (window && !window.isDestroyed()) window.webContents.send('changed'); };
// Progress only changes operations, so the manager rereads those instead of every profile.
const operationChanges = progressNotifier(() => { if (manager && !manager.isDestroyed()) manager.webContents.send('operations'); });
function visibleOperations(isLauncher: boolean) {
  if (isLauncher) return [];
  const profiles = new Map(store.state.profiles.map(p => [p.id, p]));
  return [...operations.values()].map(o => o.value).filter(o => o.profileIds.every(id => { const p = profiles.get(id); return p && (!p.hidden || gate.unlocked); }) || !o.profileIds.length);
}
// Record the lock so the idle-expiry watcher doesn't repeat this work and refresh again.
function lock() { gate.lock(); wasUnlocked = false; cancelPrivateOperations(); cleaner.invalidate(); changed(); }
function profile(id: unknown) { return requireProfile(store.state.profiles, uuid.parse(id), gate.unlocked); }
function browserFor(p: Profile) { const b = store.state.browsers.find(b => b.id === p.browserId); if (!b) throw new Error('Choose an installed browser for this profile.'); return b; }
function sameLocation(a: Pick<Profile, 'dataDir' | 'profileDir'>, b: Pick<Profile, 'dataDir' | 'profileDir'>) { return canonical(a.dataDir) === canonical(b.dataDir) && (a.profileDir || 'Default') === (b.profileDir || 'Default'); }

function createWindow(mode: 'manager' | 'launcher') {
  const quick = mode === 'launcher';
  const window = new BrowserWindow({ width: quick ? 690 : 1180, height: quick ? 520 : 790, minWidth: quick ? 590 : 900, minHeight: quick ? 420 : 600,
    show: false, frame: !quick, resizable: !quick, alwaysOnTop: quick, skipTaskbar: quick,
    title: 'Chromatic', backgroundColor: nativeTheme.shouldUseDarkColors ? '#1d1d24' : '#f7f6f2', icon: asset('icon.ico'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: !app.isPackaged } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', e => e.preventDefault());
  window.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'), { query: { mode } });
  if (quick) window.on('blur', () => window.hide());
  else window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); pending = undefined; lock(); } });
  return window;
}
// Rewritten on every start so the Windows entry follows the saved choice even after a reinstall or move.
// Unpackaged runs would register the bare Electron binary, so only installed builds touch it.
function syncLoginItem() { if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: store.state.settings.startup, args: ['--background'] }); }
function showManager(id?: string) {
  if (id) { profile(id); pending = { action: 'edit', id }; }
  if (!manager || manager.isDestroyed()) manager = createWindow('manager');
  if (manager.isMinimized()) manager.restore(); manager.show(); manager.focus(); refreshWindow(manager);
}
// Created hidden ahead of time so the first shortcut press doesn't wait for a new renderer.
function prepareLauncher() { if (!launcher || launcher.isDestroyed()) launcher = createWindow('launcher'); return launcher; }
function showLauncher() {
  const quick = prepareLauncher();
  if (quick.isVisible()) { quick.hide(); return; }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const [width] = quick.getSize(); quick.setPosition(Math.round(area.x + (area.width - width) / 2), Math.round(area.y + area.height * .2));
  quick.show(); quick.focus(); refreshWindow(quick);
}
async function refreshBrowsers() {
  const installed = await installedBrowsers(); const before = JSON.stringify(store.state.browsers);
  store.state.browsers = mergeBrowsers(store.state.browsers, installed);
  if (JSON.stringify(store.state.browsers) !== before) { await store.persist(); changed(); }
}
function registerHotkey() {
  globalShortcut.unregisterAll(); hotkeyError = undefined;
  try { if (!globalShortcut.register(store.state.settings.hotkey, showLauncher)) hotkeyError = 'This shortcut is already in use. Choose another in Settings.'; }
  catch { hotkeyError = 'This shortcut is not valid. Choose another in Settings.'; }
}
async function launch(id: string, fromLauncher = false) {
  const requested = profile(id);
  if (fromLauncher) launcher?.hide();
  const existing = launchQueue.pending(id);
  if (existing) {
    const record = [...operations.values()].find(o => o.value.type === 'launch' && o.value.status === 'running' && o.value.profileIds.includes(id));
    if (record) record.fromLauncher ||= fromLauncher;
    return existing;
  }
  // Register before entering the root queue so locking also cancels queued work.
  const value: Operation = { id: randomUUID(), type: 'launch', profileIds: [id], status: 'running', done: 0, total: 0, message: 'Starting browser…' };
  const controller = new AbortController();
  const record = { value, controller, fromLauncher };
  for (const [key, op] of operations) if (op.value.status !== 'running' && operations.size >= 30) operations.delete(key);
  operations.set(value.id, record); operationChanges.flush();
  return launchQueue.run(id, canonical(requested.dataDir), async () => {
    const fail = (error: any) => {
      value.status = controller.signal.aborted ? 'cancelled' : 'error';
      value.message = controller.signal.aborted ? 'Launch cancelled.' : error.message || 'The browser could not start.';
      value.recoveryCode = error instanceof LaunchError ? error.code : undefined;
      operationChanges.flush();
      // Locked or removed profiles must never open a recovery surface with private data.
      const current = store.state.profiles.find(p => p.id === id);
      if (record.fromLauncher && current && (!current.hidden || gate.unlocked) && !controller.signal.aborted) showManager();
    };
    try {
      await performLaunch(id, controller.signal, fail);
      if (value.status === 'running') { value.status = 'complete'; value.message = 'Launch request sent.'; }
      operationChanges.flush();
    } catch (error) { fail(error); throw error; }
  });
}
function ensureLaunchAllowed() {
  if (cleaner.busy.size || [...operations.values()].some(o => o.value.type === 'fork' && o.value.status === 'running')) throw new Error('Wait for cache cleanup or copying to finish before launching a browser.');
}
// The lockfile answers in about a millisecond, where a process query takes seconds. A browser
// Chromatic started moments ago may not have created it yet (Brave needed ~550 ms), and an
// unreadable lock is uncertain, so those cases still read process command lines.
async function dataDirRunning(b: Pick<Browser, 'executable'>, p: Profile, recentlySpawned: boolean) {
  const locked = await dataDirInUse(p.dataDir);
  if (locked === true || (locked === false && !recentlySpawned)) return locked;
  const running = await processes(path.basename(b.executable));
  return running.some(proc => !proc.CommandLine || proc.CommandLine.toLowerCase().includes(canonical(p.dataDir)) || (p.kind === 'existing' && !proc.CommandLine.includes('--user-data-dir')));
}
async function performLaunch(id: string, signal: AbortSignal, earlyFailure: (error: Error) => void) {
  await browsersReady;
  signal.throwIfAborted();
  const p = structuredClone(profile(id)); const b = structuredClone(browserFor(p));
  const settings = structuredClone(store.state.settings);
  const secret = store.state.proxySecrets[id];
  ensureLaunchAllowed();
  if (!await exists(b.executable)) throw new LaunchError('browser', 'The browser executable is missing. Locate its new installation to reconnect your profiles.', p.id);
  if (!await exists(p.dataDir)) {
    if (p.kind === 'existing' || p.lastUsed) throw new LaunchError('storage', 'The profile folder is unavailable. Reconnect its drive, then retry.', p.id);
    await fs.mkdir(p.dataDir, { recursive: true });
  }
  // Reject invalid arguments before allocating a proxy bridge.
  launchArgs(b, p, settings);
  const key = canonical(p.dataDir); const config = JSON.stringify([p.flags, p.noDefaultFlags, settings.defaultFlags, p.proxy, secret]);
  const current = launched.get(key);
  const runningHere = await dataDirRunning(b, p, !!current && Date.now() - current.spawnedAt < 15_000);
  if (runningHere && (!current || current.config !== config)) throw new LaunchError('restart', 'This browser data folder is already in use. Close its browser windows and background processes, then launch again to apply these settings.', p.id);
  let bridge = current?.bridge;
  let createdBridge: Awaited<ReturnType<typeof createBridge>> | undefined;
  let spawned = false;
  try {
    if (p.proxy.mode === 'server') {
      if (!current || current.config !== config || !bridge) {
        if (bridge) { await bridge.close(); launched.delete(key); }
        bridge = createdBridge = await createBridge(p.proxy, revealProxy(secret, safeStorage));
      }
    } else {
      if (!runningHere && bridge) { await bridge.close(); launched.delete(key); }
      bridge = undefined;
    }
    signal.throwIfAborted();
    const latest = profile(id);
    if (JSON.stringify([latest.flags, latest.noDefaultFlags, store.state.settings.defaultFlags, latest.proxy, store.state.proxySecrets[id]]) !== config || latest.browserId !== p.browserId || browserFor(latest).executable !== b.executable || JSON.stringify([latest.urls, latest.extensions]) !== JSON.stringify([p.urls, p.extensions])) throw new Error('Profile settings changed while preparing the launch. Please retry.');
    ensureLaunchAllowed();
    await spawnBrowser(b.executable, launchArgs(b, p, settings, bridge?.endpoint), earlyFailure);
    spawned = true;
    launched.set(key, { config, bridge, spawnedAt: Date.now() });
    const registered = store.state.profiles.find(item => item.id === id);
    if (registered) registered.lastUsed = Date.now();
    changed();
    try { await store.persist(); }
    catch { throw new LaunchError('save', 'The browser started, but its recent-use time could not be saved. Check that Chromatic’s settings folder is writable.', id); }
  } catch (error) {
    if (!spawned && createdBridge) await createdBridge.close().catch(() => {});
    throw error;
  }
}

async function handleFileArgs(args: string[]) {
  const file = args.find(a => a.toLowerCase().endsWith('.chromatic'));
  if (!file) { showManager(); return; }
  try {
    const stat = await fs.stat(file); if (stat.size > 4096) throw new Error('This profile reference is too large.');
    const ref = referenceSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
    const p = store.state.profiles.find(p => p.id === ref.profileId);
    if (!p) throw new Error('This file references a profile that is not registered on this computer.');
    const action = args.includes('--edit') ? 'edit' : 'launch';
    if (p.hidden && !gate.unlocked) { pending = { id: p.id, action }; showManager(); changed(); }
    else if (action === 'edit') showManager(p.id); else await launch(p.id);
  } catch (error: any) { dialog.showErrorBox('Unable to open profile', error.message); }
}

function snapshot(isLauncher: boolean): Snapshot {
  return { profiles: visibleProfiles(store.state.profiles, gate.unlocked, isLauncher).map(publicProfile), browsers: store.state.browsers,
    settings: store.state.settings, unlocked: gate.unlocked, hasPin: Boolean(store.state.pin), hotkeyError,
    pending: isLauncher ? undefined : pending, version: app.getVersion(), operations: visibleOperations(isLauncher) };
}
async function dispatch(sender: Electron.WebContents, method: string, args: unknown[]) {
  const isLauncher = sender === launcher?.webContents;
  if (method === 'snapshot') return snapshot(isLauncher);
  // Text replies are parsed in the page. Copying the object through the context bridge cost
  // ~14 ms per 1,000 profiles; a string costs ~4 ms including JSON.parse.
  if (method === 'snapshotText') return JSON.stringify(snapshot(isLauncher));
  if (method === 'operationsText') return JSON.stringify(visibleOperations(isLauncher));
  if (method === 'launch') return launch(uuid.parse(args[0]), isLauncher);
  if (method === 'launcher') { showLauncher(); return; }
  if (method === 'clearPending') { pending = undefined; return; }
  if (method === 'manager') { launcher?.hide(); showManager(args[0] ? uuid.parse(args[0]) : undefined); return; }
  if (method === 'dismiss') { if (isLauncher) launcher?.hide(); else { pending = undefined; manager?.hide(); lock(); } return; }
  if (method === 'lock') { pending = undefined; lock(); return; }
  if (method === 'unlock') {
    if (isLauncher) throw new Error('Open the manager to unlock profiles.');
    await gate.unlock(z.string().parse(args[0]));
    if (pending?.action === 'launch') { const id = pending.id; pending = undefined; await launch(id); }
    changed(); return;
  }
  if (method === 'setPin') { if (isLauncher) throw new Error('Open the manager to set a PIN.'); await gate.set(z.string().parse(args[0]), z.string().optional().parse(args[1])); changed(); return; }
  if (isLauncher && !['launch', 'launcher', 'manager', 'dismiss', 'clearPending', 'lock'].includes(method)) throw new Error('Open the manager to change profiles.');
  if (method === 'copyProfile') {
    const source = structuredClone(profile(args[0])); const mode = z.enum(['duplicate', 'fork']).parse(args[1]); const name = z.string().trim().min(1).max(120).parse(args[2]);
    if (cleaner.busy.size || [...operations.values()].some(o => o.value.type === 'fork' && o.value.status === 'running')) throw new Error('Wait for the current copy or cleanup to finish.');
    if (mode === 'fork' && launchQueue.hasRoot(canonical(source.dataDir))) throw new Error('Wait for this browser launch to finish before copying its data.');
    const target = duplicateProfile(source, root, name); const browser = browserFor(source); const secret = store.state.proxySecrets[source.id];
    return beginOperation(mode, [source.id], async (o, signal) => {
      // Closure is confirmed before anything is read, then rechecked in the background while
      // copying, and once more after the final source verification before publishing.
      let monitor: ReturnType<typeof closureMonitor> | undefined;
      const check = async () => { signal.throwIfAborted(); profile(source.id); monitor?.check(); };
      try {
      if (mode === 'fork') {
        o.message = 'Copying persistent browser data…';
        await check(); await browserClosed(browser);
        monitor = closureMonitor(notBefore => browserClosed(browser, notBefore));
        await forkProfile(source, target, check, (done, total) => { o.done = done; o.total = total; operationChanges.progress(); }, () => monitor!.settle());
      }
      signal.throwIfAborted(); profile(source.id);
      store.state.profiles.push(target); if (secret) store.state.proxySecrets[target.id] = secret;
      try { await store.persist(); } catch (e) { store.state.profiles = store.state.profiles.filter(p => p.id !== target.id); delete store.state.proxySecrets[target.id]; throw e; }
      } catch (e) {
        if (mode === 'fork' && !store.state.profiles.some(p => p.id === target.id) && await exists(target.dataDir)) {
          const parent = path.join(root, 'Profiles');
          if (path.dirname(target.dataDir) !== parent || path.basename(target.dataDir) !== target.id) throw new Error('Unexpected fork destination.');
          await noLinks(target.dataDir); await fs.rm(target.dataDir, { recursive: true, force: true });
        }
        throw e;
      } finally { monitor?.stop(); }
      changed(); o.resultId = target.id; o.message = mode === 'fork' ? 'Fork ready. Browser data was copied; some sites may ask you to sign in again.' : 'Duplicate ready. Its browser data starts empty.';
    });
  }
  if (method === 'cancelOperation') { const o = operations.get(uuid.parse(args[0])); if (o && o.value.type !== 'launch') { for (const id of o.value.profileIds) profile(id); o.controller.abort(); } return; }
  if (method === 'scanStorage') {
    const profiles = [...new Set(idsSchema.parse(args[0]))].map(id => structuredClone(profile(id)));
    // Only the latest scan is shown; older results would otherwise ride along in every snapshot.
    for (const [key, op] of operations) if (op.value.type === 'storage' && op.value.status !== 'running') operations.delete(key);
    return beginOperation('storage', profiles.map(p => p.id), async (o, signal) => { o.total = profiles.length; o.storage = []; for (const p of profiles) { const check = () => { signal.throwIfAborted(); profile(p.id); }; check(); o.message = 'Measuring profile data…'; const row = await scanProfileStorage(p, check); check(); o.storage.push(row); o.done++; operationChanges.progress(); } o.message = 'Storage scan complete. Sizes are estimates while browsers are running.'; });
  }
  if (method === 'testProxy') {
    const proxy = proxySchema.parse(args[0]); const p = args[1] ? profile(args[1]) : undefined;
    if (p) requireFreshPassword(proxy, p.proxy, store.state.proxySecrets[p.id]);
    const password = proxy.clearPassword ? '' : proxy.password || revealProxy(p ? store.state.proxySecrets[p.id] : undefined, safeStorage);
    return beginOperation('proxy', p ? [p.id] : [], async (o, signal) => { o.message = 'Checking connection through the proxy…'; o.proxyResult = await testProxy(proxy, password, signal); if (p) profile(p.id); o.message = 'Proxy connected.'; });
  }
  if (method === 'labels') {
    const profiles = [...new Set(idsSchema.parse(args[0]))].map(id => profile(id)); const labels = labelList.parse(args[1]); const mode = z.enum(['add', 'remove']).parse(args[2]);
    const changes = profiles.map(p => ({ p, labels: labelList.parse(mode === 'add' ? [...p.labels, ...labels] : p.labels.filter(l => !labels.some(v => v.toLocaleLowerCase() === l.toLocaleLowerCase()))) }));
    for (const change of changes) change.p.labels = change.labels; await store.persist(); changed(); return;
  }
  if (method === 'openFolder') { const p = profile(args[0]); const error = await shell.openPath(p.dataDir); if (error) throw new Error('This folder is unavailable. Reconnect its drive and try again.'); return; }
  if (method === 'locateBrowser') {
    const p = profile(args[0]); const b = browserFor(p); const result = await dialog.showOpenDialog({ title: `Locate ${b.name}`, properties: ['openFile'], filters: [{ name: 'Browser executable', extensions: ['exe'] }] });
    if (!result.canceled) { profile(p.id); b.executable = result.filePaths[0]; await store.persist(); changed(); } return;
  }
  if (method === 'save') {
    const draft = draftSchema.parse(args[0]);
    if (draft.id && [...operations.values()].some(o => o.value.type === 'fork' && o.value.status === 'running' && o.value.profileIds.includes(draft.id!))) throw new Error('Wait for the fork to finish before editing its source.'); const old = draft.id ? profile(draft.id) : undefined;
    if (draft.hidden && (!store.state.pin || !gate.unlocked)) throw new Error('Set and unlock your PIN in Settings before hiding a profile.');
    const b = store.state.browsers.find(b => b.id === draft.browserId); if (!b) throw new Error('Choose an installed browser.');
    const id = old?.id || randomUUID();
    if (old && (draft.dataDir !== old.dataDir || draft.profileDir !== old.profileDir || draft.browserId !== old.browserId || draft.kind !== old.kind)) throw new Error('A saved profile’s browser and data location are fixed. Add a separate profile to use a different location.');
    const dataDir = draft.dataDir || path.join(root, 'Profiles', id);
    if (!path.isAbsolute(dataDir)) throw new Error('Choose an absolute profile folder.');
    if (draft.profileDir && (path.basename(draft.profileDir) !== draft.profileDir || ['.', '..'].includes(draft.profileDir))) throw new Error('Invalid browser profile folder.');
    if (draft.kind === 'existing' && !await exists(dataDir)) throw new Error('The selected profile folder does not exist.');
    if (!old && draft.kind === 'managed' && await exists(dataDir) && (await fs.readdir(dataDir)).length) throw new Error('Choose an empty folder for a new isolated profile, or add it as an existing profile.');
    const p: Profile = { ...draft, id, dataDir, createdAt: old?.createdAt || Date.now(), lastUsed: old?.lastUsed };
    if (store.state.profiles.some(other => other.id !== p.id && sameLocation(other, p))) throw new Error('This browser data location is already registered.');
    const protectedProxy = protectProxy(draft.proxy, old ? store.state.proxySecrets[old.id] : undefined, safeStorage, old?.proxy);
    p.proxy = protectedProxy.proxy;
    launchArgs(b, { ...p, proxy: { ...p.proxy, mode: p.proxy.mode === 'review' ? 'system' : p.proxy.mode } }, store.state.settings);
    if (cleaner.busy.has(id)) throw new Error('Wait for slimming to finish before editing this profile.');
    cleaner.invalidate(id);
    if (protectedProxy.secret) store.state.proxySecrets[id] = protectedProxy.secret; else delete store.state.proxySecrets[id];
    store.state.profiles = [...store.state.profiles.filter(p => p.id !== id), p]; await store.persist(); pending = undefined; changed(); return publicProfile(p);
  }
  if (method === 'remove') { const p = profile(args[0]); if (cleaner.busy.has(p.id) || [...operations.values()].some(o => o.value.status === 'running' && o.value.profileIds.includes(p.id))) throw new Error('Wait for the current profile operation to finish.'); delete store.state.proxySecrets[p.id]; store.state.profiles = store.state.profiles.filter(x => x.id !== p.id); cleaner.invalidate(p.id); await store.persist(); changed(); return; }
  if (method === 'discover') {
    const installed = await installedBrowsers(); store.state.browsers = mergeBrowsers(store.state.browsers, installed); await store.persist();
    discovered = (await discoverProfiles(store.state.browsers)).filter(c => !store.state.profiles.some(p => sameLocation(p, c)));
    changed(); return discovered;
  }
  if (method === 'importProfiles') {
    const keys = z.array(z.string()).max(1000).parse(args[0]);
    for (const key of keys) {
      const candidate = discovered.find(c => c.key === key); if (!candidate) throw new Error('Refresh browser discovery before adding profiles.');
      if (store.state.profiles.some(p => sameLocation(p, candidate))) continue;
      const { key: _, ...location } = candidate;
      store.state.profiles.push({ ...location, id: randomUUID(), createdAt: Date.now(), kind: 'existing', labels: [], color: '#8070c6', favorite: false, hidden: false, urls: [], flags: [], extensions: [], proxy: { mode: 'system', protocol: 'http', host: '', port: 8080, username: '' }, noDefaultFlags: false });
    }
    await store.persist(); changed(); return;
  }
  if (method === 'addBrowser') {
    const family = 'chromium' as const;
    const result = await dialog.showOpenDialog({ title: 'Choose browser executable', filters: [{ name: 'Browser executable', extensions: ['exe'] }], properties: ['openFile'] });
    if (!result.canceled) { const executable = result.filePaths[0]; const id = browserId(executable); store.state.browsers = store.state.browsers.filter(b => b.id !== id); store.state.browsers.push({ id, executable, name: path.basename(executable, '.exe'), family, unpackedExtensions: false }); await store.persist(); changed(); } return;
  }
  if (method === 'chooseDirectory') { const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0]; }
  if (method === 'exportProfiles') {
    const profiles = idsSchema.parse(args[0]).map(id => profile(id)); if (!profiles.length) return 0;
    const result = await dialog.showOpenDialog({ title: 'Export profile files', properties: ['openDirectory', 'createDirectory'] }); if (result.canceled) return 0;
    let count = 0;
    for (const p of profiles) {
      profile(p.id);
      const name = p.hidden ? `Profile-${p.id.slice(0, 8)}` : p.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[ .]+$/g, '').slice(0, 90) || 'Profile';
      const filename = path.join(result.filePaths[0], `${name}-${p.hidden ? 'private' : p.id.slice(0, 8)}.chromatic`);
      try { await fs.writeFile(filename, JSON.stringify({ version: 1, profileId: p.id }, null, 2), { flag: 'wx' }); count++; }
      catch (e: any) { if (e.code !== 'EEXIST') throw e; }
    }
    return count;
  }
  if (method === 'previewSlim') {
    const profiles = idsSchema.parse(args[0]).map(id => profile(id)); const browsers = profiles.map(browserFor);
    // Concurrent previews share one process query per browser instead of one each.
    const previews = await Promise.all(profiles.map((p, i) => cleaner.preview(p, browsers[i]))); for (const p of profiles) profile(p.id); return previews;
  }
  if (method === 'clean') {
    if ([...operations.values()].some(o => o.value.type === 'fork' && o.value.status === 'running')) throw new Error('Wait for the fork to finish before clearing cache.');
    const tokens = idsSchema.parse(args[0]); const results = []; const checkedIds: string[] = [];
    for (const token of tokens) { const id = cleaner.profileForToken(token); if (!id) throw new Error('Scan this profile again before cleanup.'); const p = profile(id); if (launchQueue.hasRoot(canonical(p.dataDir))) throw new Error('Wait for this browser launch to finish before clearing its cache.'); checkedIds.push(id); results.push(await cleaner.clean(token)); }
    for (const id of checkedIds) profile(id);
    return results;
  }
  if (method === 'settings') {
    const settings = settingsSchema.parse(args[0]); validateFlags(settings.defaultFlags.chromium); 
    store.state.settings = settings; nativeTheme.themeSource = settings.theme;
    syncLoginItem();
    registerHotkey(); await store.persist(); changed(); return;
  }
  throw new Error('Unknown operation.');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, args) => { void handleFileArgs(args); });
  app.whenReady().then(async () => {
    await store.load();
    nativeTheme.themeSource = store.state.settings.theme; syncLoginItem();
    // Saved browsers are usable at once; detection finishes in the background and refreshes the windows.
    browsersReady = refreshBrowsers().catch(() => {});
    ipcMain.handle('chromatic', async (event, method, ...args) => {
      if (![manager?.webContents, launcher?.webContents].includes(event.sender) || event.senderFrame !== event.sender.mainFrame) return { ok: false, error: 'Untrusted caller.' };
      try { return { ok: true, value: await dispatch(event.sender, method, args) }; }
      catch (error: any) { return { ok: false, code: error instanceof LaunchError ? error.code : undefined, profileId: error instanceof LaunchError ? error.profileId : undefined, error: error instanceof z.ZodError ? 'Some profile settings are invalid. Check the fields and try again.' : error.message || 'The operation could not be completed.' }; }
    });
    ipcMain.on('activity', event => { if (event.sender === manager?.webContents) gate.activity(); });
    tray = new Tray(nativeImage.createFromPath(asset('tray.png'))); tray.setToolTip('Chromatic');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Quick launcher', click: showLauncher }, { label: 'Profile manager', click: () => showManager() }, { label: 'Lock discreet profiles', click: lock }, { type: 'separator' }, { label: 'Quit Chromatic', click: () => app.quit() }]));
    tray.on('click', showLauncher); registerHotkey();
    powerMonitor.on('lock-screen', lock); powerMonitor.on('suspend', lock);
    setInterval(() => { if (wasUnlocked && !gate.unlocked) { cancelPrivateOperations(); cleaner.invalidate(); changed(); } wasUnlocked = gate.unlocked; }, 1000).unref();
    if (!process.argv.includes('--background')) await handleFileArgs(process.argv);
    // Leave startup to the manager, then warm the launcher.
    setTimeout(prepareLauncher, 1500).unref();
  }).catch(error => { dialog.showErrorBox('Chromatic could not start', error.message); app.quit(); });
}
app.on('before-quit', event => {
  if (!quitting && [...operations.values()].some(o => o.value.status === 'running')) { event.preventDefault(); showManager(); dialog.showMessageBoxSync({ type: 'info', message: 'An operation is still running.', detail: 'Wait for it to finish, or cancel it in Chromatic before quitting.' }); return; }
  if (!quitting && [...launched.values()].some(v => v.bridge)) {
    const choice = dialog.showMessageBoxSync({ type: 'question', buttons: ['Keep running', 'Quit Chromatic'], defaultId: 0, cancelId: 0, message: 'Quit and stop proxy connections?', detail: 'Browsers using Chromatic proxy connections will lose their connection. Close them before restarting Chromatic.' });
    if (choice === 0) { event.preventDefault(); return; }
  }
  quitting = true; gate.lock(); for (const v of launched.values()) void v.bridge?.close();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {});
