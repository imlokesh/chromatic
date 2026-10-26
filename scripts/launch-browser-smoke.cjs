// Launches a real headless Chrome or Edge through Chromatic with disposable profiles and checks
// running-folder detection: fast launches, reuse of a running folder, refusal of changed
// settings while it runs, and recovery once the browser exits.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const lockState = async dir => { try { const h = await fs.open(path.join(dir, 'lockfile'), 'r+'); await h.close(); return 'free'; } catch (e) { return e.code === 'ENOENT' ? 'free' : e.code === 'EBUSY' ? 'busy' : e.code; } };
async function stopBrowsers(dir) {
  // Only browser processes started for this disposable folder. Repeat until none remain,
  // since a browser can still be starting helpers when it is first stopped.
  const script = `$m = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' or Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${dir.replace(/'/g, "''")}*' }); $m | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; $m.Count`;
  for (let attempt = 0; attempt < 10; attempt++) {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    if (Number(stdout.trim()) === 0 && await lockState(dir) === 'free') return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Could not stop the disposable browser for ${dir}`);
}
(async () => {
  const executable = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'];
  const browser = (await Promise.all(executable.map(e => fs.access(e).then(() => e, () => undefined)))).find(Boolean);
  if (!browser) { console.log('SKIP: Chrome or Edge is not installed'); return; }
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'chromatic-launch-')));
  const root = path.join(temp, 'Chromatic'); await fs.mkdir(root);
  const dataDir = path.join(temp, 'browser-data');
  const base = { browserId: 'real', kind: 'managed', labels: [], color: '#8070c6', favorite: false, hidden: false, urls: ['about:blank'], extensions: [], proxy: { mode: 'system', protocol: 'http', host: '', port: 8080, username: '' }, noDefaultFlags: false, createdAt: 1 };
  const flags = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check'];
  const profiles = [{ ...base, id: randomUUID(), name: 'Real A', dataDir, profileDir: 'Default', flags }];
  await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify({ version: 2, profiles, browsers: [{ id: 'real', name: path.basename(browser), executable: browser, family: 'chromium', unpackedExtensions: false }], settings: { hotkey: 'Ctrl+Alt+F8', startup: false, theme: 'light', defaultFlags: { chromium: [] }, groupBy: 'none', sortBy: 'favorites' }, attempts: 0, blockedUntil: 0, proxySecrets: {} }));
  const env = { ...process.env, LOCALAPPDATA: temp }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ ...(process.env.CHROMATIC_SMOKE_EXE ? { executablePath: process.env.CHROMATIC_SMOKE_EXE, args: [] } : { args: [path.resolve('.')] }), env });
  try {
    const page = await app.firstWindow(); await expect(page.locator('.profile-row')).toHaveCount(1);
    const launch = id => page.evaluate(async id => { const start = performance.now(); const result = await window.chromatic.launch(id); return { ms: performance.now() - start, result }; }, id);
    const first = await launch(profiles[0].id);
    if (first.result?.error) throw new Error(`First launch failed: ${first.result.error.message}`);
    await expect.poll(() => lockState(dataDir), { timeout: 20000 }).toBe('busy');
    console.log(`first launch accepted in ${first.ms.toFixed(0)} ms; browser holds its data folder`);
    const again = await launch(profiles[0].id);
    if (again.result?.error) throw new Error(`Relaunch of the running profile failed: ${again.result.error.message}`);
    console.log(`relaunch of the running profile accepted in ${again.ms.toFixed(0)} ms`);
    await page.evaluate(async p => { const { createdAt, lastUsed, ...draft } = p; await window.chromatic.save({ ...draft, flags: [...p.flags, '--mute-audio'] }); }, profiles[0]);
    const changed = await launch(profiles[0].id);
    if (changed.result?.error?.code !== 'restart') throw new Error(`Changed settings were not refused while running: ${JSON.stringify(changed.result)}`);
    console.log(`changed settings refused while running in ${changed.ms.toFixed(0)} ms`);
    await stopBrowsers(dataDir); await expect.poll(() => lockState(dataDir), { timeout: 20000 }).toBe('free');
    const quick = await launch(profiles[0].id); // Within the recent-launch window: confirmed by process query.
    if (quick.result?.error) throw new Error(`Launch after exit failed: ${quick.result.error.message}`);
    console.log(`launch shortly after exit (process query fallback) accepted in ${quick.ms.toFixed(0)} ms`);
    await expect.poll(() => lockState(dataDir), { timeout: 20000 }).toBe('busy');
    await stopBrowsers(dataDir); await expect.poll(() => lockState(dataDir), { timeout: 20000 }).toBe('free');
    await new Promise(r => setTimeout(r, 16000));
    const later = await launch(profiles[0].id);
    if (later.result?.error) throw new Error(`Later launch failed: ${later.result.error.message}`);
    await expect.poll(() => lockState(dataDir), { timeout: 20000 }).toBe('busy');
    console.log(`later launch (lockfile only) accepted in ${later.ms.toFixed(0)} ms`);
    if (later.ms > 1000) throw new Error('Lockfile launch path was unexpectedly slow');
    console.log(`PASS ${path.basename(browser)}: launch detection uses the data folder lock, reuses a running folder, refuses changed settings while running, and recovers after exit.`);
  } finally {
    // The browser inherits Playwright's pipes to Electron, so close it before the app.
    await stopBrowsers(dataDir).catch(error => { console.error(error.message); process.exitCode = 1; }); await app.close();
    await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
