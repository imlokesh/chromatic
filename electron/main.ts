import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, powerMonitor, safeStorage, screen, Tray } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { Store, draftSchema, referenceSchema, requireProfile, settingsSchema, visibleProfiles } from './store';
import { browserId, canonical, detectBrowsers, discoverProfiles, exists, firefoxProxyPrefs, launchArgs, validateFlags } from './browsers';
import { Cleaner, browserClosed, noLinks } from './cleanup';
import { PinGate } from './security';
import { processes } from './windows';
import type { Candidate, Profile, Snapshot } from '../shared/types';

const root = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'Chromatic');
app.setPath('userData', root);
const store = new Store(root); const cleaner = new Cleaner(); const gate = new PinGate(store, safeStorage);
let manager: BrowserWindow | undefined; let launcher: BrowserWindow | undefined; let tray: Tray;
let quitting = false; let hotkeyError: string | undefined; let pending: Snapshot['pending'];
let discovered: Candidate[] = []; let wasUnlocked = false;
const uuid = z.string().uuid(); const idsSchema = z.array(uuid).max(1000);
const asset = (name: string) => path.join(app.getAppPath(), 'assets', name);
const changed = () => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('changed'); };
function lock() { gate.lock(); cleaner.invalidate(); changed(); }
function profile(id: unknown) { return requireProfile(store.state.profiles, uuid.parse(id), gate.unlocked); }
function browserFor(p: Profile) { const b = store.state.browsers.find(b => b.id === p.browserId); if (!b) throw new Error('Choose an installed browser for this profile.'); return b; }
function sameLocation(a: Pick<Profile, 'dataDir' | 'profileDir'>, b: Pick<Profile, 'dataDir' | 'profileDir'>) { return canonical(a.dataDir) === canonical(b.dataDir) && (a.profileDir || 'Default') === (b.profileDir || 'Default'); }

function createWindow(mode: 'manager' | 'launcher') {
  const quick = mode === 'launcher';
  const window = new BrowserWindow({ width: quick ? 690 : 1180, height: quick ? 520 : 790, minWidth: quick ? 590 : 900, minHeight: quick ? 420 : 600,
    show: false, frame: !quick, resizable: !quick, alwaysOnTop: quick, skipTaskbar: quick,
    title: 'Chromatic', backgroundColor: nativeTheme.shouldUseDarkColors ? '#1d1d24' : '#f7f6f2', icon: asset('icon.ico'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', e => e.preventDefault());
  window.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'), { query: { mode } });
  if (quick) window.on('blur', () => window.hide());
  else window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); pending = undefined; lock(); } });
  return window;
}
function showManager(id?: string) {
  if (id) { profile(id); pending = { action: 'edit', id }; }
  if (!manager || manager.isDestroyed()) manager = createWindow('manager');
  if (manager.isMinimized()) manager.restore(); manager.show(); manager.focus(); changed();
}
function showLauncher() {
  if (!launcher || launcher.isDestroyed()) launcher = createWindow('launcher');
  if (launcher.isVisible()) { launcher.hide(); return; }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const [width] = launcher.getSize(); launcher.setPosition(Math.round(area.x + (area.width - width) / 2), Math.round(area.y + area.height * .2));
  launcher.show(); launcher.focus(); changed();
}
function registerHotkey() {
  globalShortcut.unregisterAll(); hotkeyError = undefined;
  try { if (!globalShortcut.register(store.state.settings.hotkey, showLauncher)) hotkeyError = 'This shortcut is already in use. Choose another in Settings.'; }
  catch { hotkeyError = 'This shortcut is not valid. Choose another in Settings.'; }
}
async function launch(id: string) {
  const p = profile(id); const b = browserFor(p);
  if (cleaner.busy.size) throw new Error('Wait for cache cleanup to finish before launching a browser.');
  if (!await exists(b.executable)) throw new Error('The browser executable is missing. Add its new location in Browsers.');
  if (!await exists(p.dataDir)) {
    if (p.kind === 'existing') throw new Error('The existing profile directory is unavailable. Reconnect its drive or update the profile.');
    await fs.mkdir(p.dataDir, { recursive: true });
  }
  const args = launchArgs(b, p, store.state.settings);
  if (b.family === 'firefox') {
    // Isolated Firefox instances may coexist, but cannot accept repeat remote commands.
    const running = (await processes()).filter(proc => proc.Name.toLowerCase() === path.basename(b.executable).toLowerCase());
    const target = canonical(p.dataDir);
    if (running.some(proc => !proc.CommandLine || proc.CommandLine.toLowerCase().includes(target))) throw new Error('This Firefox profile may already be running. Close its windows before launching it again.');
    const lockPath = path.join(p.dataDir, 'parent.lock');
    if (await exists(lockPath)) {
      try { const handle = await fs.open(lockPath, 'r+'); await handle.close(); }
      catch { throw new Error('This Firefox profile is in use. Close it before launching again.'); }
    }
    if (p.kind === 'managed') {
      await noLinks(p.dataDir);
      const userJs = path.join(p.dataDir, 'user.js');
      if (await exists(userJs)) await noLinks(userJs);
      const original = await fs.readFile(userJs, 'utf8').catch((e: any) => { if (e.code === 'ENOENT') return ''; throw e; });
      const clean = original.replace(/\/\/ BEGIN CHROMATIC[\s\S]*?\/\/ END CHROMATIC\r?\n?/g, '');
      await fs.writeFile(userJs, `${clean}\n// BEGIN CHROMATIC\n${firefoxProxyPrefs(p.proxy)}\n// END CHROMATIC\n`);
    }
  }
  profile(id); // Recheck a hidden profile after asynchronous filesystem/process checks.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(b.executable, args, { detached: true, stdio: 'ignore', windowsHide: false, shell: false });
    let timer: ReturnType<typeof setTimeout>;
    child.once('error', reject);
    child.once('spawn', () => { timer = setTimeout(() => { child.unref(); resolve(); }, 900); });
    child.once('exit', code => { clearTimeout(timer); if (code && code !== 0) reject(new Error(`The browser exited with code ${code}. Check its profile location and launch settings.`)); else resolve(); });
  });
  p.lastUsed = Date.now(); await store.persist(); launcher?.hide(); changed();
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

