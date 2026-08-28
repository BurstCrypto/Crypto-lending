import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
  RequestMethod,
} from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import type { CurrentPrincipal } from '../accounts/auth/current-principal';
import { parseAccountId, type AccountId } from '../accounts/domain/account-profile';
import { loggingContext } from '../infrastructure/logging';
import type { JobCorrelationContext } from '../infrastructure/outbox/job-envelope';
import type {
  LocalDemoAllocationPreviewResponse,
  LocalDemoAllocationService,
} from './local-demo-allocation.service';
import { LocalDemoPortfolioSnapshotChangedError } from './local-demo-allocation.service';
import type { LocalDemoRuntimeConfig } from './local-demo-runtime.config';
import {
  LocalDemoNoMatchingYieldOpportunitiesError,
  LocalDemoYieldCatalogService,
  type LocalDemoYieldCatalogResponse,
} from './local-demo-yield-catalog.service';
import type {
  LocalDemoWalletConnection,
  LocalDemoWalletService,
} from './local-demo-wallet.service';
import { LocalDemoController } from './local-demo.controller';

const ACCOUNT_A = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const ACCOUNT_B = parseAccountId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const CORRELATION_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CORRELATION_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const AUTHENTICATED_REQUEST_CORRELATION_B: JobCorrelationContext = Object.freeze({
  correlationId: CORRELATION_B,
  requestId: CORRELATION_B,
  initiatorActorId: ACCOUNT_B,
});
const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const WALLET_ID = '22222222-2222-4222-8222-222222222222';
const SECRET_CANARY = 'private-key-signature-challenge-canary';

const ENABLED_CONFIG: LocalDemoRuntimeConfig = Object.freeze({
  mode: 'enabled',
  apiHost: '127.0.0.1',
  publicOrigin: 'http://127.0.0.1:3000',
  localEvmRpcUrl: 'http://127.0.0.1:18545',
  localEvmControl: Object.freeze({
    url: 'http://127.0.0.1:18546/control',
    launchId: '0123456789abcdef0123456789abcdef',
    capability: '1111111111111111111111111111111111111111111111111111111111111111',
  }),
});

const DISABLED_CONFIG: LocalDemoRuntimeConfig = Object.freeze({ mode: 'disabled' });

const CONNECTION: LocalDemoWalletConnection = Object.freeze({
  connectionId: CONNECTION_ID,
  walletId: WALLET_ID,
  label: 'Synthetic EVM wallet',
  namespace: 'EVM',
  chainId: 'eip155:11155111',
  address: '0x1111111111111111111111111111111111111111',
  registeredAt: '2026-08-24T20:00:00.000Z',
});

const PORTFOLIO = Object.freeze({
  schemaVersion: 1,
  snapshotId: 'local-demo-portfolio:0123456789abcdef0123456789abcdef',
  portfolioValueUsdMinor: '1100000',
});

const BALANCED_REQUEST_SELECTION = Object.freeze({
  kind: 'PRESET' as const,
  presetId: 'BALANCED' as const,
  liquidReserveBasisPoints: 3_000,
});

const YIELD_CATALOG: LocalDemoYieldCatalogResponse = new LocalDemoYieldCatalogService().read(
  new Date('2026-08-27T01:05:00.000Z'),
);

