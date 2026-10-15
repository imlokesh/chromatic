import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export async function powershell(script: string): Promise<string> {
  const { stdout } = await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}
export async function defaultBrowserCommand() {
  try {
    return await powershell("$p=(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice' -ErrorAction Stop).ProgId; (Get-Item -LiteralPath ('Registry::HKEY_CLASSES_ROOT\\'+$p+'\\shell\\open\\command') -ErrorAction Stop).GetValue('')");
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
