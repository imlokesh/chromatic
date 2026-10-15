import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));
import { processes } from '../electron/windows';

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
