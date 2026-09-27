const { Server } = require('proxy-chain');
const { testProxy } = require('../dist-electron/electron/proxy');
(async () => {
  const upstream = new Server({ host: '127.0.0.1', port: 0, prepareRequestFunction: ({ username, password }) => ({ requestAuthentication: username !== 'fixture' || password !== 'fixture-password' }) });
  await upstream.listen();
  try {
    const proxy = { mode: 'server', protocol: 'http', host: '127.0.0.1', port: upstream.port, username: 'fixture' };
    const result = await testProxy(proxy, 'fixture-password', new AbortController().signal);
    if (!result.ip || !result.checkedAt) throw new Error('Missing IP result');
    let rejected = false; try { await testProxy(proxy, 'wrong', new AbortController().signal); } catch { rejected = true; }
    if (!rejected) throw new Error('Rejected credentials unexpectedly passed');
    console.log('PASS: authenticated proxy test reaches HTTPS public-IP service; rejected credentials fail without a direct fallback.');
  } finally { await upstream.close(true); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
