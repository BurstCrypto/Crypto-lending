import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AccountAuthGuard } from '../src/accounts/auth/account-auth.guard';
import {
  CURRENT_PRINCIPAL_RESOLVER,
  type CurrentPrincipalResolver,
} from '../src/accounts/auth/current-principal';
import { parseAccountId } from '../src/accounts/domain/account-profile';
import { configureApplication } from '../src/application';
import { StructuredLogger } from '../src/infrastructure/logging';
import {
  PORTFOLIO_CLOCK,
  PORTFOLIO_TIMER_RUNTIME,
  PortfolioService,
  SYSTEM_PORTFOLIO_TIMER_RUNTIME,
  type PortfolioClock,
} from '../src/portfolio/application/portfolio.service';
import {
  PORTFOLIO_BALANCE_READER,
  type IndexedPortfolioBalanceSnapshot,
  type PortfolioBalanceReader,
  type ReadPortfolioBalancesRequest,
} from '../src/portfolio/application/ports/portfolio-balance-reader.port';
import {
  PORTFOLIO_PRICE_EVIDENCE_READER,
  type PortfolioPriceEvidenceReader,
  type PortfolioPriceEvidenceSnapshot,
  type ReadPortfolioPriceEvidenceRequest,
} from '../src/portfolio/application/ports/portfolio-price-evidence-reader.port';
import {
  PORTFOLIO_WALLET_REGISTRATION_READER,
  type ActivePortfolioWalletRegistration,
  type PortfolioWalletRegistrationReader,
} from '../src/portfolio/application/ports/portfolio-wallet-registration-reader.port';
import { PortfolioController } from '../src/portfolio/http/portfolio.controller';
import { PortfolioPrivacyInterceptor } from '../src/portfolio/http/portfolio-privacy.interceptor';
import {
  STABLECOIN_VALUATION_FEED_REFERENCES,
  STABLECOIN_VALUATION_FIRST_USE_WATERMARKS,
  type StablecoinPriceObservation,
} from '../src/valuation';

