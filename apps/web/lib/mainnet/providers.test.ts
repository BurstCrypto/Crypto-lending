// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { decodeFunctionData, encodeFunctionData, parseAbi } from 'viem';
import { BridgeJournal, fingerprint } from './bridge-journal.server';
import { LocalBridgeService } from './bridge-service.server';
import { validateReviewedStep } from './bridge-client';
import { ETHEREUM, SOLANA, LENDING_PROVIDERS, MARKETS } from '../lending/markets';
import { MAINNET_TREASURIES } from './public-config';
import type { LocalWalletConfig } from './bridge-types';
import * as circleClient from '../../../../onchain/src/circle-client';
import { createSourceBridgePlan } from '../../../../onchain/src/source-plan';

const config: LocalWalletConfig = {
  ...MAINNET_TREASURIES,
  ethereumTreasury: MAINNET_TREASURIES.ethereumTreasury as `0x${string}`,
  ethereumWallet: '0x1111111111111111111111111111111111111111',
  solanaWallet: '97J9FkrUn3LazMwU9GKKfQQCCKbbZDLGVRHqKxfadWQp',
  ethereumSourceRouter: null,
  ethereumSupplyRouter: null,
  ethereumLendingRouter: '0x5555555555555555555555555555555555555555',
  solanaLookupTables: [],
};
let journal: BridgeJournal, service: LocalBridgeService;
beforeEach(() => {
  journal = new BridgeJournal(':memory:');
  service = new LocalBridgeService(journal, undefined, undefined, {
    read: () => config,
    write: vi.fn(),
  });
  for (const provider of ['aave', 'kamino'] as const)
    vi.spyOn(service.smartLending.rates, provider).mockImplementation(async () => ({
      provider,
      network: MARKETS[provider].network,
      name: MARKETS[provider].name,
      apyBasisPoints: '400',
      observedAt: Date.now(),
      source: MARKETS[provider].source,
      evidence: 'fixture',
      usdcPriceUsd: '1000000000000000000',
      nativePriceUsd: provider === 'aave' ? '3000000000000000000000' : '100000000000000000000',
      maxFeePerGas: '1000000000',
      capacityAtomic: null,
      available: true,
    }));
  vi.spyOn(service.ethereum.rpc, 'inspect').mockResolvedValue({
    snapshot: {
      usdc: '100000000000',
      eth: '1000000000000000000',
      totalDebt: '0',
      allowance: '100000000',
      supplied: '0',
    },
    active: true,
    frozen: false,
    paused: false,
  } as never);
  vi.spyOn(service.solana, 'inspect').mockResolvedValue({
    supplied: '0',
    receiptExchangeRate: '1200000000000000000',
    usdc: '100000000000',
    lamports: '7880734',
    collateral: '0',
    slot: 100,
    circleFeeRecipient: config.solanaTreasury,
    minimumFeeBps: 0,
  });
  vi.spyOn(service.ethereum, 'validateLendingRouter').mockResolvedValue(undefined);
  vi.spyOn(service.ethereum, 'allowance').mockResolvedValue(100_100_000n);
  vi.spyOn(service.solana, 'lendingCost').mockResolvedValue(1_493_440n);
  vi.spyOn(service.solana, 'routingFeeAccount').mockResolvedValue({ balance: 0n, rent: 0n });
  vi.spyOn(service.lending.additional.ethereumMarkets, 'read').mockImplementation(
    async (provider) => ({
      provider,
      observedAt: Date.now(),
      apyBasisPoints: provider === 'euler' ? '700' : provider === 'morpho' ? '600' : '300',
      capacity: null,
      available: true,
      withdrawalFeeBps: 0n,
      shares: 0n,
      supplied: 0n,
      debt: 0n,
      allowance: 100_000_000n,
      walletUsdc: 100_000_000_000n,
      liquidity: 100_000_000_000n,
      binding: 'fixture-binding',
    }),
  );
  vi.spyOn(service.lending.additional.solanaMarkets, 'read').mockImplementation(
    async (provider) => ({
      provider,
      observedAt: Date.now(),
      slot: 100,
      apyBasisPoints: provider === 'project-0' ? '1400' : provider === 'jupiter' ? '900' : '300',
      capacity: null,
      available: true,
      walletUsdc: 100_000_000_000n,
      nativeBalance: 7_880_734n,
      shares: 0n,
      supplied: 0n,
      positionAddress: PublicKey.default,
      receiptMint: null,
      createPosition: true,
      rentBytes: 165,
      binding: 'fixture-binding',
    }),
  );
  vi.spyOn(service.lending.additional.solanaMarkets, 'depositCost').mockImplementation(
    async (state) => (state.provider === 'project-0' ? 12_400_200n : 1_493_440n),
  );
});
afterEach(() => {
  journal.close();
  vi.restoreAllMocks();
});
const input = (sourceNetwork: typeof ETHEREUM | typeof SOLANA) => ({
  sourceNetwork,
  amount: '100',
  holdingDays: 365,
  includeCrossChain: false,
});

