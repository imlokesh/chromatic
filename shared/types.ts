export type Family = 'chromium' | 'firefox';
export interface Browser { id: string; name: string; executable: string; family: Family; dataRoot?: string; isDefault?: boolean; unpackedExtensions: boolean }
export interface Profile {
  id: string; name: string; browserId: string; kind: 'managed' | 'existing';
  dataDir: string; profileDir?: string; cacheRoot?: string;
  tags: string[]; color: string; favorite: boolean; hidden: boolean;
  urls: string[]; flags: string[]; extensions: string[]; proxy: string; noDefaultFlags: boolean;
  lastUsed?: number; createdAt: number;
}
export type ProfileDraft = Omit<Profile, 'id' | 'createdAt' | 'lastUsed'> & { id?: string };
export interface Settings { hotkey: string; startup: boolean; theme: 'system' | 'light' | 'dark'; defaultFlags: Record<Family, string[]> }
export interface Snapshot { profiles: Profile[]; browsers: Browser[]; settings: Settings; unlocked: boolean; hasPin: boolean; hotkeyError?: string; pending?: { action: 'launch' | 'edit'; id: string }; version: string }
export interface Candidate { key: string; name: string; browserId: string; dataDir: string; profileDir?: string; cacheRoot?: string }
export interface CacheItem { path: string; label: string; bytes: number; files: number }
export interface SlimPreview { token: string; profileId: string; name: string; items: CacheItem[]; bytes: number; skipped?: string }
export interface SlimResult { name: string; reclaimed: number; removed: number; skipped: number; message?: string }
export interface Api {
  snapshot(): Promise<Snapshot>;
  save(draft: ProfileDraft): Promise<Profile>;
  remove(id: string): Promise<void>;
  launch(id: string): Promise<void>;
  discover(): Promise<Candidate[]>;
  importProfiles(keys: string[]): Promise<void>;
  addBrowser(family: Family): Promise<void>;
  chooseDirectory(): Promise<string | null>;
  exportProfiles(ids: string[]): Promise<number>;
  previewSlim(ids: string[]): Promise<SlimPreview[]>;
  clean(tokens: string[]): Promise<SlimResult[]>;
  unlock(pin: string): Promise<void>;
  setPin(pin: string, oldPin?: string): Promise<void>;
  lock(): Promise<void>;
  settings(settings: Settings): Promise<void>;
  manager(id?: string): Promise<void>;
  dismiss(): Promise<void>;
  activity(): void;
  onChange(callback: () => void): () => void;
}
