// @vitest-environment node
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { toHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from '../../app/api/local-mainnet/route';
import { BridgeWallets } from '../mainnet/bridge-client';
import { parseBridgeConfig, parseLocalWalletConfig, readLocalWalletConfig, writeLocalWalletConfig } from './bridge-config.server';
import { BridgeJournal } from '../mainnet/bridge-journal.server';
import { LocalBridgeService } from '../mainnet/bridge-service.server';
import { BRIDGE_SOLANA, type LocalWalletConfig } from '../mainnet/bridge-types';
import { MAINNET_TEST } from '../mainnet/policy';
import * as runtime from './runtime.server';
import { MAINNET_TREASURIES } from '../mainnet/public-config';

// Deterministic test signers, never used for a public-chain transaction.
const ethereum = privateKeyToAccount(toHex(1, { size: 32 }));
const solana = Keypair.fromSeed(new Uint8Array(32).fill(4));
const treasury = Keypair.fromSeed(new Uint8Array(32).fill(5));
const allWallets: LocalWalletConfig = {
  ethereumWallet: ethereum.address.toLowerCase() as Hex, solanaWallet: solana.publicKey.toBase58(),
  ...MAINNET_TREASURIES, ethereumTreasury: MAINNET_TREASURIES.ethereumTreasury as Hex,
  ethereumSourceRouter: null, ethereumSupplyRouter: null, solanaLookupTables: [],
};
let journal: BridgeJournal, service: LocalBridgeService, configPath: string;
const origin = MAINNET_TEST.origin;
function request(operation: string, fields: Record<string, unknown> = {}, cookie = '', setupToken = 'a'.repeat(64)) {
  return new Request(`${origin}/api/local-mainnet`, { method: 'POST',
    headers: { host: '127.0.0.1:3000', origin, 'content-type': 'application/json', ...(setupToken ? { 'x-local-mainnet-setup': setupToken } : {}), cookie },
    body: JSON.stringify({ operation, ...fields }),
  });
}
beforeEach(() => {
  configPath = join(tmpdir(), `bonsai-wallet-selection-${randomUUID()}.json`);
  writeFileSync(configPath, JSON.stringify(allWallets));
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('LOCAL_MAINNET_TEST_MODE', 'enabled');
  vi.stubEnv('LOCAL_MAINNET_TEST_LAUNCH_TOKEN', 'a'.repeat(64)); vi.stubEnv('LOCAL_MAINNET_TEST_CONFIG', configPath);
  vi.stubEnv('DEPLOYMENT_TARGET', undefined); vi.stubEnv('LOCAL_DEMO_MODE', 'disabled');
  journal = new BridgeJournal(':memory:'); service = new LocalBridgeService(journal, undefined, undefined, { read: readLocalWalletConfig, write: writeLocalWalletConfig });
  vi.spyOn(runtime, 'localMainnetService').mockReturnValue(service);
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); journal.close();
  for (const path of [configPath, `${configPath}.tmp`]) { try { unlinkSync(path); } catch { /* No temporary file remains after a successful rename. */ } }
});