it('returns the converted Kamino USDC balance separately from the receipt-token quantity', async () => {
  const checked = await service.solana.inspect({
    solanaWallet: config.solanaWallet!,
    solanaTreasury: config.solanaTreasury,
  });
  vi.mocked(service.solana.inspect).mockResolvedValue({
    ...checked,
    collateral: '8321724',
    supplied: '10000037',
    receiptExchangeRate: '1201680000000000000',
  });
  const markets = await service.smartLending.markets(config);
  expect(markets.find((market) => market.id === 'kamino')).toMatchObject({
    supplied: '10000037',
    shares: '8321724',
    receiptExchangeRate: '1201680000000000000',
    error: null,
  });
  service.smartLending.invalidateMarketData();
  vi.mocked(service.solana.inspect).mockResolvedValue({
    ...checked,
    collateral: '8321724',
    supplied: null,
    receiptExchangeRate: null,
  });
  const missing = await service.smartLending.markets(config);
  expect(missing.find((market) => market.id === 'kamino')).toMatchObject({
    supplied: null,
    shares: '8321724',
    receiptExchangeRate: null,
  });
});

it('reuses recent market views for display and typing, but refreshes before execution and after invalidation', async () => {
  await service.smartLending.markets(config);
  await service.smartLending.markets(config);
  await service.smartLending.compare(config, input(SOLANA), false);
  expect(service.solana.inspect).toHaveBeenCalledTimes(1);
  await service.smartLending.compare(config, input(SOLANA));
  expect(service.solana.inspect).toHaveBeenCalledTimes(2);
  service.smartLending.invalidateMarketData();
  await service.smartLending.markets(config);
  expect(service.solana.inspect).toHaveBeenCalledTimes(3);
});

it('expires cached market data and isolates the cache by wallet configuration', async () => {
  const now = Date.now(),
    clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  await service.smartLending.markets(config);
  clock.mockReturnValue(now + 30_001);
  await service.smartLending.markets(config);
  expect(service.solana.inspect).toHaveBeenCalledTimes(2);
  await service.smartLending.markets({ ...config, ethereumWallet: null });
  expect(service.solana.inspect).toHaveBeenCalledTimes(3);
});

it('starts independent provider reads while wallet checks run and shares concurrent requests', async () => {
  const balance = await service.solana.inspect({
    solanaWallet: config.solanaWallet!,
    solanaTreasury: config.solanaTreasury,
  });
  vi.mocked(service.solana.inspect).mockClear();
  let finish!: (value: typeof balance) => void;
  vi.mocked(service.solana.inspect).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const first = service.smartLending.markets(config),
    second = service.smartLending.markets(config);
  expect(service.lending.additional.solanaMarkets.read).toHaveBeenCalledTimes(3);
  expect(service.lending.additional.ethereumMarkets.read).toHaveBeenCalledTimes(5);
  finish(balance);
  expect(await first).toEqual(await second);
  expect(service.solana.inspect).toHaveBeenCalledTimes(1);
});

it('compares all ten providers, keeps missing data visible, and selects the best fundable same-chain route', async () => {
  const solana = await service.smartLending.compare(
    { ...config, ethereumWallet: null },
    input(SOLANA),
  );
  expect(solana.routes.map((row) => row.id)).toEqual([...LENDING_PROVIDERS]);
  expect(solana.selectedId).toBe('jupiter');
  expect(solana.routes.find((row) => row.id === 'project-0')?.fundingReasons.join(' ')).toMatch(
    /more SOL/,
  );
  expect(
    solana.routes
      .filter((row) => row.network === ETHEREUM)
      .every((row) => row.reasons.includes('Cross-chain routing is off.')),
  ).toBe(true);
  vi.mocked(service.lending.additional.solanaMarkets.read).mockRejectedValue(
    new Error('Provider RPC unavailable'),
  );
  const unavailable = await service.smartLending.compare(
    { ...config, ethereumWallet: null },
    input(SOLANA),
  );
  expect(unavailable.routes).toHaveLength(10);
  expect(unavailable.selectedId).toBe('kamino');
  expect(unavailable.routes.find((row) => row.id === 'jupiter')).toMatchObject({
    apyBasisPoints: null,
    reasons: ['Provider RPC unavailable'],
  });
  expect(journal.steps()).toEqual([]);
  expect(journal.bridges()).toEqual([]);
});

