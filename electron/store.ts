import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Browser, Profile, Settings } from '../shared/types';
export const labelList = z.array(z.string().trim().min(1).max(40)).max(20).transform(v => [...new Map(v.map(s => [s.toLocaleLowerCase(), s])).values()]);
export const proxySchema = z.object({ mode: z.enum(['system', 'server', 'review']), protocol: z.enum(['http', 'https', 'socks5']), host: z.string().trim().max(253), port: z.number().int().min(1).max(65535), username: z.string().max(1024), hasPassword: z.boolean().optional(), password: z.string().max(4096).optional(), clearPassword: z.boolean().optional(), legacy: z.string().max(1024).optional() }).strict().refine(p => p.mode !== 'server' || (!!p.host && !/[\s/@?#\\]/.test(p.host)), 'Enter a proxy hostname without a URL or credentials.');
const stringList = z.array(z.string().max(4096)).max(100);
export const settingsSchema = z.object({
  hotkey: z.string().min(3).max(80), startup: z.boolean(), theme: z.enum(['system', 'light', 'dark']),
  defaultFlags: z.object({ chromium: stringList }), groupBy: z.enum(['none', 'label']).default('none'), sortBy: z.enum(['favorites', 'name', 'recent']).default('favorites')
}).strict();
export const profileSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(120), browserId: z.string().min(1).max(500),
  kind: z.enum(['managed', 'existing']), dataDir: z.string().max(4096), profileDir: z.string().max(200).optional(),
  labels: labelList, color: z.string().regex(/^#[0-9a-f]{6}$/i),
  favorite: z.boolean(), hidden: z.boolean(), urls: stringList, flags: stringList, extensions: stringList,
  proxy: proxySchema, noDefaultFlags: z.boolean(), lastUsed: z.number().optional(), createdAt: z.number()
}).strict();
export const draftSchema = profileSchema.omit({ id: true, createdAt: true, lastUsed: true }).extend({ id: z.string().uuid().optional() });
const browserSchema = z.object({ id: z.string(), name: z.string(), executable: z.string(), family: z.literal('chromium'), dataRoot: z.string().optional(), isDefault: z.boolean().optional(), unpackedExtensions: z.boolean() });
const stateSchema = z.object({ version: z.literal(2), profiles: z.array(profileSchema), browsers: z.array(browserSchema), settings: settingsSchema,
  proxySecrets: z.record(z.string()).default({}), pin: z.string().optional(), attempts: z.number().default(0), blockedUntil: z.number().default(0) });
export type State = z.infer<typeof stateSchema>;
export class Store {
  state: State = { version: 2, profiles: [], proxySecrets: {}, browsers: [], attempts: 0, blockedUntil: 0, settings: { hotkey: 'Ctrl+Alt+Space', startup: true, theme: 'system', defaultFlags: { chromium: ['--no-first-run', '--no-default-browser-check'] }, groupBy: 'none', sortBy: 'favorites' } };
  private queue: Promise<void> = Promise.resolve();
  // Validated output keyed by profile id and its serialized input. Revalidating 1,000
  // unchanged profiles took ~13 ms of main-process time on every save.
  private validated = new Map<string, { input: string; output: Profile }>();
  constructor(public readonly root: string) {}
  async load() {
    await fs.mkdir(this.root, { recursive: true });
    try {
      const original = await fs.readFile(path.join(this.root, 'settings.json'), 'utf8');
      const raw = JSON.parse(original);
      if (raw.version === 1) {
        const migrated = migrateV1(raw);
        this.state = stateSchema.parse(migrated);
        await fs.writeFile(path.join(this.root, 'settings.v1.backup.json'), original, { flag: 'wx' }).catch((e: any) => { if (e.code !== 'EEXIST') throw e; });
        const firefoxIds = new Set(raw.browsers.filter((b: any) => b.family === 'firefox').map((b: any) => b.id));
        await fs.writeFile(path.join(this.root, 'archived-firefox.json'), JSON.stringify({ browsers: raw.browsers.filter((b: any) => firefoxIds.has(b.id)), profiles: raw.profiles.filter((p: any) => firefoxIds.has(p.browserId)) }, null, 2), { flag: 'wx' }).catch((e: any) => { if (e.code !== 'EEXIST') throw e; });
        await this.persist();
      } else this.state = stateSchema.parse(raw);
    }
    catch (error: any) { if (error.code !== 'ENOENT') throw new Error('Chromatic settings could not be read. The original file has been preserved. Restore settings.json from your backup before continuing.'); }
  }
  // Everything written must load again, so each changed profile and the rest of the state
  // are still validated before saving.
  private valid(): State {
    const next = new Map<string, { input: string; output: Profile }>();
    const profiles = this.state.profiles.map(p => {
      const input = JSON.stringify(p); const cached = this.validated.get(p.id);
      const output = cached?.input === input ? cached.output : profileSchema.parse(p);
      next.set(p.id, { input, output }); return output;
    });
    if (next.size !== profiles.length) return stateSchema.parse(this.state); // Duplicate ids: validate normally.
    const state = stateSchema.parse({ ...this.state, profiles: [] });
    state.profiles = profiles; this.validated = next;
    return state;
  }
  persist() {
    const data = JSON.stringify(this.valid(), null, 2);
    this.queue = this.queue.catch(() => {}).then(async () => {
      const temp = path.join(this.root, 'settings.tmp');
      await fs.writeFile(temp, data, { mode: 0o600 });
      await fs.rename(temp, path.join(this.root, 'settings.json'));
    });
    return this.queue;
  }
}
export function visibleProfiles(profiles: Profile[], unlocked: boolean, launcher = false) { return profiles.filter(p => !p.hidden || (unlocked && !launcher)); }
export function requireProfile(profiles: Profile[], id: string, unlocked: boolean) {
  const profile = profiles.find(p => p.id === id);
  if (!profile) throw new Error('This profile is no longer registered in Chromatic.');
  if (profile.hidden && !unlocked) throw new Error('Unlock discreet profiles to continue.');
  return profile;
}
export const referenceSchema = z.object({ version: z.literal(1), profileId: z.string().uuid() }).strict();
export type { Browser, Profile, Settings };

export function migrateV1(raw: any) {
  const browsers = raw.browsers.filter((b: any) => b.family === 'chromium');
  const firefoxIds = new Set(raw.browsers.filter((b: any) => b.family === 'firefox').map((b: any) => b.id));
  const profiles = raw.profiles.filter((p: any) => !firefoxIds.has(p.browserId)).map((p: any) => {
    const { tags, labels, cacheRoot, proxy, ...rest } = p;
    let next = { mode: 'system', protocol: 'http', host: '', port: 8080, username: '' } as any;
    if (proxy) {
      try {
        const url = new URL(proxy.includes('://') ? proxy : `http://${proxy}`);
        if (!['http:', 'https:', 'socks5:'].includes(url.protocol) || url.username || url.password || (url.pathname && url.pathname !== '/') || url.search || url.hash) throw new Error();
        next = { mode: 'server', protocol: url.protocol.slice(0, -1), host: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : url.protocol === 'socks5:' ? 1080 : 80)), username: '' };
      } catch { next.mode = 'review'; next.legacy = proxy.replace(/(\/\/)[^/@]+@/g, '$1[credentials]@'); }
    }
    return { ...rest, labels: labels || tags || [], proxy: next };
  });
  return { ...raw, version: 2, browsers, profiles, proxySecrets: {}, settings: { ...raw.settings, defaultFlags: { chromium: raw.settings.defaultFlags.chromium }, groupBy: 'none', sortBy: 'favorites' } };
}
