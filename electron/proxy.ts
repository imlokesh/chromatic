import { Server } from 'proxy-chain';
import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { isIP } from 'node:net';
import type { ProxyConfig } from '../shared/types';

export interface Protector { isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string }
const endpoint = (p: Pick<ProxyConfig, 'protocol' | 'host' | 'port'>) => [p.protocol, p.host.trim().toLowerCase(), p.port].join(' ');
// A saved password belongs to the server it was entered for; it must not follow the profile to a new address.
export function requireFreshPassword(input: ProxyConfig, saved: ProxyConfig | undefined, previous: string | undefined) {
  if (previous && saved && !input.clearPassword && !input.password && endpoint(input) !== endpoint(saved)) throw new Error('The proxy address changed. Enter its password again, or remove the saved password.');
}
export function protectProxy(input: ProxyConfig, previous: string | undefined, protector: Protector, saved?: ProxyConfig) {
  requireFreshPassword(input, saved, previous);
  const { password, clearPassword, hasPassword: _, ...proxy } = input;
  let secret = clearPassword ? undefined : previous;
  if (password !== undefined && password !== '') {
    if (!protector.isEncryptionAvailable()) throw new Error('Windows credential protection is unavailable. The password was not saved.');
    secret = protector.encryptString(password).toString('base64');
  }
  return { proxy, secret };
}
export function revealProxy(secret: string | undefined, protector: Protector) {
  try { return secret ? protector.decryptString(Buffer.from(secret, 'base64')) : ''; }
  catch { throw new Error('This proxy password cannot be read on this Windows account. Enter it again.'); }
}
export function upstreamUrl(p: ProxyConfig, password: string) {
  if (p.mode !== 'server') throw new Error('Choose a proxy server before testing.');
  const host = p.host.includes(':') && !p.host.startsWith('[') ? `[${p.host}]` : p.host;
  const url = new URL(`${p.protocol === 'socks5' ? 'socks5h' : p.protocol}://${host}:${p.port}`);
  url.username = p.username; url.password = password; return url.toString();
}
export async function createBridge(p: ProxyConfig, password: string) {
  const upstream = upstreamUrl(p, password);
  const server = new Server({ host: '127.0.0.1', port: 0, verbose: false, prepareRequestFunction: () => ({ upstreamProxyUrl: upstream, ignoreUpstreamProxyCertificate: false }) });
  // Never log proxy-chain's error objects: they can contain credentials and request URLs.
  server.on('requestFailed', () => {});
  await server.listen();
  return { server, endpoint: `http://127.0.0.1:${server.port}`, close: () => server.close(true) };
}
export async function testProxy(p: ProxyConfig, password: string, signal: AbortSignal, target = 'https://api.ipify.org?format=json') {
  const started = Date.now(); const bridge = await createBridge(p, password);
  const agent = new HttpsProxyAgent(bridge.endpoint);
  let cleanup = () => {};
  try {
    signal.throwIfAborted();
    const text = await new Promise<string>((resolve, reject) => {
      let body = ''; const req = https.get(target, { agent, signal }, res => {
        if (res.statusCode !== 200) {
          res.resume();
          const messages: Record<number, string> = { 407: 'Proxy authentication failed. Check the username and password.', 597: 'Proxy authentication failed. Check the username and password.', 593: 'The proxy hostname could not be resolved. Check its spelling.', 594: 'The proxy refused the connection. Check its host and port.', 595: 'The proxy reset the connection. Check the server and try again.', 599: 'The proxy connection failed. Check the server and its TLS certificate.' };
          reject(new Error(messages[res.statusCode || 0] || `The IP check service returned HTTP ${res.statusCode}. Try again later.`)); return;
        }
        res.on('data', chunk => { body += chunk; if (body.length > 8192) req.destroy(new Error('Invalid response from the IP check service.')); });
        res.on('end', () => resolve(body));
      });
      const stop = (message: string) => { req.destroy(); reject(new Error(message)); };
      const abort = () => stop('Cancelled.');
      signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => stop('Proxy test timed out. Check the address and connection.'), 15000);
      cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
      req.on('close', cleanup);
      req.on('error', error => reject(new Error(signal.aborted ? 'Cancelled.' : error.message.startsWith('Proxy test timed out') ? error.message : 'Unable to reach the IP check service through this proxy. Check the address, credentials, and TLS certificate.')));
    });
    let ip: unknown; try { ip = JSON.parse(text).ip; } catch { /* handled below */ }
    if (typeof ip !== 'string' || !isIP(ip)) throw new Error('The IP check service returned an invalid response. Try again later.');
    return { ip, elapsedMs: Date.now() - started, checkedAt: Date.now() };
  } finally { cleanup(); agent.destroy(); await bridge.close(); }
}
