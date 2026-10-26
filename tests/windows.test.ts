import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));
import { dataDirInUse, defaultBrowserCommand, processes, processNames, registryValue } from '../electron/windows';

afterEach(() => vi.clearAllMocks());
describe('Windows process queries', () => {
  it('shares simultaneous requests, filters at source, and never reuses completed results', async () => {
    let finish!: (error: Error | null, stdout: { stdout: string }) => void;
    mocks.execFile.mockImplementation((_file, _args, _options, callback) => { finish = callback; });
    const a = processes('Chrome.exe'), b = processes('chrome.exe');
    expect(a).toBe(b); expect(mocks.execFile).toHaveBeenCalledOnce();
    const args = mocks.execFile.mock.calls[0][1]; const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    expect(script).toContain("-Filter 'Name=''chrome.exe'''");
    finish(null, { stdout: '{"Name":"chrome.exe","ProcessId":1}' });
    expect(await a).toEqual([{ Name: 'chrome.exe', ProcessId: 1 }]);
    const c = processes('chrome.exe'); expect(c).not.toBe(a); expect(mocks.execFile).toHaveBeenCalledTimes(2);
    finish(null, { stdout: '[]' }); expect(await c).toEqual([]);
  });
  it('retries after a failed query and safely quotes executable names', async () => {
    mocks.execFile.mockImplementationOnce((_file, _args, _options, callback) => callback(new Error('timeout')))
      .mockImplementation((_file, _args, _options, callback) => callback(null, { stdout: '[]' }));
    await expect(processes("a'b.exe")).rejects.toThrow('timeout');
    expect(await processes("a'b.exe")).toEqual([]);
    const args = mocks.execFile.mock.calls[1][1];
    expect(Buffer.from(args.at(-1), 'base64').toString('utf16le')).toContain("-Filter 'Name=''a\\''b.exe'''");
  });
});

describe('image name queries', () => {
  it('parses tasklist CSV rows and ignores the localized no-match notice', async () => {
    mocks.execFile.mockImplementationOnce((_file, _args, _options, callback) => callback(null, { stdout: '"chrome.exe","1234","Console","1","120,000 K"\r\n"chrome.exe","88","Console","1","5,000 K"\r\n' }))
      .mockImplementationOnce((_file, _args, _options, callback) => callback(null, { stdout: 'INFORMATION: Es werden keine Aufgaben mit den angegebenen Kriterien ausgeführt.\r\n' }));
    expect(await processNames('Chrome.exe')).toEqual([{ Name: 'chrome.exe', ProcessId: 1234 }, { Name: 'chrome.exe', ProcessId: 88 }]);
    expect(mocks.execFile.mock.calls[0][0]).toBe('tasklist.exe');
    expect(mocks.execFile.mock.calls[0][1]).toEqual(['/FI', 'IMAGENAME eq chrome.exe', '/FO', 'CSV', '/NH']);
    expect(await processNames('chrome.exe')).toEqual([]);
  });
  it('shares an in-flight query only when it started recently enough', async () => {
    const finishers: ((error: Error | null, stdout: { stdout: string }) => void)[] = [];
    mocks.execFile.mockImplementation((_file, _args, _options, callback) => { finishers.push(callback); });
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const a = processNames('chrome.exe'); expect(processNames('chrome.exe', 1000)).toBe(a);
    vi.setSystemTime(2000); const fresh = processNames('chrome.exe', 2000);
    expect(fresh).not.toBe(a); expect(mocks.execFile).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    for (const finish of finishers) finish(null, { stdout: '' });
    await Promise.all([a, fresh]); expect(await fresh).toEqual([]);
  });
  it('fails closed when tasklist fails', async () => {
    mocks.execFile.mockImplementationOnce((_file, _args, _options, callback) => callback(new Error('Access denied')));
    await expect(processNames('chrome.exe')).rejects.toThrow('Access denied');
  });
});

describe('registry lookups', () => {
  it('reads the value past the localized name column and expands environment strings', async () => {
    mocks.execFile.mockImplementationOnce((_file, _args, _options, callback) => callback(null, { stdout: '\r\nHKEY_CLASSES_ROOT\\X\\shell\\open\\command\r\n    (Standard)    REG_EXPAND_SZ    "%LOCALAPPDATA%\\Browser\\b.exe" -- "%1"\r\n\r\n' }));
    expect(await registryValue('HKCR\\X\\shell\\open\\command')).toBe(`"${process.env.LOCALAPPDATA}\\Browser\\b.exe" -- "%1"`);
    expect(mocks.execFile.mock.calls[0][1]).toEqual(['query', 'HKCR\\X\\shell\\open\\command', '/ve']);
  });
  it('resolves the https handler command in two reg.exe calls and never throws', async () => {
    mocks.execFile.mockImplementationOnce((_file, _args, _options, callback) => callback(null, { stdout: '    ProgId    REG_SZ    ChromeHTML\r\n' }))
      .mockImplementationOnce((_file, _args, _options, callback) => callback(null, { stdout: '    (Default)    REG_SZ    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --single-argument %1\r\n' }));
    expect(await defaultBrowserCommand()).toBe('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --single-argument %1');
    expect(mocks.execFile.mock.calls[1][1]).toEqual(['query', 'HKCR\\ChromeHTML\\shell\\open\\command', '/ve']);
    mocks.execFile.mockImplementationOnce((_file, _args, _options, callback) => callback(new Error('ERROR: The system was unable to find the specified registry key')));
    expect(await defaultBrowserCommand()).toBe('');
  });
});

describe('data folder lock probe', () => {
  it('reports free, locked, and stale lockfiles without modifying them', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chromatic-lock-'));
    try {
      expect(await dataDirInUse(dir)).toBe(false);
      expect(await dataDirInUse(path.join(dir, 'missing'))).toBe(false);
      await fs.writeFile(path.join(dir, 'lockfile'), 'stale');
      expect(await dataDirInUse(dir)).toBe(false); expect(await fs.readFile(path.join(dir, 'lockfile'), 'utf8')).toBe('stale');
      const busy = Object.assign(new Error('busy'), { code: 'EBUSY' }), denied = Object.assign(new Error('denied'), { code: 'EACCES' });
      const open = vi.spyOn(fs, 'open').mockRejectedValueOnce(busy).mockRejectedValueOnce(denied);
      expect(await dataDirInUse(dir)).toBe(true);
      expect(await dataDirInUse(dir)).toBeUndefined();
      open.mockRestore();
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