it('hands the selected Ethereum provider to its real transaction builder and rejects a changed recipient', async () => {
  const quote = await service.smartLending.compare(config, input(ETHEREUM));
  expect(quote.selectedId).toBe('euler');
  vi.spyOn(service.ethereum, 'call').mockResolvedValue(
    `0x${100_000_000n.toString(16).padStart(64, '0')}`,
  );
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
  const { step } = await service.smartLending.prepare(config, quote.id);
  expect(step).toMatchObject({
    kind: 'LENDING_SUPPLY',
    evidence: { provider: 'euler', marketTarget: MARKETS.euler.target, amount: '100000000' },
    ethereum: { to: config.ethereumLendingRouter },
  });
  const abi = parseAbi(['function deposit(uint256 assets,address receiver) returns(uint256)']);
  expect(
    decodeFunctionData({
      abi: parseAbi(['function supply(uint8,uint256)']),
      data: step!.ethereum!.data,
    }).args,
  ).toEqual([4, 100_000_000n]);
  await expect(validateReviewedStep(step!, config)).resolves.toBeUndefined();
  const altered = {
    ...step!,
    ethereum: {
      ...step!.ethereum!,
      data: encodeFunctionData({
        abi,
        functionName: 'deposit',
        args: [100_000_000n, MAINNET_TREASURIES.ethereumTreasury as `0x${string}`],
      }),
    },
  };
  altered.fingerprint = fingerprint({
    ethereum: altered.ethereum,
    solana: altered.solana,
    evidence: altered.evidence,
  });
  await expect(validateReviewedStep(altered, config)).rejects.toThrow(/does not match/);
});

it.each([ETHEREUM, SOLANA])(
  'keeps bridge routes ineligible without the destination wallet when opted in from %s',
  async (network) => {
    const singleWallet = {
      ...config,
      ethereumWallet: network === ETHEREUM ? config.ethereumWallet : null,
      solanaWallet: network === SOLANA ? config.solanaWallet : null,
    };
    const quote = await service.smartLending.compare(singleWallet, {
      ...input(network),
      includeCrossChain: true,
    });
    expect(quote.input.includeCrossChain).toBe(true);
    expect(quote.routes.find((route) => route.id === quote.selectedId)?.network).toBe(network);
    const bridges = quote.routes.filter((route) => route.routeKind === 'CROSS_CHAIN');
    expect(bridges.length).toBeGreaterThan(0);
    expect(
      bridges.every((route) => route.reasons.includes('Connect both wallets to use this route.')),
    ).toBe(true);
    expect(bridges.every((route) => route.netBenefitUsd === null)).toBe(true);
    expect(journal.steps()).toEqual([]);
    expect(journal.bridges()).toEqual([]);
  },
);

it.each(
  [ETHEREUM, SOLANA].flatMap((network) =>
    ['1', '2', '10', '10000'].map((amount) => ({ network, amount })),
  ),
)(
  'selects a funded $amount USDC deposit on $network without requiring positive net earnings',
  async ({ network, amount }) => {
    const singleWallet = {
      ...config,
      ethereumWallet: network === ETHEREUM ? config.ethereumWallet : null,
      solanaWallet: network === SOLANA ? config.solanaWallet : null,
    };
    const quote = await service.smartLending.compare(singleWallet, {
      ...input(network),
      amount,
      holdingDays: 7,
    });
    const selected = quote.routes.find((route) => route.id === quote.selectedId);
    expect(selected).toBeDefined();
    expect(selected?.network).toBe(network);
    expect(selected?.reasons).toEqual([]);
    expect(selected?.fundingReasons).toEqual([]);
    expect(quote.unavailableReason).toBeNull();
    if (Number(amount) <= 10) expect(BigInt(selected!.netBenefitUsd!)).toBeLessThan(0n);
    if (network === ETHEREUM && amount === '1')
      expect(BigInt(selected!.entryCostUsd!) + BigInt(selected!.exitCostUsd!)).toBeGreaterThan(
        10n ** 18n,
      );
    expect(journal.steps()).toEqual([]);
    expect(journal.bridges()).toEqual([]);
  },
);