describe('selected-wallet sessions', () => {
  it.each(['Ethereum', 'Solana', 'both'])('connects and reads only the selected %s wallets without a message signature', async (selection) => {
    const useEthereum = selection !== 'Solana', useSolana = selection !== 'Ethereum';
    const config: LocalWalletConfig = { ...allWallets, ethereumWallet: useEthereum ? allWallets.ethereumWallet : null, solanaWallet: useSolana ? allWallets.solanaWallet : null };
    const wallets = new BridgeWallets();
    const ethereumRequest = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ethereum.address];
      if (method === 'eth_chainId') return '0x1';
      if (method === 'wallet_switchEthereumChain') return null;
      if (method === 'personal_sign') return ethereum.signMessage({ message: { raw: params![0] as Hex } });
      throw new Error(`Unexpected Ethereum request: ${method}`);
    });
    const selectEthereum = vi.fn(() => ({ provider: { request: ethereumRequest } }));
    Object.defineProperty(wallets.discovery, 'select', { value: selectEthereum });
    const account = { address: solana.publicKey.toBase58(), chains: ['solana:mainnet'] };
    const connectSolana = vi.fn(async () => ({ accounts: [account] }));
    const signSolana = vi.fn(async ({ message }: { message: Uint8Array }) => [{
      signedMessage: message,
      signature: sign(null, message, createPrivateKey({ format: 'der', type: 'pkcs8',
        key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(solana.secretKey.subarray(0, 32))]) })),
    }]);
    Object.assign(wallets, { options: new Map([['solana', { accounts: [account], features: {
      'standard:connect': { connect: connectSolana }, 'solana:signMessage': { signMessage: signSolana },
    } }]]) });
    expect(await wallets.selectAccounts(useEthereum ? 'ethereum' : '', useSolana ? 'solana' : '')).toEqual({ ethereumWallet: config.ethereumWallet, solanaWallet: config.solanaWallet });
    expect((await POST(request('configure', { config }))).status).toBe(200);

    const cookie = '';
    expect(selectEthereum).toHaveBeenCalledTimes(useEthereum ? 1 : 0);
    expect(connectSolana).toHaveBeenCalledTimes(useSolana ? 1 : 0);
    expect(signSolana).not.toHaveBeenCalled();
    expect(ethereumRequest.mock.calls.some(([{ method }]) => /personal_sign|sendTransaction|signTypedData/.test(method))).toBe(false);
    const state = await GET(new Request(origin + '/api/mainnet', { headers: { host: '127.0.0.1:3000', 'x-local-mainnet-setup': 'a'.repeat(64) } }));
    expect(await state.json()).toMatchObject({ configured: true, authenticated: false, localAccess: true, config });
    const ethereumRead = vi.spyOn(service.ethereum.rpc, 'inspect').mockResolvedValue({
      snapshot: { wallet: ethereum.address, blockNumber: '10', blockHash: '0x01', observedAt: Date.now(), usdc: '5000000', supplied: '0', allowance: '0', eth: '10000000000000000', totalDebt: '0' },
      nonce: '0x0', head: { number: '0xa', hash: '0x01', baseFee: 1n }, active: true, frozen: false, paused: false,
    });
    const solanaRead = vi.spyOn(service.solana, 'inspect').mockResolvedValue({ supplied: '0', receiptExchangeRate: '1200000000000000000', usdc: '5000000', collateral: '0', lamports: '100000000', circleFeeRecipient: treasury.publicKey.toBase58(), minimumFeeBps: 0, slot: 10 });
    const readiness = await POST(request('preflight', {}, cookie));
    expect(readiness.status).toBe(200);
    const balances = await readiness.json();
    expect(balances.ethereum === null).toBe(!useEthereum); expect(balances.solana === null).toBe(!useSolana);
    expect(ethereumRead).toHaveBeenCalledTimes(useEthereum ? 1 : 0);
    expect(solanaRead).toHaveBeenCalledTimes(useSolana ? 1 : 0);
    if (selection !== 'both') {
      const create = vi.spyOn(service, 'create');
      const response = await POST(request('create', { sourceNetwork: BRIDGE_SOLANA, amount: '1' }, cookie));
      expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'Connect both Ethereum and Solana wallets to bridge between chains.' });
      expect(create).not.toHaveBeenCalled();
      expect((await POST(request('configure', { config: allWallets }))).status).toBe(200);
      expect((await POST(request('preflight', {}, cookie, ''))).status).toBe(401); // The previous session cannot authorize reads without the launch capability.
      expect((await POST(request('create', { sourceNetwork: BRIDGE_SOLANA, amount: '1' }, cookie, ''))).status).toBe(401); // A stale session without the current local capability cannot prepare transactions.
    }
    expect(journal.steps()).toEqual([]); expect(journal.bridges()).toEqual([]);
  });

  it('accepts a single public wallet for connection while requiring both for a bridge', () => {
    for (const single of [{ ...allWallets, ethereumWallet: null }, { ...allWallets, solanaWallet: '' }]) {
      expect(() => parseLocalWalletConfig(single)).not.toThrow();
      expect(() => parseBridgeConfig(single)).toThrow(/both Ethereum and Solana/);
    }
    expect(() => parseLocalWalletConfig({ ...allWallets, ethereumWallet: null, solanaWallet: null })).toThrow(/at least one/);
  });

  it.each(['Ethereum', 'Solana', 'both'])('reads the selected %s balances without an ownership session, but only from the local launch', async (selection) => {
    const config = { ...allWallets, ethereumWallet: selection === 'Solana' ? null : allWallets.ethereumWallet, solanaWallet: selection === 'Ethereum' ? null : allWallets.solanaWallet };
    expect((await POST(request('configure', { config }))).status).toBe(200);
    const ethereumRead = vi.spyOn(service.ethereum.rpc, 'inspect').mockResolvedValue({ snapshot: { usdc: '5000000', eth: '10000000000000000' } } as never);
    const solanaRead = vi.spyOn(service.solana, 'inspect').mockResolvedValue({ usdc: '6000000', lamports: '100000000' } as never);
    for (const token of ['', 'b'.repeat(64)]) expect((await POST(request('preflight', {}, '', token))).status).toBe(401);
    const foreignRequest = request('preflight'); foreignRequest.headers.set('origin', 'https://example.com');
    expect((await POST(foreignRequest)).status).toBe(404);
    expect(ethereumRead).not.toHaveBeenCalled(); expect(solanaRead).not.toHaveBeenCalled();
    const readiness = await POST(request('preflight'));
    expect(readiness.status).toBe(200); expect(readiness.headers.has('set-cookie')).toBe(false);
    const balances = await readiness.json();
    expect(balances.ethereum === null).toBe(selection === 'Solana');
    expect(balances.solana === null).toBe(selection === 'Ethereum');
    expect(ethereumRead).toHaveBeenCalledTimes(selection === 'Solana' ? 0 : 1);
    expect(solanaRead).toHaveBeenCalledTimes(selection === 'Ethereum' ? 0 : 1);
    const state = await GET(new Request(`${origin}/api/local-mainnet`, { headers: { host: '127.0.0.1:3000', 'x-local-mainnet-setup': 'a'.repeat(64) } }));
    expect(await state.json()).toMatchObject({ authenticated: false, bridges: [], steps: [] });
    for (const operation of ['deploy', 'create', 'source', 'attestation', 'destination', 'lookup', 'reserve', 'signed', 'dispatch-solana', 'submitted', 'reconcile', 'cancel-step', 'cancel-bridge', 'rejected', 'pause']) {
      expect((await POST(request(operation, {}, '', ''))).status, operation).toBe(401);
    }
    expect(journal.bridges()).toEqual([]); expect(journal.steps()).toEqual([]); expect(journal.paused()).toBe(false);
  });

  it.each(['ledger-error', 'no-message-support'])('connects a Solana hardware wallet without invoking unsupported message signing: %s', async (mode) => {
    const config = { ...allWallets, ethereumWallet: null };
    const wallets = new BridgeWallets();
    const account = { address: solana.publicKey.toBase58(), chains: ['solana:mainnet'] };
    const signMessage = vi.fn().mockRejectedValue(new Error('[ledgerUnknownSignError] [Ledger Sign Error]: Ledger device: UNKNOWN_ERROR (0x6a81)'));
    const signTransaction = vi.fn();
    Object.assign(wallets, { options: new Map([['solana', { accounts: [account], features: {
      'standard:connect': { connect: vi.fn(async () => ({ accounts: [account] })) },
      'solana:signTransaction': { signTransaction },
      ...(mode === 'ledger-error' ? { 'solana:signMessage': { signMessage } } : {}),
    } }]]) });
    expect((await POST(request('configure', { config }))).status).toBe(200);
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      expect(body.operation).toBe('challenge'); // A failed message must never be sent to authenticate.
      return POST(request('challenge'));
    });
    await wallets.connect('', 'solana', config);
    expect(fetch).not.toHaveBeenCalled(); expect(signMessage).not.toHaveBeenCalled();
    await expect(wallets.check(config)).resolves.toBeUndefined();
    expect(signTransaction).not.toHaveBeenCalled();
    expect(signMessage).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    const state = await GET(new Request(`${origin}/api/local-mainnet`, { headers: { host: '127.0.0.1:3000', 'x-local-mainnet-setup': 'a'.repeat(64) } }));
    expect(await state.json()).toMatchObject({ authenticated: false, steps: [], bridges: [] });
    expect((await POST(request('deploy', { kind: 'DEPLOY_SOURCE' }, '', ''))).status).toBe(401);
  });
});
