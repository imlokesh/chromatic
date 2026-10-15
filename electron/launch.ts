import { spawn } from 'node:child_process';

// Reserve a root immediately, including while its request waits behind another launch.
export class LaunchQueue {
  private profiles = new Map<string, Promise<void>>();
  private roots = new Map<string, Promise<void>>();
  pending(id: string) { return this.profiles.get(id); }
  hasRoot(root: string) { return this.roots.has(root); }
  run(id: string, root: string, work: () => Promise<void>): Promise<void> {
    const pending = this.profiles.get(id);
    if (pending) return pending;
    const previous = this.roots.get(root) || Promise.resolve();
    const result = previous.catch(() => {}).then(work);
    const settled = result.then(() => {}, () => {}).finally(() => {
      if (this.profiles.get(id) === result) this.profiles.delete(id);
      if (this.roots.get(root) === settled) this.roots.delete(root);
    });
    this.profiles.set(id, result);
    this.roots.set(root, settled);
    return result;
  }
}

// Acceptance means Windows spawned the process, not that a browser window is ready.
export function spawnBrowser(executable: string, args: string[], earlyFailure: (error: Error) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: false, shell: false });
    let spawned = false;
    let reported = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopObserving = () => {
      if (timer) clearTimeout(timer);
      child.removeListener('error', fail);
      child.removeListener('exit', exit);
      // Release launch/UI closures after the observation window. We never send
      // IPC or signals to this detached child, but still consume late errors.
      child.on('error', () => {});
    };
    const fail = (error: Error) => {
      if (reported) return;
      reported = true;
      stopObserving();
      if (spawned) earlyFailure(error); else reject(error);
    };
    const exit = (code: number | null) => {
      if (code) fail(new Error(`The browser exited with code ${code}. Check its profile location and launch settings.`));
      else stopObserving();
    };
    child.on('error', fail);
    child.once('exit', exit);
    child.once('spawn', () => {
      spawned = true;
      child.unref();
      timer = setTimeout(stopObserving, 900);
      timer.unref();
      resolve();
    });
  });
}
