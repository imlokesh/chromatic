import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Store } from './store';
const scrypt = promisify(scryptCallback);
interface Protector { encryptString(value: string): Buffer; decryptString(value: Buffer): string; isEncryptionAvailable(): boolean }
export class PinGate {
  private until = 0;
  // Attempts run one at a time; parallel calls would all pass the lockout check before any failed.
  private attempts: Promise<unknown> = Promise.resolve();
  constructor(private store: Store, private protector: Protector) {}
  get unlocked() { return this.until > Date.now(); }
  activity() { if (this.unlocked) this.until = Date.now() + 5 * 60_000; }
  lock() { this.until = 0; }
  private validate(pin: string) { if (!/^\d{4}$/.test(pin)) throw new Error('Enter exactly four digits.'); }
  unlock(pin: string) { const run = this.attempts.then(() => this.attempt(pin)); this.attempts = run.catch(() => {}); return run; }
  private async attempt(pin: string) {
    this.validate(pin);
    if (!this.store.state.pin) throw new Error('Set a PIN before hiding profiles.');
    if (this.store.state.blockedUntil > Date.now()) throw new Error(`Try again in ${Math.ceil((this.store.state.blockedUntil - Date.now()) / 1000)} seconds.`);
    const { salt, hash } = JSON.parse(this.protector.decryptString(Buffer.from(this.store.state.pin, 'base64')));
    const actual = await scrypt(pin, salt, 32) as Buffer;
    if (!timingSafeEqual(actual, Buffer.from(hash, 'hex'))) {
      this.store.state.attempts++;
      this.store.state.blockedUntil = Date.now() + Math.min(300_000, 1000 * 2 ** Math.min(this.store.state.attempts, 9));
      await this.store.persist(); throw new Error('Incorrect PIN. Please wait before trying again.');
    }
    this.store.state.attempts = 0; this.store.state.blockedUntil = 0;
    this.until = Date.now() + 5 * 60_000; await this.store.persist();
  }
  async set(pin: string, oldPin?: string) {
    this.validate(pin);
    if (this.store.state.pin) await this.unlock(oldPin || '');
    if (!this.protector.isEncryptionAvailable()) throw new Error('Windows secure storage is unavailable. A PIN cannot be saved.');
    const salt = randomBytes(32).toString('hex'); const hash = (await scrypt(pin, salt, 32) as Buffer).toString('hex');
    this.store.state.pin = this.protector.encryptString(JSON.stringify({ salt, hash })).toString('base64');
    await this.store.persist(); this.until = Date.now() + 5 * 60_000;
  }
}
