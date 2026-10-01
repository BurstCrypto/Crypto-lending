import { lstatSync, mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { BridgeJournal } from '../mainnet/bridge-journal.server';
import { fail } from '../mainnet/policy';
import { LocalBridgeService } from '../mainnet/bridge-service.server';
import { readLocalWalletConfig, writeLocalWalletConfig } from './bridge-config.server';

const runtime = globalThis as typeof globalThis & {
  localMainnetServices?: Map<string, LocalBridgeService>;
};

export function localMainnetService() {
  const directory = process.env.LOCAL_MAINNET_TEST_DATA_DIR;
  if (!directory || !isAbsolute(directory)) return fail('Start the app with npm run dev:mainnet.');
  const services = (runtime.localMainnetServices ??= new Map());
  let service = services.get(directory);
  if (service) return service;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
    return fail('The mainnet journal directory must be a real local directory.');
  const path = join(directory, 'transactions.sqlite');
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      if (!lstatSync(path + suffix).isFile() || lstatSync(path + suffix).isSymbolicLink())
        return fail('The mainnet journal must use regular files.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  service = new LocalBridgeService(new BridgeJournal(path), undefined, undefined, {
    read: readLocalWalletConfig,
    write: writeLocalWalletConfig,
  });
  services.set(directory, service);
  return service;
}
