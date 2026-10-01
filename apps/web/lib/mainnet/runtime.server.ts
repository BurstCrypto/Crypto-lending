import { lstatSync, mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { BridgeJournal } from './bridge-journal.server';
import { LocalBridgeService } from './bridge-service.server';
import { parseLocalWalletConfig } from './wallet-config';
import { fail } from './policy';

const runtime = globalThis as typeof globalThis & {
  mainnetAccountServices?: Map<string, LocalBridgeService>;
};

/** A persistent volume is required; there is no temporary or shared-user fallback. */
export function accountMainnetService(accountId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(accountId))
    return fail('A verified account is required.');
  const root = process.env.MAINNET_DATA_DIR;
  if (!root || !isAbsolute(root))
    return fail('The mainnet transaction journal needs a configured persistent volume.');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink())
    return fail('Invalid mainnet data directory.');
  const directory = join(root, accountId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
    return fail('Invalid account data directory.');
  const path = join(directory, 'transactions.sqlite');
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      const file = lstatSync(path + suffix);
      if (!file.isFile() || file.isSymbolicLink()) return fail('Invalid transaction journal.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const services = (runtime.mainnetAccountServices ??= new Map());
  let service = services.get(path);
  if (service) return service;
  const journal = new BridgeJournal(path);
  journal.db.exec(
    'CREATE TABLE IF NOT EXISTS workspace_configuration (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)',
  );
  service = new LocalBridgeService(journal, undefined, undefined, {
    read() {
      const row = journal.db.prepare('SELECT body FROM workspace_configuration WHERE id=1').get();
      if (!row) return fail('Connect an Ethereum wallet, a Solana wallet, or both.');
      return parseLocalWalletConfig(JSON.parse(String(row.body)));
    },
    write(config) {
      journal.db
        .prepare(
          'INSERT INTO workspace_configuration(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
        )
        .run(JSON.stringify(parseLocalWalletConfig(config)));
    },
  });
  services.set(path, service);
  return service;
}