const ALLOCATION_PREVIEW: LocalDemoAllocationPreviewResponse = Object.freeze({
  use: 'LOCAL_DEMO_ESTIMATE_ONLY',
  mayAuthorizeFinancialAction: false,
  portfolioSnapshotId: PORTFOLIO.snapshotId,
  selection: Object.freeze({
    kind: 'PRESET',
    presetId: 'BALANCED',
    label: 'Managed blend',
    description:
      'Keep 30% readily available and allocate the remainder to the managed yield strategy.',
    liquidReserveBasisPoints: 3_000,
  }),
  rateSnapshot: Object.freeze({
    id: YIELD_CATALOG.snapshot.id,
    capturedAt: YIELD_CATALOG.snapshot.capturedAt,
    staleAfter: YIELD_CATALOG.snapshot.staleAfter,
    freshness: YIELD_CATALOG.snapshot.freshness,
    staleBehavior: YIELD_CATALOG.snapshot.staleBehavior,
    riskClassificationAvailable: false,
    riskClassification: YIELD_CATALOG.snapshot.riskClassification,
  }),
  grossCapitalUsdMinor: '1100000',
  sourceCapitalByEcosystem: Object.freeze([
    Object.freeze({ ecosystem: 'EVM', amountUsdMinor: '700000' }),
    Object.freeze({ ecosystem: 'SOLANA', amountUsdMinor: '400000' }),
  ]),
  allocations: Object.freeze([
    Object.freeze({
      bucket: 'LIQUID_RESERVE',
      allocationId: 'LIQUID_RESERVE',
      label: 'Liquid reserve',
      percentageBasisPoints: 3_000,
      amountUsdMinor: '329718',
    }),
    Object.freeze({
      bucket: 'MANAGED_YIELD',
      allocationId: 'MANAGED_YIELD',
      label: 'Managed yield',
      percentageBasisPoints: 7_000,
      amountUsdMinor: '769342',
    }),
  ]),
  managedYieldComposition: Object.freeze([
    Object.freeze({
      ecosystem: 'EVM',
      label: 'EVM managed yield',
      percentageBasisPointsOfManagedYield: 6_364,
      amountUsdMinor: '489609',
    }),
    Object.freeze({
      ecosystem: 'SOLANA',
      label: 'SVM managed yield',
      percentageBasisPointsOfManagedYield: 3_636,
      amountUsdMinor: '279733',
    }),
  ]),
  compositionSummary: Object.freeze({
    mode: 'EVM_SOLANA_PORTFOLIO_BLEND',
    crossEcosystemTransferRequired: false,
    crossEcosystemTransferUsdMinor: '0',
    activeEcosystemCount: 2,
  }),
  executionCost: Object.freeze({
    actualLocalOperation: Object.freeze({ status: 'NO_EXECUTION', amountUsdMinor: '0' }),
    modeledScenario: Object.freeze({
      status: 'AVAILABLE',
      modelId: 'LOCAL_DEMO_ALLOCATION_COST_V2',
      isQuote: false,
      costBasisCapitalUsdMinor: '1100000',
      fundingTreatment: 'MIXED_DEDUCT_FROM_GROSS_AND_ADD_ON_TOP',
      rounding: 'CEIL_VARIABLE_COMPONENTS_PLATFORM_FEE_HALF_EVEN',
      routingFeePolicy: Object.freeze({
        tier: 'FREE',
        classification: 'MATERIAL_ORCHESTRATION',
        ruleVersion: 1,
      }),
      components: Object.freeze([
        Object.freeze({
          code: 'NETWORK',
          label: 'Estimated network costs',
          calculationBasis: 'NETWORK_ACTIVATION_AND_POSITION_VOLUME',
          fundingTreatment: 'DEDUCTED_FROM_GROSS',
          amountUsdMinor: '400',
        }),
        Object.freeze({
          code: 'CONVERSION',
          label: 'Estimated conversion costs',
          calculationBasis: 'TWELVE_BPS_OF_REQUIRED_CONVERSION',
          fundingTreatment: 'DEDUCTED_FROM_GROSS',
          amountUsdMinor: '200',
        }),
        Object.freeze({
          code: 'CROSS_ECOSYSTEM_TRANSFER',
          label: 'Estimated EVM-Solana transfer costs',
          calculationBasis: 'NO_CROSS_ECOSYSTEM_TRANSFER',
          fundingTreatment: 'DEDUCTED_FROM_GROSS',
          amountUsdMinor: '0',
        }),
        Object.freeze({
          code: 'MARKET_IMPACT',
          label: 'Estimated market impact',
          calculationBasis: 'POSITION_SIZE_AND_UTILIZATION',
          fundingTreatment: 'DEDUCTED_FROM_GROSS',
          amountUsdMinor: '340',
        }),
        Object.freeze({
          code: 'PLATFORM_ROUTING',
          label: 'Estimated platform routing fee',
          calculationBasis: 'CANONICAL_PLATFORM_ROUTING_RULE_V1',
          fundingTreatment: 'ADDED_ON_TOP',
          amountUsdMinor: '1539',
        }),
      ]),
      deductedFromGrossUsdMinor: '940',
      addedOnTopUsdMinor: '1539',
      retainedRoundingResidualUsdMinor: '0',
      totalUsdMinor: '2479',
      requiredCapitalIncludingAddedOnTopUsdMinor: '1101539',
    }),
    publicExecution: Object.freeze({ status: 'UNQUOTED', amountUsdMinor: null }),
  }),
  capitalIncludedInProjectionUsdMinor: '1099060',
  yieldProjection: Object.freeze({
    source: 'MANAGED_RATE_SNAPSHOT',
    calculationMethod: 'INTERNAL_POSITION_WEIGHTED_25_BPS_CONSERVATIVE_BUCKET',
    effectiveApyBasisPoints: 325,
    projectedAnnualYieldUsdMinor: '35719',
    projectedAnnualYieldAfterFeesUsdMinor: '33240',
    firstPositiveDayAfterFees: Object.freeze({
      calculationMethod: 'FIRST_WHOLE_DAY_VISIBLE_YIELD_EXCEEDS_ESTIMATED_FEES',
      status: 'RECOVERED_WITHIN_HORIZON',
      day: 26,
      modelHorizonDays: 365,
    }),
  }),
  asOf: '2026-08-24T18:30:00.000Z',
});

