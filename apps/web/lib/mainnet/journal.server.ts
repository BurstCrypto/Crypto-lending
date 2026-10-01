import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { MAINNET_TEST, fail } from './policy';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const SESSION_MS = 30 * 60_000;

/** SQLite transactions and a unique active-wallet index survive reloads and process restarts. */
export class MainnetTestJournal {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), paused INTEGER NOT NULL);
      INSERT OR IGNORE INTO settings VALUES (1, 0);
      CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, wallet TEXT NOT NULL, message TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, wallet TEXT NOT NULL, expires INTEGER NOT NULL);
    `);
  }
  close() { this.db.close(); }
  paused(): boolean { return this.db.prepare('SELECT paused FROM settings WHERE id=1').get()!.paused === 1; }
  pause(value: boolean) { this.db.prepare('UPDATE settings SET paused=? WHERE id=1').run(value ? 1 : 0); }
  challenge(wallet: string, now = Date.now(), chainId = '1') {
    this.db.prepare('DELETE FROM challenges WHERE expires<=? OR wallet=?').run(now, wallet);
    const id = randomUUID();
    const message = `${MAINNET_TEST.origin} requests ownership proof for a local mainnet test.\nWallet: ${wallet}\nChain ID: ${chainId}\nNonce: ${randomBytes(32).toString('hex')}\nExpires: ${new Date(now + 120_000).toISOString()}\nThis message creates a local testing session. It does not approve token spending or authorize a transaction.`;
    this.db.prepare('INSERT INTO challenges VALUES (?,?,?,?)').run(id, wallet, message, now + 120_000);
    return { id, message, wallet };
  }
  readChallenge(id: string, now = Date.now()) {
    return this.db.prepare('SELECT * FROM challenges WHERE id=? AND expires>?').get(id, now) as
      { id: string; wallet: string; message: string; expires: number } | undefined;
  }
  session(challengeId: string, wallet: string, now = Date.now()): string {
    const token = randomBytes(32).toString('hex');
    this.atomic(() => {
      const consumed = this.db.prepare('DELETE FROM challenges WHERE id=? AND wallet=? AND expires>?').run(challengeId, wallet, now);
      if (consumed.changes !== 1) return fail('The ownership challenge has expired or was already used.');
      this.db.prepare('DELETE FROM sessions WHERE expires<=? OR wallet=?').run(now, wallet);
      this.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token), wallet, now + SESSION_MS);
    });
    return token;
  }
  authenticate(token: string, wallet: string, now = Date.now()): boolean {
    if (!/^[0-9a-f]{64}$/.test(token)) return false;
    return Boolean(this.db.prepare('SELECT id FROM sessions WHERE id=? AND wallet=? AND expires>?').get(hash(token), wallet, now));
  }
  logout(token: string) { this.db.prepare('DELETE FROM sessions WHERE id=?').run(hash(token)); }
  private atomic<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