async function dispatch(sender: Electron.WebContents, method: string, args: unknown[]) {
  const isLauncher = sender === launcher?.webContents;
  if (method === 'snapshot') {
    const result: Snapshot = { profiles: visibleProfiles(store.state.profiles, gate.unlocked, isLauncher), browsers: store.state.browsers,
      settings: store.state.settings, unlocked: gate.unlocked, hasPin: Boolean(store.state.pin), hotkeyError,
      pending: isLauncher ? undefined : pending, version: app.getVersion() };
    return result;
  }
  if (method === 'launch') return launch(uuid.parse(args[0]));
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
  if (method === 'save') {
    const draft = draftSchema.parse(args[0]); const old = draft.id ? profile(draft.id) : undefined;
    if (draft.hidden && (!store.state.pin || !gate.unlocked)) throw new Error('Set and unlock your PIN in Settings before hiding a profile.');
    const b = store.state.browsers.find(b => b.id === draft.browserId); if (!b) throw new Error('Choose an installed browser.');
    const id = old?.id || randomUUID();
    if (old && (draft.dataDir !== old.dataDir || draft.profileDir !== old.profileDir || draft.browserId !== old.browserId || draft.kind !== old.kind)) throw new Error('A saved profile’s browser and data location are fixed. Add a separate profile to use a different location.');
    const dataDir = draft.dataDir || path.join(root, 'Profiles', id);
    if (!path.isAbsolute(dataDir)) throw new Error('Choose an absolute profile folder.');
    if (draft.profileDir && (path.basename(draft.profileDir) !== draft.profileDir || ['.', '..'].includes(draft.profileDir))) throw new Error('Invalid browser profile folder.');
    if (draft.kind === 'existing' && !await exists(dataDir)) throw new Error('The selected profile folder does not exist.');
    if (!old && draft.kind === 'managed' && await exists(dataDir) && (await fs.readdir(dataDir)).length) throw new Error('Choose an empty folder for a new isolated profile, or add it as an existing profile.');
    const p: Profile = { ...draft, id, dataDir, cacheRoot: old?.cacheRoot || (b.family === 'firefox' ? dataDir : undefined), createdAt: old?.createdAt || Date.now(), lastUsed: old?.lastUsed };
    if (store.state.profiles.some(other => other.id !== p.id && sameLocation(other, p))) throw new Error('This browser data location is already registered.');
    if (b.family === 'firefox' && p.kind === 'existing' && p.proxy) throw new Error('Manage proxy settings inside this existing Firefox profile.');
    if (b.family === 'firefox' && p.kind === 'managed') firefoxProxyPrefs(p.proxy);
    launchArgs(b, p, store.state.settings);
    if (cleaner.busy.has(id)) throw new Error('Wait for slimming to finish before editing this profile.');
    cleaner.invalidate(id);
    store.state.profiles = [...store.state.profiles.filter(p => p.id !== id), p]; await store.persist(); pending = undefined; changed(); return p;
  }
  if (method === 'remove') { const p = profile(args[0]); if (cleaner.busy.has(p.id)) throw new Error('Cleanup is running.'); store.state.profiles = store.state.profiles.filter(x => x.id !== p.id); cleaner.invalidate(p.id); await store.persist(); changed(); return; }
  if (method === 'discover') {
    store.state.browsers = await detectBrowsers(store.state.browsers); await store.persist();
    discovered = (await discoverProfiles(store.state.browsers)).filter(c => !store.state.profiles.some(p => sameLocation(p, c)));
    changed(); return discovered;
  }
  if (method === 'importProfiles') {
    const keys = z.array(z.string()).max(1000).parse(args[0]);
    for (const key of keys) {
      const candidate = discovered.find(c => c.key === key); if (!candidate) throw new Error('Refresh browser discovery before adding profiles.');
      if (store.state.profiles.some(p => sameLocation(p, candidate))) continue;
      const { key: _, ...location } = candidate;
      store.state.profiles.push({ ...location, id: randomUUID(), createdAt: Date.now(), kind: 'existing', tags: [], color: '#8070c6', favorite: false, hidden: false, urls: [], flags: [], extensions: [], proxy: '', noDefaultFlags: false });
    }
    await store.persist(); changed(); return;
  }
  if (method === 'addBrowser') {
    const family = z.enum(['chromium', 'firefox']).parse(args[0]);
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
  if (method === 'previewSlim') { const profiles = idsSchema.parse(args[0]).map(id => profile(id)); const previews = []; for (const p of profiles) previews.push(await cleaner.preview(p, browserFor(p))); for (const p of profiles) profile(p.id); return previews; }
  if (method === 'clean') {
    const tokens = idsSchema.parse(args[0]); const results = []; const checkedIds: string[] = [];
    for (const token of tokens) { const id = cleaner.profileForToken(token); if (!id) throw new Error('Scan this profile again before cleanup.'); profile(id); checkedIds.push(id); results.push(await cleaner.clean(token)); }
    for (const id of checkedIds) profile(id);
    return results;
  }
  if (method === 'settings') {
    const settings = settingsSchema.parse(args[0]); validateFlags(settings.defaultFlags.chromium); validateFlags(settings.defaultFlags.firefox);
    store.state.settings = settings; nativeTheme.themeSource = settings.theme;
    app.setLoginItemSettings({ openAtLogin: settings.startup, args: ['--background'] });
    registerHotkey(); await store.persist(); changed(); return;
  }
  throw new Error('Unknown operation.');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, args) => { void handleFileArgs(args); });
  app.whenReady().then(async () => {
    await store.load(); store.state.browsers = await detectBrowsers(store.state.browsers); await store.persist();
    nativeTheme.themeSource = store.state.settings.theme;
    ipcMain.handle('chromatic', async (event, method, ...args) => {
      if (![manager?.webContents, launcher?.webContents].includes(event.sender) || event.senderFrame !== event.sender.mainFrame) return { ok: false, error: 'Untrusted caller.' };
      try { return { ok: true, value: await dispatch(event.sender, method, args) }; }
      catch (error: any) { return { ok: false, error: error instanceof z.ZodError ? 'Some profile settings are invalid. Check the fields and try again.' : error.message || 'The operation could not be completed.' }; }
    });
    ipcMain.on('activity', event => { if (event.sender === manager?.webContents) gate.activity(); });
    tray = new Tray(nativeImage.createFromPath(asset('tray.png'))); tray.setToolTip('Chromatic');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Quick launcher', click: showLauncher }, { label: 'Profile manager', click: () => showManager() }, { label: 'Lock discreet profiles', click: lock }, { type: 'separator' }, { label: 'Quit Chromatic', click: () => app.quit() }]));
    tray.on('click', showLauncher); registerHotkey();
    powerMonitor.on('lock-screen', lock); powerMonitor.on('suspend', lock);
    setInterval(() => { if (wasUnlocked && !gate.unlocked) { cleaner.invalidate(); changed(); } wasUnlocked = gate.unlocked; }, 1000).unref();
    if (!process.argv.includes('--background')) await handleFileArgs(process.argv);
  }).catch(error => { dialog.showErrorBox('Chromatic could not start', error.message); app.quit(); });
}
app.on('before-quit', () => { quitting = true; gate.lock(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {});
