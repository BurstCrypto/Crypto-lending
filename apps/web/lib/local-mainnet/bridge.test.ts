// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { encodeFunctionData, hashTypedData, parseAbi, toHex } from 'viem';
import {
  createSourceBridgePlan,
  BRIDGE_INTENT_TYPES,
  ethereumBridgeIntent,
} from '../../../../onchain/src/source-plan';
import { serializeSourcePlan } from '../../../../onchain/src/plan-storage';
import { BridgeJournal, fingerprint } from '../mainnet/bridge-journal.server';
import { BridgeSolana } from '../mainnet/bridge-solana.server';
import { BridgeEthereum, compareRouterCode } from '../mainnet/bridge-ethereum.server';
import { LocalBridgeService } from '../mainnet/bridge-service.server';
import {
  BRIDGE_ETHEREUM,
  BRIDGE_SOLANA,
  type BridgeConfig,
  type BridgeRecord,
  type BridgeStep,
} from '../mainnet/bridge-types';
import { isLocalMainnetRequest, localMainnetConfig } from './config.server';
import { parseBridgeConfig, readTreasurySetup } from './bridge-config.server';
import { BridgeWallets, validateReviewedStep } from '../mainnet/bridge-client';
import { MAINNET_TEST, TOKEN_ABI } from '../mainnet/policy';
import { GET, POST } from '../../app/api/local-mainnet/route';

const wallet = Keypair.fromSeed(new Uint8Array(32).fill(4)),
  treasury = Keypair.fromSeed(new Uint8Array(32).fill(5));
const config: BridgeConfig = {
  ethereumWallet: '0x1111111111111111111111111111111111111111',
  solanaWallet: wallet.publicKey.toBase58(),
  ethereumTreasury: '0x2222222222222222222222222222222222222222',
  solanaTreasury: treasury.publicKey.toBase58(),
  ethereumSourceRouter: '0x3333333333333333333333333333333333333333',
  ethereumSupplyRouter: '0x4444444444444444444444444444444444444444',
  solanaLookupTables: [],
};
const records: BridgeJournal[] = [],
  paths: string[] = [];
function journal(disk = false) {
  const path = disk ? join(tmpdir(), `bonsai-test-${randomUUID()}.sqlite`) : ':memory:';
  if (disk) paths.push(path);
  const j = new BridgeJournal(path);
  records.push(j);
  return j;
}
function bridge(status: BridgeRecord['status'] = 'CREATED'): BridgeRecord {
  return {
    id: toHex(crypto.getRandomValues(new Uint8Array(32))),
    config,
    plan: {},
    createdAt: Date.now(),
    status,
    revision: 0,
    sourceTransactionId: null,
    emittedMessage: null,
    attestation: null,
    received: null,
  };
}
function step(b: BridgeRecord | null = null, changes: Partial<BridgeStep> = {}): BridgeStep {
  const s: BridgeStep = {
    id: randomUUID(),
    bridgeId: b?.id ?? null,
    kind: b ? 'SOURCE_BURN' : 'DEPLOY_SOURCE',
    network: BRIDGE_ETHEREUM,
    wallet: config.ethereumWallet,
    state: 'PREPARED',
    createdAt: Date.now(),
    expiresAt: Date.now() + 120_000,
    fingerprint: '',
    transactionId: null,
    ethereum: {
      from: config.ethereumWallet,
      value: '0x0',
      data: `0x60${'00'.repeat(600)}`,
      chainId: '0x1',
      type: '0x2',
      gas: '0x186a0',
      nonce: '0x0',
      maxFeePerGas: '0x3b9aca00',
      maxPriorityFeePerGas: '0x1',
    },
    solana: null,
    maxNetworkCost: '100000000000000',
    sourcePrincipal: b ? '1000000' : '0',
    evidence: {},
    ...changes,
  };
  s.fingerprint = fingerprint({ ethereum: s.ethereum, solana: s.solana, evidence: s.evidence });
  return s;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const j of records.splice(0)) {
    try {
      j.close();
    } catch {
      /* Already closed for restart test. */
    }
  }
  for (const p of paths.splice(0))
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        unlinkSync(p + suffix);
      } catch {
        /* Sidecars may already be removed. */
      }
    }
});

