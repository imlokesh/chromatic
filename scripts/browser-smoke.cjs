const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { launchArgs } = require('../dist-electron/electron/browsers');
const exec = promisify(execFile);
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'chromatic-browsers-'));
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'chromatic_test=preserved; Max-Age=86400; SameSite=Lax' }); res.end('<html><title>Chromatic disposable smoke test</title><body>chromatic-browser-ok</body></html>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browsers = [
    { id: 'chrome', name: 'Chrome', executable: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', family: 'chromium', unpackedExtensions: false },
    { id: 'edge', name: 'Edge', executable: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', family: 'chromium', unpackedExtensions: false },
    { id: 'firefox', name: 'Firefox', executable: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe', family: 'firefox', unpackedExtensions: false }
  ];
  try {
    for (const browser of browsers) {
      if (!await fs.access(browser.executable).then(() => true, () => false)) { console.log(`SKIP ${browser.name}: not installed`); continue; }
      const dir = path.join(temp, browser.id); await fs.mkdir(dir);
      const p = { id: randomUUID(), name: 'Disposable browser test', browserId: browser.id, kind: 'managed', dataDir: dir, tags: [], color: '#8070c6', favorite: false, hidden: false, urls: [url], flags: [], extensions: [], proxy: '', noDefaultFlags: false, createdAt: Date.now() };
      let args = launchArgs(browser, p, { defaultFlags: { chromium: ['--no-first-run', '--no-default-browser-check'], firefox: [] } });
      if (browser.family === 'chromium') args.splice(args.length - 1, 0, '--headless=new', '--disable-gpu', '--dump-dom');
      else args.splice(args.length - 1, 0, '--headless', '--screenshot', path.join(temp, 'firefox.png'));
      const result = await exec(browser.executable, args, { cwd: temp, windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
      if (browser.family === 'chromium' && !result.stdout.includes('chromatic-browser-ok')) throw new Error(`${browser.name}: page content not received`);
      if (browser.family === 'firefox') await fs.access(path.join(temp, 'firefox.png'));
      console.log(`PASS ${browser.name}: isolated profile launches with generated arguments and loads local page`);
    }
    console.log(`Disposable browser data: ${temp}`);
  } finally { server.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
