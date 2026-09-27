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
export async function processes(): Promise<ProcessInfo[]> {
  const data = await powershell("@(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object Name,ProcessId,ExecutablePath,CommandLine) | ConvertTo-Json -Compress");
  return JSON.parse(data || '[]');
}