it('can review and revalidate a negative-return plan using its automatically selected provider', async () => {
  const singleWallet = { ...config, ethereumWallet: null };
  const quote = await service.smartLending.compare(singleWallet, {
    ...input(SOLANA),
    amount: '1',
    holdingDays: 7,
  });
  const selected = quote.routes.find((route) => route.id === quote.selectedId)!;
  expect(BigInt(selected.netBenefitUsd!)).toBeLessThan(0n);
  const prepare = vi
    .spyOn(service.lending, 'prepare')
    .mockResolvedValue({ kind: 'LENDING_SUPPLY' } as never);
  await expect(service.smartLending.prepare(singleWallet, quote.id)).resolves.toMatchObject({
    bridge: null,
    step: { kind: 'LENDING_SUPPLY' },
  });
  expect(prepare).toHaveBeenCalledWith(
    singleWallet,
    SOLANA,
    'supply',
    '1',
    expect.objectContaining({ smartHoldingDays: '7' }),
    selected.id,
  );
  await expect(service.smartLending.assertCurrent(singleWallet, quote.id)).resolves.toBeUndefined();
});

it.each(['USDC', 'SOL'])(
  'still blocks a deposit without enough %s and explains the missing funding',
  async (asset) => {
    vi.mocked(service.solana.inspect).mockResolvedValue({
      supplied: '0',
      receiptExchangeRate: '1200000000000000000',
      usdc: asset === 'USDC' ? '0' : '100000000000',
      lamports: asset === 'SOL' ? '0' : '100000000',
      collateral: '0',
      slot: 100,
      circleFeeRecipient: config.solanaTreasury,
      minimumFeeBps: 0,
    });
    const quote = await service.smartLending.compare(
      { ...config, ethereumWallet: null },
      { ...input(SOLANA), amount: '1', holdingDays: 7 },
    );
    expect(quote.selectedId).toBeNull();
    expect(quote.unavailableReason).toContain(asset === 'USDC' ? 'enough USDC' : 'more SOL');
    await expect(
      service.smartLending.prepare({ ...config, ethereumWallet: null }, quote.id),
    ).rejects.toThrow(/No route/);
    expect(journal.steps()).toEqual([]);
    expect(journal.bridges()).toEqual([]);
  },
);

it('still blocks deposits above the available market capacity', async () => {
  const rate = vi.mocked(service.smartLending.rates.kamino).getMockImplementation()!;
  vi.mocked(service.smartLending.rates.kamino).mockImplementation(async () => ({
    ...(await rate()),
    capacityAtomic: '0',
  }));
  const read = vi.mocked(service.lending.additional.solanaMarkets.read).getMockImplementation()!;
  vi.mocked(service.lending.additional.solanaMarkets.read).mockImplementation(async (...args) => ({
    ...(await read(...args)),
    capacity: 0n,
  }));
  const quote = await service.smartLending.compare(
    { ...config, ethereumWallet: null },
    { ...input(SOLANA), amount: '1', holdingDays: 7 },
  );
  expect(quote.selectedId).toBeNull();
  expect(quote.unavailableReason).toContain('deposit capacity');
  expect(journal.steps()).toEqual([]);
  expect(journal.bridges()).toEqual([]);
});

it('does not invent a plan when live reads fail', async () => {
  vi.mocked(service.smartLending.rates.kamino).mockRejectedValue(
    new Error('Rate endpoint unavailable'),
  );
  const quote = await service.smartLending.compare(
    { ...config, ethereumWallet: null },
    { ...input(SOLANA), amount: '1', holdingDays: 7 },
  );
  expect(quote.selectedId).toBeNull();
  expect(quote.unavailableReason).toContain('checks could not be completed');
  expect(journal.steps()).toEqual([]);
  expect(journal.bridges()).toEqual([]);
});

it('quotes 0.10% on top of same-network principal with no withdrawal routing fee', async () => {
  const quote = await service.smartLending.compare(
    { ...config, ethereumWallet: null },
    { ...input(SOLANA), amount: '1' },
  );
  expect(quote.routes.find((route) => route.id === quote.selectedId)?.routingFee).toEqual({
    basisPoints: 10,
    depositUsdc: '1000',
    estimatedReturnUsdc: '0',
    totalSourceDebitUsdc: '1001000',
  });
});

