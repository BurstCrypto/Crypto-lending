// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { accountMainnetService } from './runtime.server';
import { MAINNET_TREASURIES } from './public-config';

it('persists each verified account independently and rejects traversal identifiers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bonsai-account-mainnet-'));
  vi.stubEnv('MAINNET_DATA_DIR', directory);
  const first = accountMainnetService('11111111-1111-4111-8111-111111111111');
  const second = accountMainnetService('22222222-2222-4222-8222-222222222222');
  try {
    const config = { ...MAINNET_TREASURIES, ethereumTreasury: MAINNET_TREASURIES.ethereumTreasury as `0x${string}`, ethereumWallet: '0x1111111111111111111111111111111111111111' as const,
      solanaWallet: null, ethereumSourceRouter: null, ethereumSupplyRouter: null, solanaLookupTables: [] };
    first.configuration.write(config); first.journal.pause(true);
    expect(first.configuration.read()).toEqual(config);
    expect(() => second.configuration.read()).toThrow(/Connect/);
    expect(second.journal.paused()).toBe(false);
    expect(accountMainnetService('11111111-1111-4111-8111-111111111111')).toBe(first);
    expect(() => accountMainnetService('../11111111-1111-4111-8111-111111111111')).toThrow(/verified account/);
  } finally {
    first.journal.close(); second.journal.close(); vi.unstubAllEnvs();
    if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error('Unexpected test data directory.');
    rmSync(directory, { recursive: true, force: true });
  }
});
