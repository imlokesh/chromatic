const { chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { duplicateProfile, forkProfile } = require('../dist-electron/electron/profile-data');
const { launchArgs } = require('../dist-electron/electron/browsers');
const { randomUUID } = require('node:crypto');
(async () => {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'chromatic-real-fork-')));
  const server = http.createServer((_req, res) => res.end('<html><title>Chromatic fixture</title><body>Disposable fork test</body></html>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const url = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [name, executable] of [['Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'], ['Edge', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']]) {
      if (!await fs.access(executable).then(() => true, () => false)) { console.log(`SKIP ${name}: not installed`); continue; }
      const source = { id: randomUUID(), name, browserId: name, kind: 'managed', dataDir: path.join(temp, name), labels: [], color: '#8070c6', favorite: false, hidden: false, urls: [], flags: [], extensions: [], proxy: { mode: 'system', protocol: 'http', host: '', port: 8080, username: '' }, noDefaultFlags: false, createdAt: Date.now() };
      const browser = { id: name, name, executable, family: 'chromium', unpackedExtensions: false };
      const launch = p => chromium.launchPersistentContext(p.dataDir, { executablePath: executable, headless: true, args: launchArgs(browser, p, { defaultFlags: { chromium: ['--no-first-run', '--no-default-browser-check'] } }).filter(a => !a.startsWith('--user-data-dir=')) });
      let context = await launch(source);
      try { const page = await context.newPage(); await page.goto(url); await page.evaluate(() => { localStorage.setItem('chromatic', 'preserved'); document.cookie = 'chromatic_cookie=preserved; Max-Age=86400; Path=/'; }); } finally { await context.close(); }
      const fork = duplicateProfile(source, temp, `${name} fork`); await forkProfile(source, fork, async () => {}, () => {});
      context = await launch(fork);
      try {
        const page = await context.newPage(); await page.goto(url); const data = await page.evaluate(() => ({ cookie: document.cookie, value: localStorage.getItem('chromatic') }));
        if (!data.cookie.includes('chromatic_cookie=preserved') || data.value !== 'preserved') throw new Error(`${name}: forked persistent state not retained`);
        await page.evaluate(() => localStorage.setItem('chromatic', 'changed-in-fork'));
      } finally { await context.close(); }
      context = await launch(source);
      try { const page = await context.newPage(); await page.goto(url); if (await page.evaluate(() => localStorage.getItem('chromatic')) !== 'preserved') throw new Error(`${name}: source changed`); } finally { await context.close(); }
      console.log(`PASS ${name}: fork retains real cookie and local storage, uses generated launch arguments, and stays independent of source.`);
    }
    console.log(`Disposable data: ${temp}`);
  } finally { server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