describe('wallet address discovery', () => {
  it.each(['0x1', '0x2'])(
    'reads wallet-selected addresses and enforces Ethereum mainnet before any ownership request: %s',
    async (chainId) => {
      const wallets = new BridgeWallets();
      const request = vi.fn(async ({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts')
          return [config.ethereumWallet];
        if (method === 'eth_chainId') return chainId;
        if (method === 'wallet_switchEthereumChain') return null;
        throw new Error(`Unexpected wallet method: ${method}`);
      });
      Object.defineProperty(wallets.discovery, 'select', {
        value: () => ({ provider: { request } }),
      });
      const account = { address: config.solanaWallet, chains: ['solana:mainnet'] };
      const connect = vi.fn(async () => ({ accounts: [account] }));
      Object.assign(wallets, {
        options: new Map([
          ['solana', { accounts: [account], features: { 'standard:connect': { connect } } }],
        ]),
      });
      const fetch = vi.spyOn(globalThis, 'fetch');
      if (chainId === '0x1') {
        await expect(wallets.selectAccounts('ethereum', 'solana')).resolves.toEqual({
          ethereumWallet: config.ethereumWallet,
          solanaWallet: config.solanaWallet,
        });
      } else
        await expect(wallets.selectAccounts('ethereum', 'solana')).rejects.toThrow(
          /Ethereum mainnet/,
        );
      expect(fetch).not.toHaveBeenCalled();
      expect(request.mock.calls.some(([{ method }]) => /sign|send/i.test(method))).toBe(false);
    },
  );
});

describe('local-only boundary', () => {
  it('prefills only valid saved treasury addresses before transaction wallets are configured', () => {
    const path = join(tmpdir(), `bonsai-setup-${randomUUID()}.json`);
    paths.push(path);
    vi.stubEnv('LOCAL_MAINNET_TEST_CONFIG', path);
    writeFileSync(
      path,
      JSON.stringify({
        ethereumTreasury: config.ethereumTreasury,
        solanaTreasury: config.solanaTreasury,
        privateKey: 'excluded',
      }),
    );
    expect(readTreasurySetup()).toEqual({
      ethereumTreasury: config.ethereumTreasury,
      solanaTreasury: config.solanaTreasury,
    });
    writeFileSync(
      path,
      JSON.stringify({ ethereumTreasury: 'invalid', solanaTreasury: config.solanaTreasury }),
    );
    expect(readTreasurySetup()).toEqual({
      ethereumTreasury: '',
      solanaTreasury: config.solanaTreasury,
    });
  });
  it('never enables in production, demo mode, or without an explicit launch capability', () => {
    const env = {
      NODE_ENV: 'development',
      LOCAL_MAINNET_TEST_MODE: 'enabled',
      LOCAL_MAINNET_TEST_LAUNCH_TOKEN: 'a'.repeat(64),
    };
    expect(localMainnetConfig(env)).toBeTruthy();
    for (const change of [
      { NODE_ENV: 'production' },
      { LOCAL_DEMO_MODE: 'enabled' },
      { DEPLOYMENT_TARGET: 'mainnet' },
      { LOCAL_MAINNET_TEST_LAUNCH_TOKEN: '' },
    ])
      expect(localMainnetConfig({ ...env, ...change })).toBeNull();
  });
  it('accepts Next internal URL normalization but rejects hostile Host, Origin and forwarding', () => {
    const request = (
      headers: Record<string, string>,
      url = 'http://localhost:3000/api/local-mainnet',
    ) => ({
      url,
      headers: new Headers({ host: '127.0.0.1:3000', origin: MAINNET_TEST.origin, ...headers }),
    });
    expect(isLocalMainnetRequest(request({}), true)).toBe(true);
    for (const h of [
      { host: 'evil.test' },
      { host: 'localhost:3000' },
      { origin: 'https://evil.test' },
      { 'x-forwarded-for': '192.0.2.1' },
      { forwarded: 'for=127.0.0.1' },
      { 'sec-fetch-site': 'cross-site' },
    ])
      expect(isLocalMainnetRequest(request(h), true)).toBe(false);
    expect(
      isLocalMainnetRequest(
        { url: MAINNET_TEST.origin, headers: new Headers({ host: '127.0.0.1:3000' }) },
        true,
      ),
    ).toBe(false);
  });
  it('hides the API in production before loading the journal or making network calls', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LOCAL_MAINNET_TEST_MODE', 'enabled');
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect((await GET(new Request(`${MAINNET_TEST.origin}/api/local-mainnet`))).status).toBe(404);
    expect(
      (await POST(new Request(`${MAINNET_TEST.origin}/api/local-mainnet`, { method: 'POST' })))
        .status,
    ).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requires both wallets and independent treasuries, rejects secrets and duplicate routers', () => {
    expect(
      parseBridgeConfig({ ...config, ethereumSourceRouter: null, ethereumSupplyRouter: null }),
    ).toMatchObject({ ethereumSourceRouter: null });
    for (const c of [
      { ...config, solanaTreasury: '' },
      { ...config, ethereumTreasury: config.ethereumWallet },
      { ...config, privateKey: 'never accepted' },
      { ...config, ethereumSupplyRouter: config.ethereumSourceRouter },
    ])
      expect(() => parseBridgeConfig(c)).toThrow();
  });
});
describe('durable reservations', () => {
  it('keeps the one source reservation after restart and never releases it merely because time passes', () => {
    const j = journal(true),
      b = bridge();
    j.createBridge(b);
    const s = j.createStep(step(b));
    j.reserveStep(s.id);
    j.close();
    const reopened = new BridgeJournal(paths[0]!);
    records.push(reopened);
    expect(reopened.bridge(b.id).status).toBe('SOURCE_PENDING');
    expect(() => reopened.reserveStep(s.id, Date.now() + 86400000)).toThrow();
    expect(() => reopened.createStep(step(b))).toThrow(/pending/);
    expect(() => reopened.createBridge(bridge())).toThrow(/recover/);
  });
  it('allows principal beyond the former daily cap and rolls back an invalid reservation atomically', () => {
    const j = journal();
    for (let i = 0; i < 5; i++) {
      const b = bridge();
      j.createBridge(b);
      const s = j.createStep(step(b));
      j.reserveStep(s.id);
      j.changeStep(s.id, ['RESERVED'], { state: 'FAILED' });
      j.updateBridge({ ...j.bridge(b.id), status: 'SOURCE_FAILED' });
    }
    const b = bridge();
    j.createBridge(b);
    const s = j.createStep(step(b, { sourcePrincipal: '9000000000000001' }));
    expect(() => j.reserveStep(s.id)).toThrow(/numeric range/);
    expect(j.bridge(b.id).status).toBe('CREATED');
    expect(j.step(s.id).state).toBe('PREPARED');
  });
  it('adds Ethereum gas budgets exactly above the JavaScript safe integer range', () => {
    const j = journal();
    for (let i = 0; i < 3; i++) {
      const s = j.createStep(step(null, { maxNetworkCost: '10000000000000000' }));
      j.reserveStep(s.id);
      j.changeStep(s.id, ['RESERVED'], { state: 'FAILED' });
    }
    const s = j.createStep(step());
    expect(() => j.reserveStep(s.id)).toThrow(/network-cost/);
    expect(j.step(s.id).state).toBe('PREPARED');
  });
  it('blocks paused source work while allowing destination recovery', () => {
    const j = journal(),
      b = bridge();
    j.createBridge(b);
    j.pause(true);
    const source = j.createStep(step(b));
    expect(() => j.reserveStep(source.id)).toThrow(/paused/);
    j.changeStep(source.id, ['PREPARED'], { state: 'CANCELLED' });
    j.updateBridge({ ...j.bridge(b.id), status: 'READY_TO_MINT' });
    const recovery = j.createStep(step(b, { kind: 'DESTINATION_MINT', sourcePrincipal: '0' }));
    expect(j.reserveStep(recovery.id).state).toBe('RESERVED');
  });
  it('consumes ownership challenges once and binds the session to both wallets and setup', () => {
    const j = journal(),
      scope = `${config.ethereumWallet}\n${config.solanaWallet}`,
      c = j.challenge(scope);
    const token = j.session(c.id, scope);
    expect(j.authenticate(token, scope)).toBe(true);
    expect(j.authenticate(token, `${scope}-changed`)).toBe(false);
    expect(() => j.session(c.id, scope)).toThrow(/already used/);
    expect(j.authenticate(token, scope, Date.now() + 1800001)).toBe(false);
  });
});
describe('wallet and receipt verification', () => {
  it('sends an explicit EIP-712 domain matching the router quote and rejects changed signing types', async () => {
    const j = journal(),
      deadline = BigInt(Math.floor(Date.now() / 1000)) + 300n;
    const plan = createSourceBridgePlan({
      sourceNetwork: BRIDGE_ETHEREUM,
      sourceWallet: config.ethereumWallet,
      destinationWallet: config.solanaWallet,
      principal: 1000000n,
      maxBridgeFee: 0n,
      minimumDestinationAmount: 1000000n,
      treasuries: { ethereum: config.ethereumTreasury, solana: config.solanaTreasury },
      deadline,
      nowSeconds: deadline - 300n,
    });
    const b = { ...bridge(), id: plan.intentId, plan: serializeSourcePlan(plan) };
    j.createBridge(b);
    const quote = new LocalBridgeService(j).quote(b.id),
      wallets = new BridgeWallets();
    const request = vi.fn().mockResolvedValue('signature');
    Object.assign(wallets, { ethereum: { request } });
    vi.spyOn(wallets, 'check').mockResolvedValue(undefined);
    await wallets.quote(quote, b);
    const payload = JSON.parse(request.mock.calls[0]![0].params[1]);
    expect(payload.types.EIP712Domain).toHaveLength(4);
    expect(hashTypedData(payload)).toBe(
      hashTypedData({
        domain: quote.domain,
        types: BRIDGE_INTENT_TYPES,
        primaryType: 'BridgeIntent',
        message: ethereumBridgeIntent(plan),
      }),
    );
    await expect(wallets.quote({ ...quote, types: { BridgeIntent: [] } }, b)).rejects.toThrow(
      /types changed/,
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('accepts only the originally reviewed Ethereum target, amount and chain', async () => {
    const b = bridge(),
      s = step(b, {
        kind: 'SOURCE_APPROVAL',
        sourcePrincipal: '0',
        evidence: { spender: config.ethereumSourceRouter!, amount: '1002000' },
      });
    s.ethereum = {
      ...s.ethereum!,
      to: MAINNET_TEST.usdc,
      data: encodeFunctionData({
        abi: TOKEN_ABI,
        functionName: 'approve',
        args: [config.ethereumSourceRouter!, 1_002_000n],
      }),
    };
    s.fingerprint = fingerprint({ ethereum: s.ethereum, solana: null, evidence: s.evidence });
    await expect(validateReviewedStep(s, config, b)).resolves.toBeUndefined();
    for (const tx of [
      { ...s.ethereum, chainId: '0x2' },
      { ...s.ethereum, to: config.ethereumTreasury },
      {
        ...s.ethereum,
        data: encodeFunctionData({
          abi: TOKEN_ABI,
          functionName: 'approve',
          args: [config.ethereumSourceRouter!, (1n << 256n) - 1n],
        }),
      },
    ]) {
      const changed = { ...s, ethereum: tx } as BridgeStep;
      changed.fingerprint = fingerprint({ ethereum: tx, solana: null, evidence: s.evidence });
      await expect(validateReviewedStep(changed, config, b)).rejects.toThrow();
    }
  });
  it('matches the real four-argument mint-and-supply ABI and exact received amount', async () => {
    const b = {
      ...bridge('READY_TO_MINT'),
      received: '999000',
      attestation: { message: '0x12' as const, signature: '0x34' as const },
    };
    const s = step(b, { kind: 'DESTINATION_MINT_SUPPLY', sourcePrincipal: '0' });
    s.ethereum = {
      ...s.ethereum!,
      to: config.ethereumSupplyRouter!,
      data: encodeFunctionData({
        abi: parseAbi(['function mintAndSupply(bytes,bytes,uint256,uint256)']),
        functionName: 'mintAndSupply',
        args: ['0x12', '0x34', 999000n, 998999n],
      }),
    };
    s.fingerprint = fingerprint({ ethereum: s.ethereum, solana: null, evidence: s.evidence });
    await expect(validateReviewedStep(s, config, b)).resolves.toBeUndefined();
    await expect(validateReviewedStep(s, config, { ...b, received: '1000000' })).rejects.toThrow(
      /amount/,
    );
  });
  it('does not resend or close a reservation after an ambiguous wallet failure', async () => {
    const s = step(),
      reserved = { ...s, state: 'RESERVED' as const },
      provider = { request: vi.fn().mockRejectedValue(new Error('Disconnected after send')) };
    const wallets = new BridgeWallets();
    Object.assign(wallets, { ethereum: provider });
    vi.spyOn(wallets, 'check').mockResolvedValue(undefined);
    vi.stubGlobal('localStorage', { setItem: vi.fn() });
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(reserved));
    await expect(wallets.send(s, config, undefined, vi.fn(), 'a'.repeat(64))).rejects.toThrow(
      'Disconnected',
    );
    expect(provider.request).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body)).operation).toBe('reserve');
  });
  it('makes no wallet request when local durable recovery storage is unavailable', async () => {
    const provider = { request: vi.fn() },
      wallets = new BridgeWallets();
    Object.assign(wallets, { ethereum: provider });
    vi.spyOn(wallets, 'check').mockResolvedValue(undefined);
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('storage denied');
      },
    });
    const fetch = vi.spyOn(globalThis, 'fetch');
    await expect(wallets.send(step(), config, undefined, vi.fn())).rejects.toThrow(
      'storage denied',
    );
    expect(provider.request).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('verifies every Solana signature and rejects wallet message substitution', () => {
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: treasury.publicKey.toBase58(),
        instructions: [
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: treasury.publicKey,
            lamports: 1,
          }),
        ],
      }).compileToV0Message(),
    );
    const s = step(null, {
      network: BRIDGE_SOLANA,
      wallet: wallet.publicKey.toBase58(),
      ethereum: null,
      solana: {
        serialized: Buffer.from(tx.serialize()).toString('base64'),
        message: Buffer.from(tx.message.serialize()).toString('base64'),
        version: 0,
        lastValidBlockHeight: 20,
        contextSlot: 10,
      },
    });
    const solana = new BridgeSolana();
    expect(() => solana.verifySigned(s, Buffer.from(tx.serialize()).toString('base64'))).toThrow(
      /signature/,
    );
    tx.sign([wallet]);
    expect(
      solana.verifySigned(s, Buffer.from(tx.serialize()).toString('base64')).transactionId.length,
    ).toBeGreaterThan(63);
    tx.message.recentBlockhash = Keypair.fromSeed(new Uint8Array(32).fill(6)).publicKey.toBase58();
    tx.sign([wallet]);
    expect(() => solana.verifySigned(s, Buffer.from(tx.serialize()).toString('base64'))).toThrow(
      /changed/,
    );
  });
  it('dispatches a durably signed Solana transaction at most once, including racing requests', async () => {
    const j = journal(),
      s = j.createStep(
        step(null, {
          network: BRIDGE_SOLANA,
          wallet: config.solanaWallet,
          ethereum: null,
          maxNetworkCost: '20000000',
          solana: {
            serialized: 'payload',
            message: 'message',
            version: 0,
            lastValidBlockHeight: 30,
            contextSlot: 20,
          },
        }),
      );
    j.reserveStep(s.id);
    j.signedStep(s.id, 'signature', 'payload');
    const solana = new BridgeSolana();
    vi.spyOn(solana, 'verifySigned').mockReturnValue({
      serialized: 'payload',
      transactionId: 'signature',
    });
    vi.spyOn(solana, 'simulate').mockResolvedValue(undefined);
    const service = new LocalBridgeService(j, new BridgeEthereum(), solana);
    const results = await Promise.allSettled([
      service.dispatchSolana(s.id),
      service.dispatchSolana(s.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(j.step(s.id).state).toBe('SUBMITTED');
  });
  it('does not accept Circle readiness, an unknown hash, or a missing receipt as completion', async () => {
    const j = journal(),
      b = bridge();
    j.createBridge(b);
    const s = j.createStep(step(b));
    j.reserveStep(s.id);
    const eth = new BridgeEthereum();
    vi.spyOn(eth, 'receipt').mockResolvedValue({
      state: 'SUBMITTED',
      matched: false,
      receipt: null,
      contractAddress: null,
    });
    const service = new LocalBridgeService(j, eth);
    await expect(service.attestation(b.id)).resolves.toMatchObject({ status: 'SOURCE_PENDING' });
    await expect(service.submitted(s.id, `0x${'a'.repeat(64)}`)).rejects.toThrow(/not found/);
    expect(j.step(s.id).transactionId).toBeNull();
    expect(j.bridge(b.id).status).toBe('SOURCE_PENDING');
  });
  it('pins deployed router code outside compiler-reported immutable words', () => {
    const artifact = {
      abi: [],
      bytecode: '0x60' as const,
      deployedBytecode: `0x60${'00'.repeat(32)}61` as const,
      immutableReferences: { 1: [{ start: 1, length: 32 }] },
    };
    expect(() => compareRouterCode(`0x60${'11'.repeat(32)}61`, artifact)).not.toThrow();
    expect(() => compareRouterCode(`0x60${'11'.repeat(32)}62`, artifact)).toThrow(/bytecode/);
  });
});
