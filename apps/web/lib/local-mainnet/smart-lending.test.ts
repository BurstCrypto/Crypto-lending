// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { decodeFunctionData } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as circle from '../../../../onchain/src/circle-client';
import { KAMINO_USDC_RESERVE } from '../../../../onchain/src/destination-lending';
import { SOLANA_USDC } from '../../../../onchain/src/source-plan';
import { POST } from '../../app/api/local-mainnet/route';
import { BridgeJournal } from '../mainnet/bridge-journal.server';
import { LocalBridgeService } from '../mainnet/bridge-service.server';
import {
  BRIDGE_ETHEREUM as ETH,
  BRIDGE_SOLANA as SOL,
  type LocalWalletConfig,
} from '../mainnet/bridge-types';
import {
  aaveApyBasisPoints,
  parseKaminoRates,
  type LendingRate,
} from '../mainnet/lending-rates.server';
import * as runtime from './runtime.server';
import { readLocalWalletConfig, writeLocalWalletConfig } from './bridge-config.server';
import { MAINNET_TEST as P, TOKEN_ABI } from '../mainnet/policy';
import { LENDING_ROUTER_ABI } from '../lending/ethereum-router';
import { validateReviewedStep } from '../mainnet/bridge-client';

const solWallet = Keypair.fromSeed(new Uint8Array(32).fill(31)).publicKey.toBase58();
const config: LocalWalletConfig = {
  ethereumWallet: '0x1111111111111111111111111111111111111111',
  solanaWallet: solWallet,
  ethereumTreasury: '0x2222222222222222222222222222222222222222',
  solanaTreasury: Keypair.fromSeed(new Uint8Array(32).fill(32)).publicKey.toBase58(),
  ethereumSourceRouter: '0x3333333333333333333333333333333333333333',
  ethereumSupplyRouter: '0x4444444444444444444444444444444444444444',
  ethereumLendingRouter: '0x5555555555555555555555555555555555555555',
  solanaLookupTables: [],
};
const cap = 'a'.repeat(64),
  USD = 10n ** 18n;
const input = (sourceNetwork: LendingRate['network'] = SOL, changes = {}) => ({
  sourceNetwork,
  amount: '100',
  holdingDays: 365,
  includeCrossChain: false,
  ...changes,
});
const rate = (provider: 'aave' | 'kamino', apy = '400'): LendingRate => ({
  provider,
  network: provider === 'aave' ? ETH : SOL,
  name: provider === 'aave' ? 'Aave V3' : 'Kamino',
  apyBasisPoints: apy,
  observedAt: Date.now(),
  source: 'https://example.com/market',
  evidence: 'test-only',
  usdcPriceUsd: USD.toString(),
  nativePriceUsd: ((provider === 'aave' ? 3000n : 100n) * USD).toString(),
  maxFeePerGas: '1000000000',
  capacityAtomic: null,
  available: true,
});
let journal: BridgeJournal, service: LocalBridgeService, path: string;
function save(selected = config) {
  writeFileSync(path, JSON.stringify(selected));
  return selected;
}
function request(operation: string, fields: Record<string, unknown>, token = cap) {
  return new Request(`${P.origin}/api/local-mainnet`, {
    method: 'POST',
    headers: {
      host: '127.0.0.1:3000',
      origin: P.origin,
      'content-type': 'application/json',
      'x-local-mainnet-setup': token,
    },
    body: JSON.stringify({ operation, ...fields }),
  });
}
beforeEach(() => {
  path = join(tmpdir(), `bonsai-smart-${randomUUID()}.json`);
  save();
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('LOCAL_MAINNET_TEST_MODE', 'enabled');
  vi.stubEnv('LOCAL_MAINNET_TEST_LAUNCH_TOKEN', cap);
  vi.stubEnv('LOCAL_MAINNET_TEST_CONFIG', path);
  vi.stubEnv('DEPLOYMENT_TARGET', undefined);
  vi.stubEnv('LOCAL_DEMO_MODE', 'disabled');
  journal = new BridgeJournal(':memory:');
  service = new LocalBridgeService(journal, undefined, undefined, {
    read: readLocalWalletConfig,
    write: writeLocalWalletConfig,
  });
  vi.spyOn(runtime, 'localMainnetService').mockReturnValue(service);
  vi.spyOn(service.lending.additional.ethereumMarkets, 'read').mockRejectedValue(
    new Error('Market unavailable in this fixture.'),
  );
  vi.spyOn(service.lending.additional.solanaMarkets, 'read').mockRejectedValue(
    new Error('Market unavailable in this fixture.'),
  );
  vi.spyOn(service.smartLending.rates, 'aave').mockImplementation(async () => rate('aave'));
  vi.spyOn(service.smartLending.rates, 'kamino').mockImplementation(async () => rate('kamino'));
  vi.spyOn(service.ethereum.rpc, 'inspect').mockResolvedValue({
    snapshot: {
      wallet: config.ethereumWallet!,
      blockNumber: '100',
      blockHash: `0x${'aa'.repeat(32)}`,
      observedAt: Date.now(),
      usdc: '100000000000',
      supplied: '0',
      allowance: '100000000',
      eth: '1000000000000000000',
      totalDebt: '0',
    },
    active: true,
    frozen: false,
    paused: false,
    head: { number: '0x64', hash: `0x${'aa'.repeat(32)}`, baseFee: 1n },
    nonce: '0x0',
  });
  vi.spyOn(service.solana, 'inspect').mockResolvedValue({
    supplied: '0',
    receiptExchangeRate: '1200000000000000000',
    slot: 100,
    usdc: '100000000000',
    collateral: '0',
    lamports: '7880734',
    circleFeeRecipient: config.solanaTreasury,
    minimumFeeBps: 0,
  });
  vi.spyOn(service.solana, 'routingFeeAccount').mockResolvedValue({ balance: 0n, rent: 0n });
  vi.spyOn(service.ethereum, 'validateLendingRouter').mockResolvedValue(undefined);
  vi.spyOn(service.ethereum, 'allowance').mockResolvedValue(100_100_000n);
  vi.spyOn(service.solana, 'lendingCost').mockResolvedValue(2_044_280n);
  vi.spyOn(service.solana, 'blockhash').mockResolvedValue({
    blockhash: solWallet,
    lastValidBlockHeight: 1000,
    contextSlot: 100,
  });
  vi.spyOn(service.solana, 'simulate').mockResolvedValue({
    usdc: '99899900000',
    collateral: '83000000',
  });
  vi.spyOn(service.ethereum, 'validateRouter').mockResolvedValue(undefined);
  vi.spyOn(circle, 'getCircleStandardFee').mockResolvedValue(0n);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  journal.close();
  unlinkSync(path);
});