const ACCOUNT_ID = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const OTHER_ACCOUNT_ID = parseAccountId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const WALLET_A = '11111111-1111-4111-8111-111111111111';
const WALLET_B = '22222222-2222-4222-8222-222222222222';
const WALLET_C = '66666666-6666-4666-8666-666666666666';
const EVALUATED_AT = '2026-08-24T18:00:00.000Z';
const CORRELATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const ACTIVE_WALLETS: readonly ActivePortfolioWalletRegistration[] = Object.freeze([
  { walletId: WALLET_A, networkId: 'eip155:1' },
  { walletId: WALLET_B, networkId: 'eip155:1' },
  { walletId: WALLET_C, networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' },
]);

function balanceSnapshot(): IndexedPortfolioBalanceSnapshot {
  return {
    snapshotId: 'idx5-http-snapshot-11000',
    capturedAt: '2026-08-24T17:59:59.000Z',
    freshnessClass: 'CURRENT',
    coverage: {
      status: 'COMPLETE',
      targets: ACTIVE_WALLETS.map((wallet) => ({ ...wallet, status: 'COMPLETE' })),
    },
    observations: [
      {
        observationId: '33333333-3333-4333-8333-333333333333',
        walletId: WALLET_A,
        networkId: 'eip155:1',
        assetIdentity: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        amountAtomic: '5000000000',
        observedAt: '2026-08-24T17:59:50.000Z',
        freshnessClass: 'CURRENT',
      },
      {
        observationId: '44444444-4444-4444-8444-444444444444',
        walletId: WALLET_C,
        networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        assetIdentity: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        amountAtomic: '2500000000',
        observedAt: '2026-08-24T17:59:50.000Z',
        freshnessClass: 'CURRENT',
      },
      {
        observationId: '55555555-5555-4555-8555-555555555555',
        walletId: WALLET_B,
        networkId: 'eip155:1',
        assetIdentity: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        amountAtomic: '3500000000',
        observedAt: '2026-08-24T17:59:50.000Z',
        freshnessClass: 'CURRENT',
      },
    ],
  };
}

function priceEvidence(
  requestValue: ReadPortfolioPriceEvidenceRequest,
): PortfolioPriceEvidenceSnapshot {
  const { asset, evaluatedAt } = requestValue;
  const pricedAt = '2026-08-24T17:59:50.000Z';
  const observations: readonly StablecoinPriceObservation[] = [
    {
      asset,
      sourceId: 'PYTH_CORE',
      sourceReference: STABLECOIN_VALUATION_FEED_REFERENCES[asset.stablecoin].PYTH_CORE,
      sourceSequence: '1',
      sourceUpdateId: '1'.repeat(64),
      pricedAt,
      observedAt: evaluatedAt,
      usdRateMantissa: '100000000',
      usdRateScale: 8,
      confidence: { kind: 'PUBLISHED_ABSOLUTE_USD', mantissa: '0', scale: 8 },
    },
    {
      asset,
      sourceId: 'CHAINLINK_DATA_FEEDS',
      sourceReference: STABLECOIN_VALUATION_FEED_REFERENCES[asset.stablecoin].CHAINLINK_DATA_FEEDS,
      sourceSequence: '1',
      sourceUpdateId: '1',
      pricedAt,
      observedAt: evaluatedAt,
      usdRateMantissa: '100000000',
      usdRateScale: 8,
      confidence: { kind: 'NOT_PUBLISHED' },
    },
  ];
  return {
    snapshotId: `http-price-${asset.stablecoin}-${asset.networkId.replace(':', '-')}`,
    observations,
    sourceWatermarks: STABLECOIN_VALUATION_FIRST_USE_WATERMARKS,
  };
}

function expectPrivate(response: request.Response): void {
  expect(response.headers).toMatchObject({
    'cache-control': 'private, no-store',
    vary: 'Cookie, Origin',
  });
}

describe('unified portfolio HTTP boundary (e2e)', () => {
  let app: INestApplication;
  let walletReader: { readActiveWalletRegistrations: jest.Mock };
  let balanceReader: { readCurrentBalances: jest.Mock };
  let priceReader: { readPriceEvidence: jest.Mock };

  beforeAll(async () => {
    walletReader = {
      readActiveWalletRegistrations: jest.fn(),
    };
    balanceReader = {
      readCurrentBalances: jest.fn(),
    };
    priceReader = {
      readPriceEvidence: jest.fn(),
    };
    const resolver: CurrentPrincipalResolver = {
      resolve(value: unknown) {
        const authorization = (value as { headers?: { authorization?: unknown } }).headers
          ?.authorization;
        return authorization === 'Bearer local-portfolio-fixture'
          ? { accountId: ACCOUNT_ID }
          : null;
      },
    };
    const portfolioClock: PortfolioClock = {
      now: () => new Date(EVALUATED_AT),
    };
    const module = await Test.createTestingModule({
      controllers: [PortfolioController],
      providers: [
        AccountAuthGuard,
        PortfolioPrivacyInterceptor,
        PortfolioService,
        { provide: CURRENT_PRINCIPAL_RESOLVER, useValue: resolver },
        {
          provide: PORTFOLIO_WALLET_REGISTRATION_READER,
          useValue: walletReader satisfies PortfolioWalletRegistrationReader,
        },
        {
          provide: PORTFOLIO_BALANCE_READER,
          useValue: balanceReader satisfies PortfolioBalanceReader,
        },
        {
          provide: PORTFOLIO_PRICE_EVIDENCE_READER,
          useValue: priceReader satisfies PortfolioPriceEvidenceReader,
        },
        { provide: PORTFOLIO_CLOCK, useValue: portfolioClock },
        { provide: PORTFOLIO_TIMER_RUNTIME, useValue: SYSTEM_PORTFOLIO_TIMER_RUNTIME },
      ],
    }).compile();

    app = module.createNestApplication();
    configureApplication(app, {
      requestLogger: new StructuredLogger({
        environment: { APPLICATION_WORKLOAD: 'api', NODE_ENV: 'test' },
        sink: () => undefined,
      }),
    });
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    walletReader.readActiveWalletRegistrations.mockResolvedValue(ACTIVE_WALLETS);
    balanceReader.readCurrentBalances.mockResolvedValue(balanceSnapshot());
    priceReader.readPriceEvidence.mockImplementation(
      async (requestValue: ReadPortfolioPriceEvidenceRequest) => priceEvidence(requestValue),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('authenticates before reading balances and keeps failures private', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/portfolio')
      .set('X-Account-ID', ACCOUNT_ID)
      .expect(401);

    expectPrivate(response);
    expect(response.body).toEqual({
      error: 'Unauthorized',
      message: 'Authentication required',
      statusCode: 401,
    });
    expect(walletReader.readActiveWalletRegistrations).not.toHaveBeenCalled();
    expect(balanceReader.readCurrentBalances).not.toHaveBeenCalled();
    expect(priceReader.readPriceEvidence).not.toHaveBeenCalled();
  });

  it('returns the exact $11,000 total and source attribution for only the principal', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/portfolio')
      .set('Authorization', 'Bearer local-portfolio-fixture')
      .set('X-Account-ID', OTHER_ACCOUNT_ID)
      .query({ accountId: OTHER_ACCOUNT_ID })
      .expect(200);

    expectPrivate(response);
    expect(response.body).toMatchObject({
      schemaVersion: 1,
      asOf: EVALUATED_AT,
      balanceCoverage: {
        status: 'COMPLETE',
        targets: ACTIVE_WALLETS.map((wallet) => ({ ...wallet, status: 'COMPLETE' })),
      },
      overallTotal: {
        usdValue: {
          mantissa: '11000000000000000000000',
          scale: 18,
          decimal: '11000.000000000000000000',
        },
        completeness: 'COMPLETE',
        freshnessClass: 'CURRENT',
        sourceCount: 3,
      },
      walletTotals: [
        { walletId: WALLET_A, usdValue: { decimal: '5000.000000000000000000' } },
        { walletId: WALLET_B, usdValue: { decimal: '3500.000000000000000000' } },
        { walletId: WALLET_C, usdValue: { decimal: '2500.000000000000000000' } },
      ],
      reportingUse: 'CONSERVATIVE_REPORTING_ONLY',
      mayIncreaseBuyingPower: false,
      mayAuthorizeFinancialUse: false,
    });
    expect(response.body.sources).toHaveLength(3);
    expect(JSON.stringify(response.body)).not.toContain(ACCOUNT_ID);
    expect(JSON.stringify(response.body)).not.toContain(OTHER_ACCOUNT_ID);
    expect(balanceReader.readCurrentBalances).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      evaluatedAt: EVALUATED_AT,
      correlationId: expect.stringMatching(CORRELATION_ID),
      expectedWallets: ACTIVE_WALLETS,
      signal: expect.any(AbortSignal),
    } satisfies ReadPortfolioBalancesRequest);
  });

  it('returns exact per-wallet network coverage for a partial 200 response', async () => {
    const snapshot = balanceSnapshot();
    const expectedCoverage = {
      status: 'PARTIAL' as const,
      targets: ACTIVE_WALLETS.map((wallet) => ({
        ...wallet,
        status: wallet.walletId === WALLET_C ? ('UNAVAILABLE' as const) : ('COMPLETE' as const),
      })),
    };
    balanceReader.readCurrentBalances.mockResolvedValueOnce({
      ...snapshot,
      coverage: expectedCoverage,
      observations: snapshot.observations.filter(({ walletId }) => walletId !== WALLET_C),
    });

    const response = await request(app.getHttpServer())
      .get('/api/v1/portfolio')
      .set('Authorization', 'Bearer local-portfolio-fixture')
      .expect(200);

    expectPrivate(response);
    expect(response.body.balanceCoverage).toEqual(expectedCoverage);
    expect(response.body.overallTotal).toMatchObject({
      usdValue: { decimal: '8500.000000000000000000' },
      freshnessClass: 'UNAVAILABLE',
      completeness: 'PARTIAL',
      sourceCount: 2,
      includedSourceCount: 2,
    });
  });

  it('maps dependency failure to one generic retryable response without leaking its cause', async () => {
    balanceReader.readCurrentBalances.mockRejectedValueOnce(
      new Error('unsafe-detail-marker and wallet address'),
    );

    const response = await request(app.getHttpServer())
      .get('/api/v1/portfolio')
      .set('Authorization', 'Bearer local-portfolio-fixture')
      .expect(503);

    expectPrivate(response);
    expect(response.headers['retry-after']).toBe('1');
    expect(response.body).toEqual({
      error: 'Service Unavailable',
      message: 'Portfolio unavailable',
      statusCode: 503,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/unsafe-detail-marker|wallet address/iu);
  });

  it('publishes the exact authenticated reporting contract in OpenAPI', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/docs-json').expect(200);
    const endpoint = response.body.paths['/api/v1/portfolio'].get;

    expect(endpoint.security).toEqual([{ sessionCookie: [] }]);
    expect(endpoint.responses['200'].content['application/json'].schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: expect.arrayContaining([
        'overallTotal',
        'balanceCoverage',
        'walletTotals',
        'chainTotals',
        'assetTotals',
        'sources',
        'excludedSources',
      ]),
    });
    expect(
      endpoint.responses['200'].content['application/json'].schema.properties.balanceCoverage,
    ).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['status', 'targets'],
      properties: {
        status: { type: 'string', enum: ['COMPLETE', 'PARTIAL', 'UNAVAILABLE'] },
        targets: {
          type: 'array',
          maxItems: 32,
          uniqueItems: true,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['walletId', 'networkId', 'status'],
          },
        },
      },
    });
    expect(endpoint.responses).toHaveProperty('401');
    expect(endpoint.responses).toHaveProperty('503');
  });
});
