import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Browser, Candidate, Profile, Settings } from '../shared/types';
import { defaultBrowserCommand } from './windows';
export const exists = async (p: string) => fs.access(p).then(() => true, () => false);
export const canonical = (p: string) => path.resolve(p).toLowerCase();
export const browserId = (p: string) => createHash('sha256').update(canonical(p)).digest('hex').slice(0, 20);
export async function detectBrowsers(saved: Browser[]): Promise<Browser[]> { return mergeBrowsers(saved, await installedBrowsers()); }
// Merge synchronously so a detection that finishes in the background cannot drop browsers saved meanwhile.
export function mergeBrowsers(saved: Browser[], installed: { found: Browser[]; command: string }) {
  const unique = new Map<string, Browser>();
  for (const browser of [...saved, ...installed.found]) unique.set(browser.id, { ...browser, isDefault: installed.command.includes(browser.executable.toLowerCase()) });
  return [...unique.values()];
}
export async function installedBrowsers() {
  const local = process.env.LOCALAPPDATA || '';
  const specs = [
    { name: 'Google Chrome', suffix: 'Google/Chrome/Application/chrome.exe', dataRoot: path.join(local, 'Google/Chrome/User Data'), family: 'chromium' as const },
    { name: 'Microsoft Edge', suffix: 'Microsoft/Edge/Application/msedge.exe', dataRoot: path.join(local, 'Microsoft/Edge/User Data'), family: 'chromium' as const },
    { name: 'Brave', suffix: 'BraveSoftware/Brave-Browser/Application/brave.exe', dataRoot: path.join(local, 'BraveSoftware/Brave-Browser/User Data'), family: 'chromium' as const },
    { name: 'Chromium', suffix: 'Chromium/Application/chrome.exe', dataRoot: path.join(local, 'Chromium/User Data'), family: 'chromium' as const }
  ];
  const candidates = specs.flatMap(spec => [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], local].filter(Boolean).map(root => ({ spec, executable: path.join(root!, spec.suffix) })));
  const [present, command] = await Promise.all([Promise.all(candidates.map(c => exists(c.executable))), defaultBrowserCommand()]);
  const found: Browser[] = candidates.filter((_, i) => present[i]).map(({ spec, executable }) => ({ id: browserId(executable), name: spec.name, executable, family: spec.family, dataRoot: spec.dataRoot, unpackedExtensions: spec.name === 'Chromium' }));
  return { found, command: command.toLowerCase() };
}
export async function discoverProfiles(browsers: Browser[]): Promise<Candidate[]> {
  const perBrowser = await Promise.all(browsers.map(async browser => {
    const result: Candidate[] = [];
    if (!browser.dataRoot) return result;
    try {
      const state = JSON.parse(await fs.readFile(path.join(browser.dataRoot, 'Local State'), 'utf8'));
      const entries = Object.entries(state.profile?.info_cache || {}).filter(([dir]) => path.basename(dir) === dir && dir !== '..');
      const present = await Promise.all(entries.map(([dir]) => exists(path.join(browser.dataRoot!, dir))));
      entries.forEach(([dir, info], i) => { if (present[i]) result.push({ key: `${browser.id}:${dir}`, name: String((info as any).name || dir), browserId: browser.id, dataDir: browser.dataRoot!, profileDir: dir }); });
    } catch { /* Browser may not have been started or its metadata may be unavailable. */ }
    return result;
  }));
  return perBrowser.flat();
}
export function validateFlags(flags: string[]) {
  for (const flag of flags) {
    if (!flag.startsWith('-') || /[\r\n\0]/.test(flag)) throw new Error('Each custom argument must begin with a dash and occupy one line.');
    if (/^-{1,2}(user-data-dir|profile-directory|profile|p|createprofile|profilemanager|no-remote|new-instance|remote-debugging\S*|load-extension|no-proxy-server|proxy\S*)(=|\s|$)/i.test(flag)) throw new Error(`Reserved browser argument: ${flag.split('=')[0]}. Use the profile settings instead.`);
  }
}
export function launchArgs(browser: Browser, p: Profile, settings: Settings, proxyEndpoint?: string) {
  const custom = [...(p.noDefaultFlags ? [] : settings.defaultFlags[browser.family]), ...p.flags];
  validateFlags(custom);
  const urls = p.urls.filter(Boolean);
  for (const url of urls) if (!/^(https?:\/\/|about:|chrome:\/\/|edge:\/\/|brave:\/\/)/i.test(url) || /[\r\n\0]/.test(url)) throw new Error('Startup URLs must use http, https, or a browser internal page.');
  const args = [`--user-data-dir=${p.dataDir}`, `--profile-directory=${p.profileDir || 'Default'}`, ...custom];
  if (p.proxy.mode === 'review') throw new Error('Review the legacy proxy in profile settings before launching.');
  if (proxyEndpoint) args.push(`--proxy-server=${proxyEndpoint}`);
  if (p.extensions.length) {
    if (!browser.unpackedExtensions) throw new Error('This browser does not support command-line extension loading. Install extensions through its extension manager.');
    args.push(`--load-extension=${p.extensions.join(',')}`);
  }
  return [...args, ...urls];
}