type WalletBoundary = Pick<LocalDemoWalletService, 'connect' | 'disconnect' | 'list' | 'reset'>;

interface PortfolioBoundary {
  read(accountId: AccountId, correlation: JobCorrelationContext): Promise<unknown>;
}

type AllocationBoundary = Pick<LocalDemoAllocationService, 'preview'>;
type YieldCatalogBoundary = Pick<LocalDemoYieldCatalogService, 'read'>;

interface ControllerFixture {
  readonly controller: LocalDemoController;
  readonly wallets: jest.Mocked<WalletBoundary>;
  readonly portfolio: jest.Mocked<PortfolioBoundary>;
  readonly yieldCatalog: jest.Mocked<YieldCatalogBoundary>;
  readonly allocations: jest.Mocked<AllocationBoundary>;
}

interface ResponseFixture {
  readonly response: { readonly setHeader: jest.Mock };
  readonly headers: Map<string, string>;
}

function controllerFixture(config: LocalDemoRuntimeConfig = ENABLED_CONFIG): ControllerFixture {
  const wallets: jest.Mocked<WalletBoundary> = {
    connect: jest.fn(async (input) => {
      void input;
      return CONNECTION;
    }),
    disconnect: jest.fn((accountId, connectionId) => {
      void accountId;
      void connectionId;
      return true;
    }),
    list: jest.fn((accountId) => {
      void accountId;
      return Object.freeze([CONNECTION]);
    }),
    reset: jest.fn((accountId) => {
      void accountId;
    }),
  };
  const portfolio: jest.Mocked<PortfolioBoundary> = {
    read: jest.fn(async (accountId, correlationId) => {
      void accountId;
      void correlationId;
      return PORTFOLIO;
    }),
  };
  const yieldCatalog: jest.Mocked<YieldCatalogBoundary> = {
    read: jest.fn(() => YIELD_CATALOG),
  };
  const allocations: jest.Mocked<AllocationBoundary> = {
    preview: jest.fn(async (accountId, correlation, portfolioSnapshotId, selection) => {
      void accountId;
      void correlation;
      void portfolioSnapshotId;
      void selection;
      return ALLOCATION_PREVIEW;
    }),
  };
  return {
    controller: new LocalDemoController(
      wallets as never,
      portfolio as never,
      yieldCatalog as never,
      allocations as never,
      config,
    ),
    wallets,
    portfolio,
    yieldCatalog,
    allocations,
  };
}

function responseFixture(): ResponseFixture {
  const headers = new Map<string, string>();
  return {
    response: {
      setHeader: jest.fn((name: string, value: string) => {
        headers.set(name, value);
      }),
    },
    headers,
  };
}

function principal(accountId: AccountId): CurrentPrincipal {
  return Object.freeze({ accountId });
}

function captureThrown(work: () => unknown): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  throw new Error('Expected work to throw');
}

async function captureRejected(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error('Expected work to reject');
}