describe('live smart lending comparison and wallet handoff', () => {
  it('prepares and validates an Ethereum-only deposit above 1 USDC to the exact selected wallet', async () => {
    const selected = save({ ...config, solanaWallet: null });
    vi.spyOn(service.ethereum, 'prepare').mockImplementation(async (call) => ({
      transaction: {
        ...call,
        value: '0x0',
        chainId: '0x1',
        type: '0x2',
        nonce: '0x0',
        gas: '0x186a0',
        maxFeePerGas: '0x3b9aca00',
        maxPriorityFeePerGas: '0x1',
      },
      cost: '100000000000000',
      snapshot: (await service.ethereum.rpc.inspect(config.ethereumWallet!)).snapshot,
    }));
    const quote = await service.smartLending.compare(selected, input(ETH));
    const result = await service.smartLending.prepare(selected, quote.id);
    expect(result.step).toMatchObject({
      state: 'PREPARED',
      kind: 'LENDING_SUPPLY',
      sourcePrincipal: '100000000',
    });
    expect(
      decodeFunctionData({ abi: LENDING_ROUTER_ABI, data: result.step!.ethereum!.data }),
    ).toMatchObject({ functionName: 'supply', args: [0, 100_000_000n] });
    await expect(validateReviewedStep(result.step!, selected)).resolves.toBeUndefined();
    expect(service.solana.inspect).not.toHaveBeenCalled();
  });
  it('continues a finalized exact Aave approval through a fresh recommendation and deposit review', async () => {
    const inspected = await service.ethereum.rpc.inspect(config.ethereumWallet!);
    vi.mocked(service.ethereum.rpc.inspect).mockResolvedValue({
      ...inspected,
      snapshot: { ...inspected.snapshot, allowance: '0' },
    });
    vi.spyOn(service.ethereum, 'prepare').mockImplementation(async (call) => ({
      transaction: {
        ...call,
        value: '0x0',
        chainId: '0x1',
        type: '0x2',
        nonce: '0x0',
        gas: '0x186a0',
        maxFeePerGas: '0x3b9aca00',
        maxPriorityFeePerGas: '0x1',
      },
      cost: '100000000000000',
      snapshot: inspected.snapshot,
    }));
    vi.mocked(service.ethereum.allowance).mockResolvedValue(0n);
    const quote = await service.smartLending.compare(config, input(ETH));
    const first = await service.smartLending.prepare(config, quote.id);
    expect(first.step!.kind).toBe('LENDING_APPROVAL');
    expect(decodeFunctionData({ abi: TOKEN_ABI, data: first.step!.ethereum!.data })).toMatchObject({
      functionName: 'approve',
      args: [expect.any(String), 100_100_000n],
    });
    journal.changeStep(first.step!.id, ['PREPARED'], { state: 'FINALIZED' });
    vi.mocked(service.ethereum.rpc.inspect).mockResolvedValue(inspected);
    vi.mocked(service.ethereum.allowance).mockResolvedValue(100_100_000n);
    const response = await POST(request('smart-lending-continue', { id: first.step!.id }));
    expect(response.status).toBe(200);
    const next = await response.json();
    expect(next.step).toMatchObject({
      kind: 'LENDING_SUPPLY',
      state: 'PREPARED',
      evidence: { smartQuoteId: next.quote.id, amount: '100000000' },
    });
    expect(next.quote.id).not.toBe(first.quote.id);
  });
  it('compares with one Solana wallet, creates no transaction, then prepares a deposit above 1 USDC without a message login', async () => {
    const selected = save({ ...config, ethereumWallet: null });
    const response = await POST(request('smart-lending-compare', { input: input() }));
    expect(response.status).toBe(200);
    expect(response.headers.has('set-cookie')).toBe(false);
    const quote = await response.json();
    expect(quote.selectedId).toBe('kamino');
    expect(quote.routes.find((row: { id: string }) => row.id === 'kamino')!.fundingReasons).toEqual(
      [],
    );
    expect(journal.steps()).toEqual([]);
    expect(service.ethereum.rpc.inspect).not.toHaveBeenCalled();
    const prepared = await POST(request('smart-lending-prepare', { id: quote.id }));
    expect(prepared.status).toBe(200);
    const body = await prepared.json();
    expect(body.step).toMatchObject({
      state: 'PREPARED',
      kind: 'LENDING_SUPPLY',
      wallet: selected.solanaWallet,
      sourcePrincipal: '100000000',
      maxNetworkCost: '2044280',
      evidence: { smartQuoteId: body.quote.id, amount: '100000000' },
    });
    expect(journal.bridges()).toEqual([]);
  });
  it('keeps a lower-APY same-chain route when bridge and exit costs consume the improvement', async () => {
    vi.mocked(service.smartLending.rates.kamino).mockResolvedValue(rate('kamino', '500'));
    const quote = await service.smartLending.compare(
      config,
      input(ETH, { includeCrossChain: true }),
    );
    expect(quote.selectedId).toBe('aave');
    expect(
      quote.routes.find((row: { id: string }) => row.id === 'kamino')!.reasons.join(' '),
    ).toMatch(/earnings do not cover|improve/);
    expect(circle.getCircleStandardFee).toHaveBeenCalledTimes(2);
    expect(journal.steps()).toEqual([]);
    expect(journal.bridges()).toEqual([]);
  });
  it('selects and hands off a profitable cross-chain route to the existing bridge journal', async () => {
    vi.mocked(service.smartLending.rates.kamino).mockResolvedValue(rate('kamino', '2000'));
    const sol = await service.solana.inspect({
      solanaWallet: solWallet,
      solanaTreasury: config.solanaTreasury,
    });
    vi.mocked(service.solana.inspect).mockResolvedValue({ ...sol, lamports: '1000000000' });
    const quote = await service.smartLending.compare(
      config,
      input(ETH, { amount: '10000', includeCrossChain: true }),
    );
    expect(quote.selectedId).toBe('kamino');
    const result = await service.smartLending.prepare(config, quote.id);
    expect(result.step).toBeNull();
    expect(result.bridge).toMatchObject({
      status: 'CREATED',
      smartQuoteId: result.quote.id,
      plan: { sourceNetwork: ETH, destinationNetwork: SOL, principal: '10000000000' },
    });
    expect(journal.steps()).toEqual([]); // No spending review or wallet request on comparison/route creation.
  });
  it('requires cross-chain opt-in and verified deployments, and never routes into an unconnected market', async () => {
    vi.mocked(service.smartLending.rates.kamino).mockResolvedValue(rate('kamino', '2000'));
    const noConsent = await service.smartLending.compare(config, input(ETH, { amount: '10000' }));
    expect(noConsent.selectedId).toBe('aave');
    expect(service.ethereum.validateRouter).not.toHaveBeenCalled();
    const noRouter = await service.smartLending.compare(
      { ...config, ethereumSourceRouter: null },
      input(ETH, { amount: '10000', includeCrossChain: true }),
    );
    expect(noRouter.routes.find((row) => row.id === 'kamino')!.reasons.join(' ')).toMatch(
      /router setup/,
    );
    expect(noRouter.selectedId).toBe('aave');
  });
  it('rejects a stale rate and a quote reused with changed wallets, amount fields, or expiry', async () => {
    vi.mocked(service.smartLending.rates.kamino).mockResolvedValue({
      ...rate('kamino'),
      observedAt: Date.now() - 121_000,
    });
    const stale = await service.smartLending.compare(config, input());
    expect(stale.selectedId).toBeNull();
    vi.mocked(service.smartLending.rates.kamino).mockResolvedValue(rate('kamino'));
    const quote = await service.smartLending.compare(config, input());
    await expect(
      service.smartLending.prepare({ ...config, ethereumWallet: null }, quote.id),
    ).rejects.toThrow(/wallets/);
    expect(
      (await POST(request('smart-lending-prepare', { id: quote.id, amount: '1000' }))).status,
    ).toBe(400);
    vi.spyOn(Date, 'now').mockReturnValue(quote.expiresAt);
    await expect(service.smartLending.prepare(config, quote.id)).rejects.toThrow(/expired/);
    expect(journal.steps()).toEqual([]);
  });
  it('rechecks the selected route before preparation and again before a wallet reservation', async () => {
    const quote = await service.smartLending.compare(config, input());
    const result = await service.smartLending.prepare(config, quote.id);
    vi.mocked(service.smartLending.rates.kamino).mockResolvedValue({
      ...rate('kamino'),
      available: false,
    });
    await expect(service.reserve(result.step!.id)).rejects.toThrow(/changed/);
    expect(journal.step(result.step!.id).state).toBe('PREPARED');
  });
  it('excludes unfunded routes from executable recommendations', async () => {
    const sol = await service.solana.inspect({
      solanaWallet: solWallet,
      solanaTreasury: config.solanaTreasury,
    });
    vi.mocked(service.solana.inspect).mockResolvedValue({ ...sol, usdc: '1100' });
    const quote = await service.smartLending.compare(config, input());
    expect(quote.selectedId).toBe(null);
    expect(
      quote.routes.find((row: { id: string }) => row.id === 'kamino')!.fundingReasons.join(' '),
    ).toMatch(/more USDC/);
    await expect(service.smartLending.prepare(config, quote.id)).rejects.toThrow(
      /No route is recommended/,
    );
    expect(journal.steps()).toEqual([]);
  });
  it('fails closed on unavailable source data, foreign origins, production, and absent local capabilities', async () => {
    vi.mocked(service.smartLending.rates.kamino).mockRejectedValue(new Error('Kamino unavailable'));
    const quote = await service.smartLending.compare(config, input());
    expect(quote.selectedId).toBeNull();
    expect((await POST(request('smart-lending-compare', { input: input() }, ''))).status).toBe(401);
    const foreign = request('smart-lending-compare', { input: input() });
    foreign.headers.set('origin', 'https://hqbonsai.com');
    expect((await POST(foreign)).status).toBe(404);
    vi.stubEnv('NODE_ENV', 'production');
    expect((await POST(request('smart-lending-compare', { input: input() }))).status).toBe(404);
    expect(journal.steps()).toEqual([]);
  });
});

