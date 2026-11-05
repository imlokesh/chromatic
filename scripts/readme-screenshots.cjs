// Regenerates the README screenshots in docs/screenshots from invented demo profiles in a
// disposable data folder, so no real profile names or paths appear in public images.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
(async () => {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'chromatic-readme-')));
  const root = path.join(temp, 'Chromatic'); await fs.mkdir(root);
  const now = Date.now(); const hour = 3_600_000;
  const demo = [
    ['Work', 'chrome', ['work'], '#3a6df0', true, 1],
    ['Personal', 'chrome', [], '#e05d5d', true, 3],
    ['Client: Northwind', 'edge', ['client', 'work'], '#2f9e8f', false, 5, true],
    ['Research', 'brave', ['reading'], '#8070c6', false, 26],
    ['Shopping', 'edge', [], '#d9902f', false, 50],
    ['Social media', 'brave', ['social'], '#c2569b', false, 75, true],
    ['Staging tests', 'chrome', ['dev', 'work'], '#5f7d95', false, 120],
  ];
  const profiles = demo.map(([name, browserId, labels, color, favorite, ago, proxied], i) => ({
    id: crypto.randomUUID(), name, browserId, kind: 'managed', dataDir: path.join(temp, `profile-${i}`), labels, color, favorite, hidden: false,
    urls: [], flags: [], extensions: [], noDefaultFlags: false, createdAt: now - 90 * 24 * hour, lastUsed: now - ago * hour,
    proxy: proxied ? { mode: 'server', protocol: 'socks5', host: 'proxy.example.com', port: 1080, username: '' } : { mode: 'system', protocol: 'http', host: '', port: 8080, username: '' },
  }));
  for (const p of profiles) await fs.mkdir(path.join(p.dataDir, 'Default'), { recursive: true });
  const browser = (id, name) => ({ id, name, executable: `C:\\Chromatic-demo\\${id}.exe`, family: 'chromium', unpackedExtensions: true });
  await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify({ version: 2, profiles, browsers: [browser('chrome', 'Google Chrome'), browser('edge', 'Microsoft Edge'), browser('brave', 'Brave')],
    settings: { hotkey: 'Ctrl+Alt+Space', startup: false, theme: 'light', defaultFlags: { chromium: [] }, groupBy: 'none', sortBy: 'favorites' }, attempts: 0, blockedUntil: 0, proxySecrets: {} }));
  const env = { ...process.env, LOCALAPPDATA: temp }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ ...(process.env.CHROMATIC_SMOKE_EXE ? { executablePath: process.env.CHROMATIC_SMOKE_EXE, args: [] } : { args: [path.resolve('.')] }), env });
  const out = path.resolve('docs', 'screenshots'); await fs.mkdir(out, { recursive: true });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 760));
    await expect(page.locator('.profile-row')).toHaveCount(profiles.length);
    await page.waitForTimeout(600); await page.screenshot({ path: path.join(out, 'manager.png') });
    await page.evaluate(async () => { const s = await window.chromatic.snapshot(); await window.chromatic.settings({ ...s.settings, theme: 'dark' }); });
    await page.waitForFunction(() => document.documentElement.style.colorScheme === 'dark'); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, 'manager-dark.png') });
    // The launcher is prepared hidden 1.5 s after start; show it the way the hotkey does.
    await expect.poll(() => app.windows().length, { timeout: 10000 }).toBe(2);
    const launcher = app.windows().find(w => w.url().includes('mode=launcher'));
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('mode=launcher')); w.show(); w.focus(); w.webContents.send('changed'); });
    await launcher.keyboard.type('wo'); await launcher.waitForTimeout(500);
    await launcher.screenshot({ path: path.join(out, 'launcher.png') });
    console.log(`PASS: screenshots written to ${out}`);
  } finally { await app.close(); await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
