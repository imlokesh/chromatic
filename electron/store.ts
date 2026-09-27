import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Browser, Profile, Settings } from '../shared/types';
const stringList = z.array(z.string().max(4096)).max(100);
export const settingsSchema = z.object({
  hotkey: z.string().min(3).max(80), startup: z.boolean(), theme: z.enum(['system', 'light', 'dark']),
  defaultFlags: z.object({ chromium: stringList, firefox: stringList })
}).strict();
export const profileSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(120), browserId: z.string().min(1).max(500),
  kind: z.enum(['managed', 'existing']), dataDir: z.string().max(4096), profileDir: z.string().max(200).optional(), cacheRoot: z.string().max(4096).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20), color: z.string().regex(/^#[0-9a-f]{6}$/i),
  favorite: z.boolean(), hidden: z.boolean(), urls: stringList, flags: stringList, extensions: stringList,
  proxy: z.string().max(1024), noDefaultFlags: z.boolean(), lastUsed: z.number().optional(), createdAt: z.number()
}).strict();
export const draftSchema = profileSchema.omit({ id: true, createdAt: true, lastUsed: true }).extend({ id: z.string().uuid().optional() });
const browserSchema = z.object({ id: z.string(), name: z.string(), executable: z.string(), family: z.enum(['chromium', 'firefox']), dataRoot: z.string().optional(), isDefault: z.boolean().optional(), unpackedExtensions: z.boolean() });
const stateSchema = z.object({ version: z.literal(1), profiles: z.array(profileSchema), browsers: z.array(browserSchema), settings: settingsSchema,
  pin: z.string().optional(), attempts: z.number().default(0), blockedUntil: z.number().default(0) });
export type State = z.infer<typeof stateSchema>;
export class Store {
  state: State = { version: 1, profiles: [], browsers: [], attempts: 0, blockedUntil: 0, settings: { hotkey: 'Ctrl+Alt+Space', startup: false, theme: 'system', defaultFlags: { chromium: ['--no-first-run', '--no-default-browser-check'], firefox: [] } } };
  private queue: Promise<void> = Promise.resolve();
  constructor(public readonly root: string) {}
  async load() {
    await fs.mkdir(this.root, { recursive: true });
    try { this.state = stateSchema.parse(JSON.parse(await fs.readFile(path.join(this.root, 'settings.json'), 'utf8'))); }
    catch (error: any) { if (error.code !== 'ENOENT') throw new Error('Chromatic settings could not be read. The original file has been preserved. Restore settings.json from your backup before continuing.'); }
  }
  persist() {
    const data = JSON.stringify(stateSchema.parse(this.state), null, 2);
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