describe('provider rate normalization', () => {
  it('converts Aave ray APR into compounded APY and rejects invalid rates', () => {
    expect(aaveApyBasisPoints(5n * 10n ** 25n)).toBe(512n);
    expect(() => aaveApyBasisPoints(-1n)).toThrow();
  });
  it('reads only the exact Kamino USDC reserve, not a same-symbol substitute or duplicate', () => {
    const metrics = [
      {
        reserve: KAMINO_USDC_RESERVE.toBase58(),
        liquidityTokenMint: SOLANA_USDC.toBase58(),
        liquidityToken: 'USDC',
        supplyApy: '0.041234',
        totalSupply: '100000',
        totalSupplyUsd: '100000',
      },
      {
        reserve: 'test-sol',
        liquidityTokenMint: 'So11111111111111111111111111111111111111112',
        liquidityToken: 'SOL',
        totalSupply: '100',
        totalSupplyUsd: '15000',
      },
    ];
    expect(parseKaminoRates(metrics, Date.now())).toMatchObject({
      apyBasisPoints: '412',
      usdcPriceUsd: USD.toString(),
      nativePriceUsd: (150n * USD).toString(),
      capacityAtomic: null,
    });
    expect(() => parseKaminoRates([metrics[0], ...metrics], Date.now())).toThrow(/duplicated/);
    expect(() =>
      parseKaminoRates(
        [{ ...metrics[0], liquidityTokenMint: 'fake-usdc' }, metrics[1]],
        Date.now(),
      ),
    ).toThrow(/missing/);
  });
});
