import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export async function powershell(script: string): Promise<string> {
  const { stdout } = await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}
// reg.exe answers in ~25 ms; starting PowerShell for the same lookup takes over a second.
export async function registryValue(key: string, name?: string) {
  const { stdout } = await exec('reg.exe', ['query', key, ...(name ? ['/v', name] : ['/ve'])], { windowsHide: true, timeout: 10000 });
  // The value name column is localized for the default value, so read past the type column instead.
  const match = /\sREG_(EXPAND_)?SZ\s+(.*)$/m.exec(stdout);
  if (!match) return '';
  const value = match[2].trim();
  return match[1] ? value.replace(/%([^%]+)%/g, (all, variable: string) => process.env[variable] ?? all) : value;
}
export async function defaultBrowserCommand() {
  try {
    const progId = await registryValue('HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', 'ProgId');
    if (!progId || /[\\\0]/.test(progId)) return '';
    return await registryValue(`HKCR\\${progId}\\shell\\open\\command`);
  } catch { return ''; }
}
export interface ProcessInfo { ExecutablePath?: string; CommandLine?: string; Name: string; ProcessId: number }
const processQueries = new Map<string, Promise<ProcessInfo[]>>();
export function processes(name?: string): Promise<ProcessInfo[]> {
  const key = name?.toLowerCase() || '';
  const pending = processQueries.get(key);
  if (pending) return pending;
  // Quote both the WQL literal and the enclosing PowerShell literal.
  const filter = key ? ` -Filter '${`Name='${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`.replace(/'/g, "''")}'` : '';
  const request = powershell(`@(Get-CimInstance Win32_Process${filter} -ErrorAction Stop | Select-Object Name,ProcessId,ExecutablePath,CommandLine) | ConvertTo-Json -Compress`)
    .then(data => { const rows = JSON.parse(data || '[]'); return Array.isArray(rows) ? rows : [rows]; })
    .finally(() => { if (processQueries.get(key) === request) processQueries.delete(key); });
  processQueries.set(key, request);
  return request;
}
// Image names only, for checks that refuse while any matching process runs. tasklist is
// roughly 8x faster than a CIM query. A request reuses an in-flight query only when that
// query started at or after `notBefore`, so callers can demand a fresh answer.
const nameQueries = new Map<string, { started: number; request: Promise<Pick<ProcessInfo, 'Name' | 'ProcessId'>[]> }>();
export function processNames(name: string, notBefore = 0): Promise<Pick<ProcessInfo, 'Name' | 'ProcessId'>[]> {
  const key = name.toLowerCase();
  const pending = nameQueries.get(key);
  if (pending && pending.started >= notBefore) return pending.request;
  const started = Date.now();
  const request = exec('tasklist.exe', ['/FI', `IMAGENAME eq ${key}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 })
    // Rows are CSV in every locale; the "no tasks" notice is localized plain text.
    .then(({ stdout }) => stdout.split(/\r?\n/).flatMap(line => { const row = /^"([^"]*)","(\d+)"/.exec(line); return row ? [{ Name: row[1], ProcessId: Number(row[2]) }] : []; }))
    .finally(() => { if (nameQueries.get(key)?.request === request) nameQueries.delete(key); });
  nameQueries.set(key, { started, request });
  return request;
}
// Chromium keeps <User Data>\lockfile open without write sharing while any of its processes
// use the folder, and deletes it on exit. Probing it takes about a millisecond. Returns
// undefined when the answer is uncertain so the caller can use a process query instead.
export async function dataDirInUse(dataDir: string): Promise<boolean | undefined> {
  try { const handle = await fs.open(path.join(dataDir, 'lockfile'), 'r+'); await handle.close(); return false; }
  catch (error: any) { return error.code === 'ENOENT' ? false : error.code === 'EBUSY' ? true : undefined; }
}
