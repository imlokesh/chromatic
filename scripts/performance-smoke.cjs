const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');

(async () => {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'chromatic-performance-')));
  const root = path.join(temp, 'Chromatic'); await fs.mkdir(root);
  const profiles = Array.from({ length: 1000 }, (_, i) => ({ id: randomUUID(), name: `Profile ${String(i).padStart(4, '0')}`, browserId: 'fixture', kind: 'managed', dataDir: path.join(temp, `profile-${i}`), labels: [`Label ${i % 100}`, `Team ${i % 10}`], color: '#8070c6', favorite: false, hidden: false, urls: [], flags: [], extensions: [], proxy: { mode: 'system', protocol: 'http', host: '', port: 8080, username: '' }, noDefaultFlags: false, createdAt: i }));
  profiles[4].dataDir = profiles[0].dataDir; profiles[4].profileDir = 'Private';
  for (const p of profiles.slice(0, 5)) await fs.mkdir(path.join(p.dataDir, p.profileDir || 'Default'), { recursive: true });
  profiles[6].kind = 'existing'; // An unavailable existing folder must not be recreated.
  await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify({ version: 2, profiles, browsers: [{ id: 'fixture', name: 'Chromium fixture', executable: require('electron'), family: 'chromium', unpackedExtensions: true }], settings: { hotkey: 'Ctrl+Alt+F9', startup: false, theme: 'light', defaultFlags: { chromium: [] }, groupBy: 'none', sortBy: 'favorites' }, attempts: 0, blockedUntil: 0, proxySecrets: {} }));
  const env = { ...process.env, LOCALAPPDATA: temp }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.resolve('.')], env });
  try {
    const page = await app.firstWindow(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await expect(page.locator('.profile-row')).toHaveCount(1000);
    await app.evaluate(({ app }) => {
      const require = process.mainModule.require.bind(process.mainModule);
      const path = require('node:path'); const { EventEmitter } = require('node:events');
      const state = globalThis.performanceFixture = { delay: 1500, scans: 0, spawns: 0, active: 0, maxActive: 0, mode: 'success', bridges: 0, closed: 0 };
      require(path.join(app.getAppPath(), 'dist-electron/electron/windows.js')).processes = async () => {
        state.scans++; state.maxActive = Math.max(state.maxActive, ++state.active);
        await new Promise(r => setTimeout(r, state.delay)); state.active--; return [];
      };
      require('node:child_process').spawn = () => {
        state.spawns++; const child = Object.assign(new EventEmitter(), { unref() {} });
        setTimeout(() => {
          if (state.mode === 'spawn-error') child.emit('error', new Error('Fixture spawn failure'));
          else { child.emit('spawn'); if (state.mode === 'early-exit') setTimeout(() => child.emit('exit', 7), 50); }
        }, 0);
        return child;
      };
      require(path.join(app.getAppPath(), 'dist-electron/electron/proxy.js')).createBridge = async () => {
        if (state.mode === 'proxy-error') throw new Error('Fixture proxy failure');
        state.bridges++; return { endpoint: 'http://127.0.0.1:43210', close: async () => { state.closed++; } };
      };
    });
    const quickPromise = app.waitForEvent('window'); await page.evaluate(() => window.chromatic.launcher());
    const quick = await quickPromise; quick.on('pageerror', e => errors.push(e.message));
    await expect(quick.locator('.quick-row')).toHaveCount(1000);
    const search = quick.getByRole('combobox');
    const searchStart = performance.now(); await search.fill('Profile 0099'); await expect(quick.locator('.quick-row').first()).toContainText('Profile 0099');
    console.log(`1000-profile search visible: ${Math.round(performance.now() - searchStart)} ms`);
    await search.fill('');
    const navStart = performance.now(); await search.press('ArrowDown');
    await expect(quick.locator('.quick-row.active')).toContainText('Profile 0001');
    console.log(`1000-profile keyboard selection visible: ${Math.round(performance.now() - navStart)} ms`);
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('mode=launcher'));
      win.once('hide', () => { globalThis.performanceFixture.hidden = performance.now(); });
      globalThis.performanceFixture.start = performance.now();
    });
    // Dispatch duplicate keyboard events in one render turn to exercise the immediate guard.
    await quick.evaluate(() => { const input = document.querySelector('input'); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    const dismissal = await app.evaluate(() => globalThis.performanceFixture.hidden - globalThis.performanceFixture.start);
    if (!(dismissal < 100)) throw new Error(`Launcher dismissal exceeded target: ${dismissal} ms`);
    await page.evaluate(() => window.chromatic.launcher());
    await search.fill('Profile 0002'); await expect(quick.locator('.quick-row').first()).toContainText('Profile 0002');
    await expect.poll(() => app.evaluate(() => globalThis.performanceFixture.spawns)).toBe(1);
    if (!await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('mode=launcher')).isVisible())) throw new Error('Old launch hid the reopened launcher');
    if ((await app.evaluate(() => globalThis.performanceFixture.scans)) !== 1) throw new Error('Repeated Enter triggered duplicate launch checks');
    await search.press('Escape');
    if (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('mode=launcher')).isVisible())) throw new Error('Escape failed');
    console.log(`PASS: dismissal ${dismissal.toFixed(1)} ms during 1500 ms process check; duplicate Enter, reopening, search, and Escape`);

    const preview = await page.evaluate(id => window.chromatic.previewSlim([id]), profiles[0].id);
    await page.evaluate(id => { globalThis.pendingLaunch = window.chromatic.launch(id); }, profiles[0].id);
    await expect.poll(() => app.evaluate(() => globalThis.performanceFixture.active)).toBe(1);
    const conflicts = await page.evaluate(async ({ id, token }) => {
      const refused = async fn => { try { await fn(); return false; } catch { return true; } };
      return Promise.all([refused(() => window.chromatic.copyProfile(id, 'fork', 'Conflicting fork')), refused(() => window.chromatic.clean([token]))]);
    }, { id: profiles[0].id, token: preview[0].token });
    if (conflicts.some(value => !value)) throw new Error('Cleanup or fork started during a launch');
    await page.evaluate(() => globalThis.pendingLaunch);
    const missingStorage = await page.evaluate(id => window.chromatic.launch(id), profiles[6].id);
    if (missingStorage?.error?.code !== 'storage') throw new Error('Missing previously used storage was not refused');
    console.log('PASS: launch reservations block conflicting fork/cleanup; unavailable storage is preserved');

    await app.evaluate(() => { globalThis.performanceFixture.delay = 0; globalThis.performanceFixture.mode = 'early-exit'; });
    await page.evaluate(() => window.chromatic.launcher()); await search.fill('Profile 0002'); await search.press('Enter');
    await expect(page.locator('.operation-error').last()).toContainText('code 7');
    if (!await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('mode=manager')).isVisible())) throw new Error('Failure did not open manager');
    await expect(page.locator('.operation-error').last().getByRole('button', { name: 'Profile settings' })).toBeVisible();

    await page.evaluate(async p => { const { createdAt, lastUsed, ...draft } = p; await window.chromatic.save({ ...draft, proxy: { ...p.proxy, mode: 'server', host: 'localhost', port: 8080 } }); }, profiles[3]);
    await app.evaluate(() => { globalThis.performanceFixture.mode = 'spawn-error'; });
    await page.evaluate(() => window.chromatic.launcher()); await search.fill('Profile 0003'); await search.press('Enter');
    await expect(page.locator('.operation-error').last()).toContainText('Fixture spawn failure');
    const proxy = await app.evaluate(() => globalThis.performanceFixture);
    if (proxy.bridges !== 1 || proxy.closed !== 1) throw new Error('Failed launch leaked a proxy bridge');
    await app.evaluate(() => { globalThis.performanceFixture.mode = 'proxy-error'; });
    await page.evaluate(() => window.chromatic.launcher()); await search.fill('Profile 0003'); await search.press('Enter');
    await expect(page.locator('.operation-error').last()).toContainText('Fixture proxy failure');

    await page.evaluate(async p => { await window.chromatic.setPin('4826'); const { createdAt, lastUsed, ...draft } = p; await window.chromatic.save({ ...draft, hidden: true }); }, profiles[4]);
    const count = await app.evaluate(() => { globalThis.performanceFixture.delay = 500; globalThis.performanceFixture.mode = 'success'; return globalThis.performanceFixture.spawns; });
    await page.evaluate(id => { globalThis.publicLaunch = window.chromatic.launch(id); }, profiles[0].id);
    await expect.poll(() => app.evaluate(() => globalThis.performanceFixture.active)).toBe(1);
    await page.evaluate(id => { globalThis.hiddenLaunch = window.chromatic.launch(id).catch(() => {}); }, profiles[4].id);
    await expect.poll(async () => (await page.evaluate(() => window.chromatic.snapshot())).operations.filter(o => o.type === 'launch' && o.status === 'running').length).toBe(2);
    await page.evaluate(async () => { await window.chromatic.lock(); await window.chromatic.unlock('4826'); });
    await page.evaluate(() => Promise.all([globalThis.publicLaunch, globalThis.hiddenLaunch]));
    if ((await app.evaluate(() => globalThis.performanceFixture.spawns)) !== count + 1) throw new Error('Queued hidden launch survived locking');
    await page.evaluate(() => window.chromatic.lock());
    const snapshot = await page.evaluate(() => window.chromatic.snapshot());
    if (snapshot.operations.some(o => o.profileIds.includes(profiles[4].id))) throw new Error('Private operation leaked after lock');
    console.log('PASS: early exit recovery, spawn and proxy failures, bridge disposal, lock during queued launch, private operation filtering');

    await app.evaluate(({ app }) => {
      const require = process.mainModule.require.bind(process.mainModule);
      const Store = require(require('node:path').join(app.getAppPath(), 'dist-electron/electron/store.js')).Store;
      const original = Store.prototype.persist;
      Store.prototype.persist = function () { Store.prototype.persist = original; return Promise.reject(new Error('Fixture disk error')); };
      globalThis.performanceFixture.delay = 0;
    });
    const saveFailure = await page.evaluate(id => window.chromatic.launch(id), profiles[0].id);
    if (saveFailure?.error?.code !== 'save' || !saveFailure.error.message.includes('browser started')) throw new Error('Persistence error was reported as a failed browser start');

    await app.evaluate(() => { globalThis.performanceFixture.delay = 0; });
    await Promise.all(Array.from({ length: 200 }, (_, i) => fs.writeFile(path.join(profiles[0].dataDir, 'Default', `file-${i}`), 'persistent')));
    await app.evaluate(({ BrowserWindow }) => {
      globalThis.performanceFixture.notifications = { manager: 0, launcher: 0 };
      for (const win of BrowserWindow.getAllWindows()) {
        const mode = win.webContents.getURL().includes('mode=launcher') ? 'launcher' : 'manager';
        const original = win.webContents.send.bind(win.webContents);
        win.webContents.send = (channel, ...args) => { if (channel === 'changed') globalThis.performanceFixture.notifications[mode]++; return original(channel, ...args); };
      }
    });
    const operationId = await page.evaluate(id => window.chromatic.copyProfile(id, 'fork', 'Performance fork'), profiles[0].id);
    await expect.poll(async () => (await page.evaluate(() => window.chromatic.snapshot())).operations.find(o => o.id === operationId)?.status, { timeout: 30000 }).toBe('complete');
    const notifications = await app.evaluate(() => globalThis.performanceFixture.notifications);
    if (notifications.launcher !== 1 || notifications.manager >= 100) throw new Error(`Progress refresh flood: ${JSON.stringify(notifications)}`);
    console.log(`PASS: 200-file fork sent ${notifications.manager} manager updates and ${notifications.launcher} launcher update`);
    await fs.mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/performance-recovery.png' });
    if (errors.length) throw new Error(errors.join('\n'));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
