import { parseAccountId, type AccountId } from '../accounts/domain/account-profile';
import { BuyingPowerCalculator } from '../buying-power/application/buying-power-calculator';
import { EvmStablecoinBalanceIndexer } from '../blockchain/application/evm-stablecoin-balance-indexer';
import { SolanaDepositIndexerService } from '../blockchain/application/solana-deposit-indexer.service';
import { BalanceSyncOrchestrator } from '../blockchain-sync/application/balance-sync-orchestrator';
import { loggingContext } from '../infrastructure/logging';
import type { JobCorrelationContext } from '../infrastructure/outbox/job-envelope';
import {
  LocalDemoPortfolioService,
  LocalDemoPortfolioUnavailableError,
} from './local-demo-portfolio.service';
import type {
  LocalDemoWalletConnection,
  LocalDemoWalletService,
} from './local-demo-wallet.service';

const ACCOUNT_A = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const ACCOUNT_B = parseAccountId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const CORRELATION_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CORRELATION_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const JOB_CORRELATION_A: JobCorrelationContext = Object.freeze({
  correlationId: CORRELATION_A,
});
const JOB_CORRELATION_B: JobCorrelationContext = Object.freeze({
  correlationId: CORRELATION_B,
});
const AUTHENTICATED_REQUEST_CORRELATION_A: JobCorrelationContext = Object.freeze({
  correlationId: CORRELATION_A,
  requestId: CORRELATION_A,
  initiatorActorId: ACCOUNT_A,
});

const WALLET_A_EVM = '11111111-1111-4111-8111-111111111111';
const WALLET_A_SOLANA = '22222222-2222-4222-8222-222222222222';
const WALLET_B_EVM = '33333333-3333-4333-8333-333333333333';
const WALLET_B_SOLANA = '44444444-4444-4444-8444-444444444444';

function connection(
  walletId: string,
  namespace: 'EVM' | 'SOLANA',
  address: string,
): LocalDemoWalletConnection {
  return Object.freeze({
    connectionId: walletId,
    walletId,
    label: namespace === 'EVM' ? 'Synthetic EVM wallet' : 'Synthetic Solana wallet',
    namespace,
    chainId: namespace === 'EVM' ? 'eip155:11155111' : 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    address,
    registeredAt: '2026-08-24T18:00:00.000Z',
  });
}

const ACCOUNT_A_WALLETS = Object.freeze([
  connection(WALLET_A_EVM, 'EVM', '0x1111111111111111111111111111111111111111'),
  connection(WALLET_A_SOLANA, 'SOLANA', '7YttLkHDoNj9wyDur5EYBDauN5QJUJpz94QRtWQyFrA8'),
]);

const ACCOUNT_B_WALLETS = Object.freeze([
  connection(WALLET_B_EVM, 'EVM', '0x2222222222222222222222222222222222222222'),
  connection(WALLET_B_SOLANA, 'SOLANA', '3wyAj7b2zVzNRPc1K7AB5g3Zcw99oFGCBZRwBvZxr9FQ'),
]);

function serviceWith(
  walletsByAccount: ReadonlyMap<AccountId, readonly LocalDemoWalletConnection[]>,
): LocalDemoPortfolioService {
  const wallets = {
    list: jest.fn((accountId: AccountId) => walletsByAccount.get(accountId) ?? Object.freeze([])),
  } as unknown as LocalDemoWalletService;
  return new LocalDemoPortfolioService(wallets);
}