function expectUnavailable(error: unknown, response: ResponseFixture): void {
  expect(error).toBeInstanceOf(HttpException);
  const httpError = error as HttpException;
  expect(httpError.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  expect(httpError.getResponse()).toEqual({
    error: 'Service Unavailable',
    message: 'Local demo data is unavailable',
    statusCode: HttpStatus.SERVICE_UNAVAILABLE,
  });
  expect(response.headers).toEqual(new Map([['Retry-After', '1']]));
  expect(JSON.stringify(httpError.getResponse())).not.toContain(SECRET_CANARY);
}

function expectNoServerConfidentialStrategyDetails(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toMatch(
    /morpho|kamino|aave|save|solend|compound|moonwell|spark|venus|euler|marginfi|\bp0\b|project[\s._/-]*0|bnb|eip155:56|graphql|api\./iu,
  );
  expect(serialized).not.toMatch(
    /"(?:provider|providerId|providerIds|providerName|protocol|protocolId|protocolName|marketId|marketIds|reserveId|opportunity|opportunityId|opportunities|sourceId|provenance|sourceReference|sourceObservedAt|retrievedAt|payloadSha256|normalizer|normalizerId|normalizerVersion|attributes|endpoint)"\s*:/iu,
  );
}

describe('LocalDemoController', () => {
  it('publishes exact local-demo routes and successful status codes', () => {
    const prototype = LocalDemoController.prototype;
    expect(Reflect.getMetadata(PATH_METADATA, LocalDemoController)).toBe('local-demo');
    expect(Reflect.getMetadata(METHOD_METADATA, prototype.listWallets)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, prototype.listWallets)).toBe('wallets');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototype.listWallets)).toBe(HttpStatus.OK);
    expect(Reflect.getMetadata(METHOD_METADATA, prototype.connectWallet)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, prototype.connectWallet)).toBe('wallets');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototype.connectWallet)).toBe(
      HttpStatus.CREATED,
    );
    expect(Reflect.getMetadata(METHOD_METADATA, prototype.disconnectWallet)).toBe(
      RequestMethod.DELETE,
    );
    expect(Reflect.getMetadata(PATH_METADATA, prototype.disconnectWallet)).toBe('wallets');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototype.disconnectWallet)).toBe(
      HttpStatus.NO_CONTENT,
    );
    expect(Reflect.getMetadata(METHOD_METADATA, prototype.readPortfolio)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, prototype.readPortfolio)).toBe('portfolio');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototype.readPortfolio)).toBe(HttpStatus.OK);
    expect(Reflect.getMetadata(METHOD_METADATA, prototype.readYieldCatalog)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(PATH_METADATA, prototype.readYieldCatalog)).toBe('yield-catalog');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototype.readYieldCatalog)).toBe(HttpStatus.OK);
    expect(Reflect.getMetadata(METHOD_METADATA, prototype.previewAllocation)).toBe(
      RequestMethod.POST,
    );
    expect(Reflect.getMetadata(PATH_METADATA, prototype.previewAllocation)).toBe(
      'allocation-preview',
    );
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototype.previewAllocation)).toBe(
      HttpStatus.OK,
    );
  });

  it('returns only the authenticated account wallet catalog', () => {
    const fixture = controllerFixture();
    const response = responseFixture();

    expect(fixture.controller.listWallets(principal(ACCOUNT_A), response.response)).toEqual([
      CONNECTION,
    ]);
    expect(fixture.wallets.list).toHaveBeenCalledWith(ACCOUNT_A);
    expect(fixture.wallets.list).not.toHaveBeenCalledWith(ACCOUNT_B);
    expect(response.response.setHeader).not.toHaveBeenCalled();
  });

  it.each(['EVM', 'SOLANA'] as const)(
    'connects one %s synthetic wallet with only principal and logging context authority',
    async (namespace) => {
      const fixture = controllerFixture();
      const response = responseFixture();
      const correlationId = namespace === 'EVM' ? CORRELATION_A : CORRELATION_B;
      const accountId = namespace === 'EVM' ? ACCOUNT_A : ACCOUNT_B;

      const result = await loggingContext.run({ correlationId }, () =>
        fixture.controller.connectWallet(principal(accountId), { namespace }, response.response),
      );

      expect(result).toBe(CONNECTION);
      expect(fixture.wallets.connect).toHaveBeenCalledWith({
        accountId,
        namespace,
        correlationId,
      });
      expect(response.response.setHeader).not.toHaveBeenCalled();
    },
  );

  it('rejects extra fields, caller account scope, and caller-authored wallet material exactly', async () => {
    const bodies: readonly unknown[] = [
      {},
      { namespace: 'eip155' },
      { namespace: 'EVM', accountId: ACCOUNT_B },
      { namespace: 'EVM', address: '0x1111111111111111111111111111111111111111' },
      { namespace: 'EVM', privateKey: SECRET_CANARY },
      { namespace: 'EVM', signature: SECRET_CANARY },
      { namespace: 'EVM', challenge: SECRET_CANARY },
    ];
    let getterInvoked = false;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, 'namespace', {
      enumerable: true,
      get: () => {
        getterInvoked = true;
        return 'EVM';
      },
    });

    for (const body of [...bodies, accessor]) {
      const fixture = controllerFixture();
      const response = responseFixture();
      const error = await captureRejected(() =>
        loggingContext.run({ correlationId: CORRELATION_A }, () =>
          fixture.controller.connectWallet(principal(ACCOUNT_A), body, response.response),
        ),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      const httpError = error as BadRequestException;
      expect(httpError.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(JSON.stringify(httpError.getResponse())).toContain('Local demo request is invalid');
      expect(JSON.stringify(httpError.getResponse())).not.toContain(SECRET_CANARY);
      expect(fixture.wallets.connect).not.toHaveBeenCalled();
      expect(response.response.setHeader).not.toHaveBeenCalled();
    }
    expect(getterInvoked).toBe(false);
  });

  it('disconnects only the principal-scoped canonical connection and remains idempotent', () => {
    const fixture = controllerFixture();
    const response = responseFixture();

    expect(
      fixture.controller.disconnectWallet(
        principal(ACCOUNT_A),
        { connectionId: CONNECTION_ID },
        response.response,
      ),
    ).toBeUndefined();
    expect(fixture.wallets.disconnect).toHaveBeenCalledWith(ACCOUNT_A, CONNECTION_ID);

    fixture.wallets.disconnect.mockReturnValueOnce(false);
    expect(
      fixture.controller.disconnectWallet(
        principal(ACCOUNT_B),
        { connectionId: CONNECTION_ID },
        response.response,
      ),
    ).toBeUndefined();
    expect(fixture.wallets.disconnect).toHaveBeenLastCalledWith(ACCOUNT_B, CONNECTION_ID);
  });

  it('rejects a malformed disconnect body before touching wallet state', () => {
    const fixture = controllerFixture();
    const response = responseFixture();
    const error = captureThrown(() =>
      fixture.controller.disconnectWallet(
        principal(ACCOUNT_A),
        { connectionId: CONNECTION_ID, privateKey: SECRET_CANARY },
        response.response,
      ),
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(JSON.stringify((error as BadRequestException).getResponse())).not.toContain(
      SECRET_CANARY,
    );
    expect(fixture.wallets.disconnect).not.toHaveBeenCalled();
  });

  it('reads the portfolio for only the principal account and active correlation', async () => {
    const fixture = controllerFixture();
    const response = responseFixture();

    const result = await loggingContext.run(AUTHENTICATED_REQUEST_CORRELATION_B, () =>
      fixture.controller.readPortfolio(principal(ACCOUNT_B), response.response),
    );

    expect(result).toBe(PORTFOLIO);
    expect(fixture.portfolio.read).toHaveBeenCalledWith(
      ACCOUNT_B,
      AUTHENTICATED_REQUEST_CORRELATION_B,
    );
    expect(fixture.portfolio.read).not.toHaveBeenCalledWith(ACCOUNT_A, expect.anything());
  });

  it('reads only sanitized non-executable managed-rate status while enabled', () => {
    const fixture = controllerFixture();
    const response = responseFixture();

    const result = fixture.controller.readYieldCatalog(response.response);

    expect(result).toBe(YIELD_CATALOG);
    expect(fixture.yieldCatalog.read).toHaveBeenCalledWith();
    expect(result).toEqual({
      use: 'LOCAL_DEMO_MANAGED_RATE_SNAPSHOT_ONLY',
      mayAuthorizeFinancialAction: false,
      riskClassificationAvailable: false,
      strategyMode: 'PORTFOLIO_CROSS_CHAIN_BLEND',
      ecosystems: ['EVM', 'SOLANA'],
      snapshot: {
        id: 'managed-rate-snapshot-v3',
        capturedAt: '2026-08-27T01:04:48.000Z',
        staleAfter: '2026-08-27T14:14:54.580Z',
        freshness: 'CURRENT',
        staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
        riskClassification: 'NOT_ASSESSED',
      },
    });
    expectNoServerConfidentialStrategyDetails(result);
  });

  it('previews only an allowlisted preset for the principal account and active correlation', async () => {
    const fixture = controllerFixture();
    const response = responseFixture();

    const result = await loggingContext.run(AUTHENTICATED_REQUEST_CORRELATION_B, () =>
      fixture.controller.previewAllocation(
        principal(ACCOUNT_B),
        {
          portfolioSnapshotId: PORTFOLIO.snapshotId,
          selection: BALANCED_REQUEST_SELECTION,
        },
        response.response,
      ),
    );

    expect(result).toBe(ALLOCATION_PREVIEW);
    expect(fixture.allocations.preview).toHaveBeenCalledWith(
      ACCOUNT_B,
      AUTHENTICATED_REQUEST_CORRELATION_B,
      PORTFOLIO.snapshotId,
      BALANCED_REQUEST_SELECTION,
    );
    expect(fixture.allocations.preview).not.toHaveBeenCalledWith(
      ACCOUNT_A,
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expectNoServerConfidentialStrategyDetails(result);
  });

  it('rejects caller-authored economics and malformed selections before previewing', async () => {
    const bodies: readonly unknown[] = [
      {},
      { presetId: 'BALANCED' },
      {
        portfolioSnapshotId: PORTFOLIO.snapshotId,
        selection: { kind: 'PRESET', presetId: 'CUSTOM', liquidReserveBasisPoints: 3_000 },
      },
      {
        portfolioSnapshotId: PORTFOLIO.snapshotId,
        selection: { kind: 'PRESET', presetId: 'BALANCED' },
      },
      {
        portfolioSnapshotId: PORTFOLIO.snapshotId,
        selection: { kind: 'PRESET', presetId: 'BALANCED', liquidReserveBasisPoints: -1 },
      },
      {
        portfolioSnapshotId: PORTFOLIO.snapshotId,
        selection: { kind: 'PRESET', presetId: 'BALANCED', liquidReserveBasisPoints: 9_501 },
      },
      {
        portfolioSnapshotId: PORTFOLIO.snapshotId,
        selection: { kind: 'PRESET', presetId: 'BALANCED', liquidReserveBasisPoints: 1.5 },
      },
      {
        portfolioSnapshotId: PORTFOLIO.snapshotId,
        selection: {
          kind: 'PRESET',
          presetId: 'BALANCED',
          liquidReserveBasisPoints: 3_000,
          amountUsdMinor: '1100000',
        },
      },
      {
        portfolioSnapshotId: PORTFOLIO.snapshotId,
        selection: {
          kind: 'PRESET',
          presetId: 'MORE_YIELD',
          liquidReserveBasisPoints: 1_500,
        },
        accountId: ACCOUNT_B,
      },
      {
        portfolioSnapshotId: PORTFOLIO.snapshotId,
        selection: {
          kind: 'CUSTOM',
          liquidReserveBasisPoints: 2_500,
          filters: {
            assetSymbols: ['USDC'],
            providerIds: ['caller-supplied-provider'],
            networkIds: ['eip155:1'],
            minimumApyBasisPoints: 0,
            minimumTvlUsdMinor: '0',
            minimumExitLiquidityUsdMinor: '0',
            maximumUtilizationBasisPoints: 10_000,
            feeBasisPoints: 0,
          },
        },
      },
      {
        portfolioSnapshotId: PORTFOLIO.snapshotId,
        selection: {
          kind: 'PRESET',
          presetId: 'BALANCED',
          liquidReserveBasisPoints: 3_000,
          providerId: 'caller-supplied-provider',
        },
      },
      {
        portfolioSnapshotId: PORTFOLIO.snapshotId,
        selection: {
          kind: 'PRESET',
          presetId: 'BALANCED',
          liquidReserveBasisPoints: 3_000,
          protocol: 'caller-supplied-protocol',
        },
      },
      {
        portfolioSnapshotId: PORTFOLIO.snapshotId,
        selection: {
          kind: 'PRESET',
          presetId: 'BALANCED',
          liquidReserveBasisPoints: 3_000,
          marketId: 'caller-supplied-market',
        },
      },
      {
        portfolioSnapshotId: PORTFOLIO.snapshotId,
        selection: {
          kind: 'PRESET',
          presetId: 'BALANCED',
          liquidReserveBasisPoints: 3_000,
          provenance: { endpoint: 'https://example.invalid' },
        },
      },
    ];

    for (const body of bodies) {
      const fixture = controllerFixture();
      const response = responseFixture();
      const error = await captureRejected(() =>
        loggingContext.run(AUTHENTICATED_REQUEST_CORRELATION_B, () =>
          fixture.controller.previewAllocation(principal(ACCOUNT_B), body, response.response),
        ),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(fixture.allocations.preview).not.toHaveBeenCalled();
      expect(response.response.setHeader).not.toHaveBeenCalled();
    }
  });

  it('returns a typed 422 when the server-confidential strategy is unavailable', async () => {
    const fixture = controllerFixture();
    const response = responseFixture();
    fixture.allocations.preview.mockRejectedValueOnce(
      new LocalDemoNoMatchingYieldOpportunitiesError(),
    );

    const error = await captureRejected(() =>
      loggingContext.run(AUTHENTICATED_REQUEST_CORRELATION_B, () =>
        fixture.controller.previewAllocation(
          principal(ACCOUNT_B),
          {
            portfolioSnapshotId: PORTFOLIO.snapshotId,
            selection: BALANCED_REQUEST_SELECTION,
          },
          response.response,
        ),
      ),
    );

    expect(error).toBeInstanceOf(HttpException);
    const httpError = error as HttpException;
    expect(httpError.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(httpError.getResponse()).toEqual({
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      error: 'Unprocessable Entity',
      message: 'The managed yield strategy is unavailable for this snapshot',
      code: 'NO_MATCHING_YIELD_OPPORTUNITIES',
    });
    expect(response.response.setHeader).not.toHaveBeenCalled();
  });

  it('returns a sanitized 409 when the displayed portfolio snapshot changed', async () => {
    const fixture = controllerFixture();
    const response = responseFixture();
    fixture.allocations.preview.mockRejectedValueOnce(new LocalDemoPortfolioSnapshotChangedError());

    const error = await captureRejected(() =>
      loggingContext.run(AUTHENTICATED_REQUEST_CORRELATION_B, () =>
        fixture.controller.previewAllocation(
          principal(ACCOUNT_B),
          {
            portfolioSnapshotId: PORTFOLIO.snapshotId,
            selection: BALANCED_REQUEST_SELECTION,
          },
          response.response,
        ),
      ),
    );

    expect(error).toBeInstanceOf(HttpException);
    const httpError = error as HttpException;
    expect(httpError.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(httpError.getResponse()).toEqual({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      message: 'The local demo portfolio changed; refresh and retry',
      code: 'PORTFOLIO_SNAPSHOT_CHANGED',
    });
    expect(response.response.setHeader).not.toHaveBeenCalled();
  });

  it('uses one generic redacted 503 contract for every dependency failure', async () => {
    const list = controllerFixture();
    const listResponse = responseFixture();
    list.wallets.list.mockImplementationOnce(() => {
      throw new Error(SECRET_CANARY);
    });
    expectUnavailable(
      captureThrown(() => list.controller.listWallets(principal(ACCOUNT_A), listResponse.response)),
      listResponse,
    );

    const connect = controllerFixture();
    const connectResponse = responseFixture();
    connect.wallets.connect.mockRejectedValueOnce(new Error(SECRET_CANARY));
    expectUnavailable(
      await captureRejected(() =>
        loggingContext.run({ correlationId: CORRELATION_A }, () =>
          connect.controller.connectWallet(
            principal(ACCOUNT_A),
            { namespace: 'EVM' },
            connectResponse.response,
          ),
        ),
      ),
      connectResponse,
    );

    const disconnect = controllerFixture();
    const disconnectResponse = responseFixture();
    disconnect.wallets.disconnect.mockImplementationOnce(() => {
      throw new Error(SECRET_CANARY);
    });
    expectUnavailable(
      captureThrown(() =>
        disconnect.controller.disconnectWallet(
          principal(ACCOUNT_A),
          { connectionId: CONNECTION_ID },
          disconnectResponse.response,
        ),
      ),
      disconnectResponse,
    );

    const portfolio = controllerFixture();
    const portfolioResponse = responseFixture();
    portfolio.portfolio.read.mockRejectedValueOnce(new Error(SECRET_CANARY));
    expectUnavailable(
      await captureRejected(() =>
        loggingContext.run({ correlationId: CORRELATION_A }, () =>
          portfolio.controller.readPortfolio(principal(ACCOUNT_A), portfolioResponse.response),
        ),
      ),
      portfolioResponse,
    );

    const catalog = controllerFixture();
    const catalogResponse = responseFixture();
    catalog.yieldCatalog.read.mockImplementationOnce(() => {
      throw new Error(SECRET_CANARY);
    });
    expectUnavailable(
      captureThrown(() => catalog.controller.readYieldCatalog(catalogResponse.response)),
      catalogResponse,
    );

    const allocation = controllerFixture();
    const allocationResponse = responseFixture();
    allocation.allocations.preview.mockRejectedValueOnce(new Error(SECRET_CANARY));
    expectUnavailable(
      await captureRejected(() =>
        loggingContext.run(AUTHENTICATED_REQUEST_CORRELATION_B, () =>
          allocation.controller.previewAllocation(
            principal(ACCOUNT_B),
            {
              portfolioSnapshotId: PORTFOLIO.snapshotId,
              selection: BALANCED_REQUEST_SELECTION,
            },
            allocationResponse.response,
          ),
        ),
      ),
      allocationResponse,
    );
  });

  it('maps a missing correlation context to the same generic 503 without calling a service', async () => {
    const connect = controllerFixture();
    const connectResponse = responseFixture();
    expectUnavailable(
      await captureRejected(() =>
        connect.controller.connectWallet(
          principal(ACCOUNT_A),
          { namespace: 'EVM' },
          connectResponse.response,
        ),
      ),
      connectResponse,
    );
    expect(connect.wallets.connect).not.toHaveBeenCalled();

    const portfolio = controllerFixture();
    const portfolioResponse = responseFixture();
    expectUnavailable(
      await captureRejected(() =>
        portfolio.controller.readPortfolio(principal(ACCOUNT_A), portfolioResponse.response),
      ),
      portfolioResponse,
    );
    expect(portfolio.portfolio.read).not.toHaveBeenCalled();

    const allocation = controllerFixture();
    const allocationResponse = responseFixture();
    expectUnavailable(
      await captureRejected(() =>
        allocation.controller.previewAllocation(
          principal(ACCOUNT_A),
          {
            portfolioSnapshotId: PORTFOLIO.snapshotId,
            selection: BALANCED_REQUEST_SELECTION,
          },
          allocationResponse.response,
        ),
      ),
      allocationResponse,
    );
    expect(allocation.allocations.preview).not.toHaveBeenCalled();
  });

  it('returns a generic 404 and performs no work while the runtime is disabled', async () => {
    const fixture = controllerFixture(DISABLED_CONFIG);

    const listError = captureThrown(() =>
      fixture.controller.listWallets(principal(ACCOUNT_A), responseFixture().response),
    );
    const disconnectError = captureThrown(() =>
      fixture.controller.disconnectWallet(
        principal(ACCOUNT_A),
        { connectionId: CONNECTION_ID },
        responseFixture().response,
      ),
    );
    const connectError = await captureRejected(() =>
      fixture.controller.connectWallet(
        principal(ACCOUNT_A),
        { namespace: 'EVM' },
        responseFixture().response,
      ),
    );
    const portfolioError = await captureRejected(() =>
      fixture.controller.readPortfolio(principal(ACCOUNT_A), responseFixture().response),
    );
    const catalogError = captureThrown(() =>
      fixture.controller.readYieldCatalog(responseFixture().response),
    );
    const allocationError = await captureRejected(() =>
      fixture.controller.previewAllocation(
        principal(ACCOUNT_A),
        {
          portfolioSnapshotId: PORTFOLIO.snapshotId,
          selection: BALANCED_REQUEST_SELECTION,
        },
        responseFixture().response,
      ),
    );

    for (const error of [
      listError,
      disconnectError,
      connectError,
      portfolioError,
      catalogError,
      allocationError,
    ]) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect(JSON.stringify((error as NotFoundException).getResponse())).toContain('Not found');
      expect(JSON.stringify((error as NotFoundException).getResponse())).not.toContain(
        'local-demo',
      );
    }
    expect(fixture.wallets.list).not.toHaveBeenCalled();
    expect(fixture.wallets.connect).not.toHaveBeenCalled();
    expect(fixture.wallets.disconnect).not.toHaveBeenCalled();
    expect(fixture.portfolio.read).not.toHaveBeenCalled();
    expect(fixture.yieldCatalog.read).not.toHaveBeenCalled();
    expect(fixture.allocations.preview).not.toHaveBeenCalled();
  });
});
