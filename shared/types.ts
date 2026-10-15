export type Family = 'chromium';
export interface Browser { id: string; name: string; executable: string; family: Family; dataRoot?: string; isDefault?: boolean; unpackedExtensions: boolean }
export interface Profile {
  id: string; name: string; browserId: string; kind: 'managed' | 'existing';
  dataDir: string; profileDir?: string; 
  labels: string[]; color: string; favorite: boolean; hidden: boolean;
  urls: string[]; flags: string[]; extensions: string[]; proxy: ProxyConfig; noDefaultFlags: boolean;
  lastUsed?: number; createdAt: number;
}
export type ProfileDraft = Omit<Profile, 'id' | 'createdAt' | 'lastUsed'> & { id?: string };
export interface Settings { hotkey: string; startup: boolean; theme: 'system' | 'light' | 'dark'; defaultFlags: Record<Family, string[]>; groupBy: 'none' | 'label'; sortBy: 'favorites' | 'name' | 'recent' }
export interface Snapshot { profiles: Profile[]; browsers: Browser[]; settings: Settings; unlocked: boolean; hasPin: boolean; hotkeyError?: string; pending?: { action: 'launch' | 'edit'; id: string }; version: string; operations: Operation[] }
export interface Candidate { key: string; name: string; browserId: string; dataDir: string; profileDir?: string; cacheRoot?: string }
export interface CacheItem { path: string; label: string; bytes: number; files: number }
export interface SlimPreview { token: string; profileId: string; name: string; items: CacheItem[]; bytes: number; skipped?: string }
export interface SlimResult { name: string; reclaimed: number; removed: number; skipped: number; message?: string }
export interface Api {
  copyProfile(id: string, mode: 'duplicate' | 'fork', name: string): Promise<string>;
  cancelOperation(id: string): Promise<void>;
  scanStorage(ids: string[]): Promise<string>;
  testProxy(proxy: ProxyConfig, profileId?: string): Promise<string>;
  labels(ids: string[], labels: string[], mode: 'add' | 'remove'): Promise<void>;
  locateBrowser(id: string): Promise<void>;
  openFolder(id: string): Promise<void>;
  snapshot(): Promise<Snapshot>;
  save(draft: ProfileDraft): Promise<Profile>;
  remove(id: string): Promise<void>;
  launch(id: string): Promise<void | { error: { code: string; profileId: string; message: string } }>;
  discover(): Promise<Candidate[]>;
  importProfiles(keys: string[]): Promise<void>;
  addBrowser(): Promise<void>;
  chooseDirectory(): Promise<string | null>;
  exportProfiles(ids: string[]): Promise<number>;
  previewSlim(ids: string[]): Promise<SlimPreview[]>;
  clean(tokens: string[]): Promise<SlimResult[]>;
  unlock(pin: string): Promise<void>;
  setPin(pin: string, oldPin?: string): Promise<void>;
  lock(): Promise<void>;
  settings(settings: Settings): Promise<void>;
  manager(id?: string): Promise<void>;
  launcher(): Promise<void>;
  clearPending(): Promise<void>;
  dismiss(): Promise<void>;
  activity(): void;
  onChange(callback: () => void): () => void;
}

export interface ProxyConfig { mode: 'system' | 'server' | 'review'; protocol: 'http' | 'https' | 'socks5'; host: string; port: number; username: string; hasPassword?: boolean; password?: string; clearPassword?: boolean; legacy?: string }
export interface StorageUsage { profileId: string; bytes: number; cacheBytes: number; sharedBytes: number; rootKey: string; scannedAt: number; incomplete: boolean; message?: string }
export interface Operation { id: string; type: 'fork' | 'duplicate' | 'storage' | 'proxy' | 'launch'; status: 'running' | 'complete' | 'error' | 'cancelled'; profileIds: string[]; done: number; total: number; message: string; resultId?: string; recoveryCode?: string; storage?: StorageUsage[]; proxyResult?: { ip: string; elapsedMs: number; checkedAt: number } }
export const emptyProxy = (): ProxyConfig => ({ mode: 'system', protocol: 'http', host: '', port: 8080, username: '' });
