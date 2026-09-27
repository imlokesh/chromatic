import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Browser, Candidate, Profile, Settings } from '../shared/types';
import { defaultBrowserCommand } from './windows';
export const exists = async (p: string) => fs.access(p).then(() => true, () => false);
export const canonical = (p: string) => path.resolve(p).toLowerCase();
export const browserId = (p: string) => createHash('sha256').update(canonical(p)).digest('hex').slice(0, 20);
export async function detectBrowsers(saved: Browser[]): Promise<Browser[]> {
  const local = process.env.LOCALAPPDATA || '';
  const roaming = process.env.APPDATA || '';
  const specs = [
    { name: 'Google Chrome', suffix: 'Google/Chrome/Application/chrome.exe', dataRoot: path.join(local, 'Google/Chrome/User Data'), family: 'chromium' as const },
    { name: 'Microsoft Edge', suffix: 'Microsoft/Edge/Application/msedge.exe', dataRoot: path.join(local, 'Microsoft/Edge/User Data'), family: 'chromium' as const },
    { name: 'Brave', suffix: 'BraveSoftware/Brave-Browser/Application/brave.exe', dataRoot: path.join(local, 'BraveSoftware/Brave-Browser/User Data'), family: 'chromium' as const },
    { name: 'Chromium', suffix: 'Chromium/Application/chrome.exe', dataRoot: path.join(local, 'Chromium/User Data'), family: 'chromium' as const },
    { name: 'Firefox', suffix: 'Mozilla Firefox/firefox.exe', dataRoot: path.join(roaming, 'Mozilla/Firefox'), family: 'firefox' as const }
  ];
  const found: Browser[] = [];
  for (const spec of specs) for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], local]) {
    if (!root) continue;
    const executable = path.join(root, spec.suffix);
    if (await exists(executable)) found.push({ id: browserId(executable), name: spec.name, executable, family: spec.family, dataRoot: spec.dataRoot, unpackedExtensions: spec.name === 'Chromium' });
  }
  const command = (await defaultBrowserCommand()).toLowerCase();
  const unique = new Map<string, Browser>();
  for (const browser of [...saved, ...found]) unique.set(browser.id, { ...browser, isDefault: command.includes(browser.executable.toLowerCase()) });
  return [...unique.values()];
}
export function parseIni(text: string) {
  const sections: Record<string, Record<string, string>> = {}; let current = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || /^[;#]/.test(line)) continue;
    if (line.startsWith('[') && line.endsWith(']')) { current = line.slice(1, -1); sections[current] = {}; }
    else { const i = line.indexOf('='); if (i > 0 && current) sections[current][line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  }
  return sections;
}
export async function discoverProfiles(browsers: Browser[]): Promise<Candidate[]> {
  const result: Candidate[] = [];
  for (const browser of browsers) {
    if (!browser.dataRoot) continue;
    try {
      if (browser.family === 'chromium') {
        const state = JSON.parse(await fs.readFile(path.join(browser.dataRoot, 'Local State'), 'utf8'));
        for (const [dir, info] of Object.entries(state.profile?.info_cache || {})) {
          if (path.basename(dir) !== dir || dir === '..' || !await exists(path.join(browser.dataRoot, dir))) continue;
          result.push({ key: `${browser.id}:${dir}`, name: String((info as any).name || dir), browserId: browser.id, dataDir: browser.dataRoot, profileDir: dir });
        }
      } else {
        const sections = parseIni(await fs.readFile(path.join(browser.dataRoot, 'profiles.ini'), 'utf8'));
        for (const [key, entry] of Object.entries(sections)) {
          if (!key.startsWith('Profile') || !entry.Path) continue;
          const dataDir = entry.IsRelative === '1' ? path.resolve(browser.dataRoot, entry.Path) : path.resolve(entry.Path);
          const cacheRoot = entry.IsRelative === '1' ? path.resolve(process.env.LOCALAPPDATA || '', 'Mozilla/Firefox', entry.Path) : dataDir;
          if (await exists(dataDir)) result.push({ key: `${browser.id}:${canonical(dataDir)}`, name: entry.Name || key, browserId: browser.id, dataDir, cacheRoot });
        }
      }
    } catch { /* Browser may not have been started or its metadata may be unavailable. */ }
  }
  return result;
}
export function validateFlags(flags: string[]) {
  for (const flag of flags) {
    if (!flag.startsWith('-') || /[\r\n\0]/.test(flag)) throw new Error('Each custom argument must begin with a dash and occupy one line.');
    if (/^-{1,2}(user-data-dir|profile-directory|profile|p|createprofile|profilemanager|no-remote|new-instance|remote-debugging\S*|load-extension|proxy\S*)(=|\s|$)/i.test(flag)) throw new Error(`Reserved browser argument: ${flag.split('=')[0]}. Use the profile settings instead.`);
  }
}
export function launchArgs(browser: Browser, p: Profile, settings: Settings) {
  const custom = [...(p.noDefaultFlags ? [] : settings.defaultFlags[browser.family]), ...p.flags];
  validateFlags(custom);
  const urls = p.urls.filter(Boolean);
  for (const url of urls) if (!/^(https?:\/\/|about:|chrome:\/\/|edge:\/\/|brave:\/\/)/i.test(url) || /[\r\n\0]/.test(url)) throw new Error('Startup URLs must use http, https, or a browser internal page.');
  if (browser.family === 'firefox') return ['-no-remote', '-profile', p.dataDir, ...custom, ...urls];
  const args = [`--user-data-dir=${p.dataDir}`, `--profile-directory=${p.profileDir || 'Default'}`, ...custom];
  if (p.proxy) args.push(`--proxy-server=${p.proxy}`);
  if (p.extensions.length) {
    if (!browser.unpackedExtensions) throw new Error('This browser does not support command-line extension loading. Install extensions through its extension manager.');
    args.push(`--load-extension=${p.extensions.join(',')}`);
  }
  return [...args, ...urls];
}
export function firefoxProxyPrefs(proxy: string) {
  if (!proxy) return 'user_pref("network.proxy.type", 0);';
  const url = new URL(proxy.includes('://') ? proxy : `http://${proxy}`);
  if (!['http:', 'https:', 'socks5:'].includes(url.protocol) || !url.hostname || !url.port || url.username || url.password) throw new Error('Use a proxy such as http://host:8080 or socks5://host:1080, without embedded credentials.');
  const host = JSON.stringify(url.hostname); const port = Number(url.port);
  return url.protocol === 'socks5:' ? `user_pref("network.proxy.type", 1);\nuser_pref("network.proxy.socks", ${host});\nuser_pref("network.proxy.socks_port", ${port});\nuser_pref("network.proxy.socks_version", 5);\nuser_pref("network.proxy.socks_remote_dns", true);` : `user_pref("network.proxy.type", 1);\nuser_pref("network.proxy.http", ${host});\nuser_pref("network.proxy.http_port", ${port});\nuser_pref("network.proxy.ssl", ${host});\nuser_pref("network.proxy.ssl_port", ${port});`;
}