it.each([
  ['1', 1_000_000n],
  ['1.00025', 1_000_250n],
  ['1.00075', 1_000_750n],
])(
  'matches source transaction rounding and separates deposit and return routing fees for %s USDC',
  async (amount, principal) => {
    vi.spyOn(circleClient, 'getCircleStandardFee').mockResolvedValue(0n);
    vi.spyOn(service.ethereum, 'validateRouter').mockResolvedValue(undefined);
    const quote = await service.smartLending.compare(
      {
        ...config,
        ethereumSourceRouter: '0x4444444444444444444444444444444444444444',
        ethereumSupplyRouter: '0x5555555555555555555555555555555555555555',
      },
      { ...input(SOLANA), amount, includeCrossChain: true },
    );
    const route = quote.routes.find((row) => row.id === 'aave')!;
    const plan = createSourceBridgePlan({
      sourceNetwork: SOLANA,
      sourceWallet: config.solanaWallet!,
      destinationWallet: config.ethereumWallet!,
      principal,
      maxBridgeFee: 0n,
      minimumDestinationAmount: principal,
      nowSeconds: 1n,
      deadline: 100n,
      treasuries: { ethereum: config.ethereumTreasury, solana: config.solanaTreasury },
    });
    expect(route.routingFee).toEqual({
      basisPoints: 20,
      depositUsdc: plan.platformFee.toString(),
      estimatedReturnUsdc: plan.platformFee.toString(),
      totalSourceDebitUsdc: plan.totalSourceDebit.toString(),
    });
    const feeUsd = plan.platformFee * 10n ** 12n;
    expect(BigInt(route.entryCostUsd!)).toBe(30n * 10n ** 18n + feeUsd);
    expect(BigInt(route.exitCostUsd!)).toBe(32n * 10n ** 18n + feeUsd);
  },
);

it('does not silently switch an additional provider to Aave or Kamino after funds are bridged', async () => {
  const bridge = {
    id: `0x${'11'.repeat(32)}` as const,
    config: {
      ...config,
      ethereumWallet: config.ethereumWallet!,
      solanaWallet: config.solanaWallet!,
    },
    plan: { destinationNetwork: SOLANA },
    status: 'READY_TO_MINT' as const,
    destinationProvider: 'jupiter' as const,
    revision: 0,
    createdAt: Date.now(),
    sourceTransactionId: null,
    emittedMessage: null,
    attestation: { message: '0x11' as const, signature: '0x22' as const },
    received: '100000000',
  };
  journal.createBridge(bridge);
  vi.spyOn(service as unknown as { bound: () => unknown }, 'bound').mockReturnValue({
    plan: bridge.plan,
    expectedReceivedAmount: 100_000_000n,
  });
  await expect(service.destination(bridge.id, 'mint-and-supply')).rejects.toThrow(
    /Receive the bridged USDC first/,
  );
  journal.updateBridge({ ...bridge, status: 'MINTED' });
  const prepare = vi.spyOn(service.lending, 'prepare').mockResolvedValue({} as never);
  await service.destination(bridge.id, 'supply-only');
  expect(prepare).toHaveBeenCalledWith(
    bridge.config,
    SOLANA,
    'supply',
    '100.000000',
    { fundingBridgeId: bridge.id },
    'jupiter',
  );
});

it('does not charge another same-chain fee when depositing verified bridged funds', async () => {
  const bridge = {
    id: `0x${'22'.repeat(32)}` as const,
    config: {
      ...config,
      ethereumWallet: config.ethereumWallet!,
      solanaWallet: config.solanaWallet!,
    },
    plan: { destinationNetwork: ETHEREUM },
    status: 'MINTED' as const,
    destinationProvider: 'euler' as const,
    revision: 0,
    createdAt: Date.now(),
    sourceTransactionId: null,
    emittedMessage: null,
    attestation: null,
    received: '100000000',
  };
  journal.createBridge(bridge);
  vi.spyOn(service.ethereum, 'call').mockResolvedValue(`0x${100_000_000n.toString(16)}`);
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
  const step = await service.lending.prepare(
    config,
    ETHEREUM,
    'supply',
    '100',
    { fundingBridgeId: bridge.id },
    'euler',
  );
  expect(step).toMatchObject({
    kind: 'LENDING_SUPPLY',
    ethereum: { to: MARKETS.euler.target },
    evidence: { platformFee: '0', routingFeeBps: '0', totalSourceDebit: '100000000' },
  });
  await expect(validateReviewedStep(step, config)).resolves.toBeUndefined();
  expect(service.ethereum.validateLendingRouter).not.toHaveBeenCalled();
});