describe('LocalDemoPortfolioService', () => {
  it('composes the real index, sync, valuation, aggregation, and buying-power classes', async () => {
    const evm = jest.spyOn(EvmStablecoinBalanceIndexer.prototype, 'indexWallet');
    const solana = jest.spyOn(SolanaDepositIndexerService.prototype, 'index');
    const sync = jest.spyOn(BalanceSyncOrchestrator.prototype, 'process');
    const calculator = jest.spyOn(BuyingPowerCalculator.prototype, 'calculate');
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('global network access is forbidden in the local demo pipeline');
    });

    try {
      const result = await loggingContext.run(AUTHENTICATED_REQUEST_CORRELATION_A, () =>
        serviceWith(new Map([[ACCOUNT_A, ACCOUNT_A_WALLETS]])).read(
          ACCOUNT_A,
          AUTHENTICATED_REQUEST_CORRELATION_A,
        ),
      );

      expect(evm).toHaveBeenCalledTimes(1);
      expect(solana).toHaveBeenCalledTimes(1);
      expect(sync).toHaveBeenCalledTimes(2);
      expect(calculator).toHaveBeenCalledTimes(1);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        schemaVersion: 1,
        freshness: 'CURRENT',
        portfolioValueUsdMinor: '1100000',
        use: 'LOCAL_DEMO_ESTIMATE_ONLY',
        mayAuthorizeFinancialAction: false,
        buyingPower: {
          status: 'AVAILABLE',
          amountUsdMinor: '1089000',
          freshness: 'CURRENT',
          reasons: [],
          deductions: [
            { code: 'LIQUIDITY', amountUsdMinor: '5500' },
            { code: 'CONVERSION', amountUsdMinor: '1100' },
            { code: 'SLIPPAGE', amountUsdMinor: '1100' },
            { code: 'NETWORK', amountUsdMinor: '1100' },
            { code: 'ROUTING', amountUsdMinor: '2200' },
          ],
        },
      });
      expect(
        result.buyingPower.deductions.every(({ amountUsdMinor }) => BigInt(amountUsdMinor) > 0n),
      ).toBe(true);
      expect(result.wallets).toHaveLength(2);
      expect(result.wallets.map(({ portfolioValueUsdMinor }) => portfolioValueUsdMinor)).toEqual([
        '700000',
        '400000',
      ]);
      expect(result.wallets.map(({ buyingPowerUsdMinor }) => buyingPowerUsdMinor)).toEqual([
        '693000',
        '396000',
      ]);
      expect(
        result.wallets.flatMap(({ chains }) => chains).map(({ networkId }) => networkId),
      ).toEqual(['eip155:1', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp']);
      const assets = result.wallets.flatMap(({ chains }) =>
        chains.flatMap(({ assets: chainAssets }) => chainAssets),
      );
      expect(assets).toHaveLength(2);
      expect(assets.map(({ stablecoin }) => stablecoin)).toEqual(['USDC', 'USDC']);
      expect(
        assets.every(({ buyingPowerAvailability }) => buyingPowerAvailability === 'INCLUDED'),
      ).toBe(true);
    } finally {
      fetchSpy.mockRestore();
      calculator.mockRestore();
      sync.mockRestore();
      solana.mockRestore();
      evm.mockRestore();
    }
  });

  it('is byte-for-byte repeatable for the same account-owned wallet projection', async () => {
    const service = serviceWith(new Map([[ACCOUNT_A, ACCOUNT_A_WALLETS]]));
    const first = await service.read(ACCOUNT_A, JOB_CORRELATION_A);
    const second = await service.read(ACCOUNT_A, JOB_CORRELATION_A);
    expect(second).toEqual(first);
  });

  it('keeps wallet identifiers and addresses isolated by account', async () => {
    const service = serviceWith(
      new Map([
        [ACCOUNT_A, ACCOUNT_A_WALLETS],
        [ACCOUNT_B, ACCOUNT_B_WALLETS],
      ]),
    );
    const accountA = await service.read(ACCOUNT_A, JOB_CORRELATION_A);
    const accountB = await service.read(ACCOUNT_B, JOB_CORRELATION_B);

    expect(accountA.wallets.map(({ walletId }) => walletId)).toEqual([
      WALLET_A_EVM,
      WALLET_A_SOLANA,
    ]);
    expect(accountB.wallets.map(({ walletId }) => walletId)).toEqual([
      WALLET_B_EVM,
      WALLET_B_SOLANA,
    ]);
    expect(accountB.wallets).not.toEqual(expect.arrayContaining(accountA.wallets));
    expect(accountB.snapshotId).not.toBe(accountA.snapshotId);
  });

  it.each([
    ['EVM', ACCOUNT_A_WALLETS.slice(0, 1), '700000', '693000'],
    ['SOLANA', ACCOUNT_A_WALLETS.slice(1), '400000', '396000'],
  ] as const)(
    'returns a proportional %s-only portfolio',
    async (_namespace, wallets, portfolioMinor, buyingPowerMinor) => {
      const result = await serviceWith(new Map([[ACCOUNT_A, wallets]])).read(
        ACCOUNT_A,
        JOB_CORRELATION_A,
      );
      expect(result).toMatchObject({
        portfolioValueUsdMinor: portfolioMinor,
        buyingPower: { amountUsdMinor: buyingPowerMinor },
      });
      expect(result.wallets).toHaveLength(1);
    },
  );

  it('returns a typed unavailable error when no proven wallet is connected', async () => {
    const service = serviceWith(new Map());
    await expect(service.read(ACCOUNT_A, JOB_CORRELATION_A)).rejects.toMatchObject({
      name: 'LocalDemoPortfolioUnavailableError',
      code: 'LOCAL_DEMO_PORTFOLIO_UNAVAILABLE',
    } satisfies Partial<LocalDemoPortfolioUnavailableError>);
  });

  it('fails closed when the wallet boundary returns malformed projection metadata', async () => {
    const malformed = Object.freeze([
      Object.freeze({ ...ACCOUNT_A_WALLETS[0]!, label: ' invalid label ' }),
    ]);
    const service = serviceWith(new Map([[ACCOUNT_A, malformed]]));
    await expect(service.read(ACCOUNT_A, JOB_CORRELATION_A)).rejects.toBeInstanceOf(
      LocalDemoPortfolioUnavailableError,
    );
  });
});
