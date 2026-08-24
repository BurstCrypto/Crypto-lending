import { createHash } from 'node:crypto';

import {
  YIELD_OPPORTUNITY_SCHEMA_VERSION,
  YieldOpportunityValidationError,
  divideYieldDecimalByPowerOfTen,
  normalizeYieldOpportunityV1,
  yieldDecimalFromString,
  yieldDecimalToString,
  type NormalizedYieldOpportunityV1,
} from '../../domain/normalized-yield-opportunity';
import {
  YIELD_DISCOVERY_ADAPTER_VERSION,
  type YieldDiscoveryAdapterV1,
  type YieldDiscoveryPageV1,
  type YieldDiscoveryRequestV1,
} from './yield-discovery-adapter.port';

const API_PROVIDER_FIXTURE = Object.freeze({
  opportunity_key: 'api-market-usdc-001',
  provider: Object.freeze({ slug: 'fixture-api', display_name: 'Fixture API' }),
  protocol: Object.freeze({ slug: 'lending-one', display_name: 'Lending One' }),
  market_address: '0x1111111111111111111111111111111111111111',
  network: Object.freeze({ caip2: 'eip155:1', display_name: 'Ethereum Mainnet' }),
  token: Object.freeze({
    ticker: 'USDC',
    address: '0xA0b86991c6218b36c1d19d4a2e9eb0cE3606eB48',
    decimals: 6,
  }),
  metrics: Object.freeze({
    apy_ratio: '0.0523456789012345678900',
    utilization_percent: '83.3333333333333333333300',
    tvl_usd: '123456789.123456789012345678',
    immediately_withdrawable_usdc: '456789.000001',
    measured_at: '2026-08-24T14:15:16.123Z',
  }),
  fee_schedule: Object.freeze([
    Object.freeze({ name: 'Manager fee', category: 'management', percent: '12.5000' }),
    Object.freeze({
      name: 'Withdrawal processing',
      category: 'withdrawal',
      amount_usdc: '0.123456',
    }),
  ] as const),
  bounds: Object.freeze({
    minimum_deposit_usdc: '0.000001',
    maximum_deposit_usdc: '999999.999999',
  }),
  state: Object.freeze({ deposits: true, withdrawals: true, code: 'online' }),
  trace: Object.freeze({
    response_id: 'response-api-00000000000000000001',
    endpoint: 'fixture://api/v2/opportunities/api-market-usdc-001',
    sequence: '900719925474099312345678901',
  }),
});

const CHAIN_PROVIDER_FIXTURE = Object.freeze({
  venueCode: 'fixture-chain-indexer',
  venueName: 'Fixture Chain Indexer',
  pool: Object.freeze({
    address: '0x2222222222222222222222222222222222222222',
    protocolCode: 'lending-two',
    protocolName: 'Lending Two',
  }),
  chainId: '8453',
  chainLabel: 'Base Mainnet',
  suppliedToken: Object.freeze({
    symbol: 'USDC',
    contractId: '0x833589fCD6eDb6E08f4c7C32D4f71b54bDa02913',
    precision: '6',
  }),
  apyBps: '523.4567890123456789012345',
  utilizationPpm: '876543',
  tvlUsdMicros: '987654321012345678901234',
  withdrawableAtomic: '123456789012345678901',
  sourceTime: '2026-08-24T14:16:17.234Z',
  charges: Object.freeze({ performanceBps: '1500.1250' }),
  constraints: Object.freeze({ minDepositAtomic: '1000001', capacityAtomic: '888888888888888888' }),
  flags: Object.freeze({ acceptsDeposits: true, acceptsWithdrawals: false, status: 'queued_exit' }),
  provenance: Object.freeze({
    blockNumber: '18446744073709551617001',
    logIndex: '4294967297001',
    queryId: 'chain-query-00000000000000000002',
  }),
});

const REQUEST: YieldDiscoveryRequestV1 = Object.freeze({
  requestedAt: '2026-08-24T14:20:00.000Z',
  cursor: null,
});

function payloadSha256(value: object): string {
  const serialized = JSON.stringify(value);
  if (!serialized) throw new Error('fixture must be JSON serializable');
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}

function apiFixtureOpportunity(request: YieldDiscoveryRequestV1): NormalizedYieldOpportunityV1 {
  const fixture = API_PROVIDER_FIXTURE;
  const measuredAt = fixture.metrics.measured_at;
  return normalizeYieldOpportunityV1({
    schemaVersion: YIELD_OPPORTUNITY_SCHEMA_VERSION,
    opportunityId: `${fixture.provider.slug}:${fixture.opportunity_key}`,
    provider: { id: fixture.provider.slug, name: fixture.provider.display_name },
    protocol: {
      id: fixture.protocol.slug,
      name: fixture.protocol.display_name,
      marketId: fixture.market_address,
    },
    asset: {
      symbol: fixture.token.ticker,
      contract: fixture.token.address,
      decimals: fixture.token.decimals,
    },
    chain: { id: fixture.network.caip2, name: fixture.network.display_name },
    apy: { rate: yieldDecimalFromString(fixture.metrics.apy_ratio), asOf: measuredAt },
    tvl: {
      amount: { value: yieldDecimalFromString(fixture.metrics.tvl_usd), denomination: 'USD' },
      asOf: measuredAt,
    },
    utilization: {
      rate: divideYieldDecimalByPowerOfTen(
        yieldDecimalFromString(fixture.metrics.utilization_percent),
        2,
      ),
      asOf: measuredAt,
    },
    exitLiquidity: {
      amount: {
        value: yieldDecimalFromString(fixture.metrics.immediately_withdrawable_usdc),
        denomination: 'ASSET',
      },
      asOf: measuredAt,
    },
    fees: {
      status: 'REPORTED',
      entries: [
        {
          kind: 'MANAGEMENT',
          label: fixture.fee_schedule[0].name,
          charge: {
            kind: 'RATE',
            rate: divideYieldDecimalByPowerOfTen(
              yieldDecimalFromString(fixture.fee_schedule[0].percent),
              2,
            ),
          },
        },
        {
          kind: 'WITHDRAWAL',
          label: fixture.fee_schedule[1].name,
          charge: {
            kind: 'AMOUNT',
            amount: {
              value: yieldDecimalFromString(fixture.fee_schedule[1].amount_usdc),
              denomination: 'ASSET',
            },
          },
        },
      ],
    },
    limits: {
      status: 'REPORTED',
      entries: [
        {
          kind: 'MINIMUM_DEPOSIT',
          amount: {
            value: yieldDecimalFromString(fixture.bounds.minimum_deposit_usdc),
            denomination: 'ASSET',
          },
        },
        {
          kind: 'MAXIMUM_DEPOSIT',
          amount: {
            value: yieldDecimalFromString(fixture.bounds.maximum_deposit_usdc),
            denomination: 'ASSET',
          },
        },
      ],
    },
    availability: {
      status: 'AVAILABLE',
      depositsEnabled: fixture.state.deposits,
      withdrawalsEnabled: fixture.state.withdrawals,
      asOf: measuredAt,
      reasonCodes: [],
    },
    provenance: {
      sourceKind: 'API',
      sourceId: fixture.trace.response_id,
      sourceReference: fixture.trace.endpoint,
      sourceObservedAt: measuredAt,
      retrievedAt: request.requestedAt,
      payloadSha256: payloadSha256(fixture),
      normalizerId: 'fixture-api-normalizer',
      normalizerVersion: '1.0.0',
      attributes: [
        { key: 'provider.sequence', value: fixture.trace.sequence },
        { key: 'provider.state_code', value: fixture.state.code },
        { key: 'provider.fee_categories', value: 'management,withdrawal' },
      ],
    },
  });
}

function chainFixtureOpportunity(request: YieldDiscoveryRequestV1): NormalizedYieldOpportunityV1 {
  const fixture = CHAIN_PROVIDER_FIXTURE;
  return normalizeYieldOpportunityV1({
    schemaVersion: YIELD_OPPORTUNITY_SCHEMA_VERSION,
    opportunityId: `${fixture.venueCode}:${fixture.chainId}:${fixture.pool.address}`,
    provider: { id: fixture.venueCode, name: fixture.venueName },
    protocol: {
      id: fixture.pool.protocolCode,
      name: fixture.pool.protocolName,
      marketId: fixture.pool.address,
    },
    asset: {
      symbol: fixture.suppliedToken.symbol,
      contract: fixture.suppliedToken.contractId,
      decimals: Number.parseInt(fixture.suppliedToken.precision, 10),
    },
    chain: { id: `eip155:${fixture.chainId}`, name: fixture.chainLabel },
    apy: {
      rate: divideYieldDecimalByPowerOfTen(yieldDecimalFromString(fixture.apyBps), 4),
      asOf: fixture.sourceTime,
    },
    tvl: {
      amount: {
        value: divideYieldDecimalByPowerOfTen(yieldDecimalFromString(fixture.tvlUsdMicros), 6),
        denomination: 'USD',
      },
      asOf: fixture.sourceTime,
    },
    utilization: {
      rate: divideYieldDecimalByPowerOfTen(yieldDecimalFromString(fixture.utilizationPpm), 6),
      asOf: fixture.sourceTime,
    },
    exitLiquidity: {
      amount: {
        value: divideYieldDecimalByPowerOfTen(
          yieldDecimalFromString(fixture.withdrawableAtomic),
          6,
        ),
        denomination: 'ASSET',
      },
      asOf: fixture.sourceTime,
    },
    fees: {
      status: 'REPORTED',
      entries: [
        {
          kind: 'PERFORMANCE',
          label: 'performance_bps',
          charge: {
            kind: 'RATE',
            rate: divideYieldDecimalByPowerOfTen(
              yieldDecimalFromString(fixture.charges.performanceBps),
              4,
            ),
          },
        },
      ],
    },
    limits: {
      status: 'REPORTED',
      entries: [
        {
          kind: 'MINIMUM_DEPOSIT',
          amount: {
            value: divideYieldDecimalByPowerOfTen(
              yieldDecimalFromString(fixture.constraints.minDepositAtomic),
              6,
            ),
            denomination: 'ASSET',
          },
        },
        {
          kind: 'REMAINING_CAPACITY',
          amount: {
            value: divideYieldDecimalByPowerOfTen(
              yieldDecimalFromString(fixture.constraints.capacityAtomic),
              6,
            ),
            denomination: 'ASSET',
          },
        },
      ],
    },
    availability: {
      status: 'LIMITED',
      depositsEnabled: fixture.flags.acceptsDeposits,
      withdrawalsEnabled: fixture.flags.acceptsWithdrawals,
      asOf: fixture.sourceTime,
      reasonCodes: ['WITHDRAWAL_QUEUE'],
    },
    provenance: {
      sourceKind: 'ON_CHAIN',
      sourceId: fixture.pool.address,
      sourceReference: `eip155:${fixture.chainId}:${fixture.pool.address}`,
      sourceObservedAt: fixture.sourceTime,
      retrievedAt: request.requestedAt,
      payloadSha256: payloadSha256(fixture),
      normalizerId: 'fixture-chain-normalizer',
      normalizerVersion: '1.0.0',
      attributes: [
        { key: 'chain.block_number', value: fixture.provenance.blockNumber },
        { key: 'chain.log_index', value: fixture.provenance.logIndex },
        { key: 'indexer.query_id', value: fixture.provenance.queryId },
        { key: 'provider.status', value: fixture.flags.status },
      ],
    },
  });
}

class ApiFixtureDiscoveryAdapter implements YieldDiscoveryAdapterV1 {
  readonly adapterVersion = YIELD_DISCOVERY_ADAPTER_VERSION;
  readonly opportunitySchemaVersion = YIELD_OPPORTUNITY_SCHEMA_VERSION;
  readonly providerId = API_PROVIDER_FIXTURE.provider.slug;

  async discover(request: YieldDiscoveryRequestV1): Promise<YieldDiscoveryPageV1> {
    return Object.freeze({
      adapterVersion: this.adapterVersion,
      opportunitySchemaVersion: this.opportunitySchemaVersion,
      providerId: this.providerId,
      discoveredAt: request.requestedAt,
      nextCursor: null,
      opportunities: Object.freeze([apiFixtureOpportunity(request)]),
    });
  }
}

class ChainFixtureDiscoveryAdapter implements YieldDiscoveryAdapterV1 {
  readonly adapterVersion = YIELD_DISCOVERY_ADAPTER_VERSION;
  readonly opportunitySchemaVersion = YIELD_OPPORTUNITY_SCHEMA_VERSION;
  readonly providerId = CHAIN_PROVIDER_FIXTURE.venueCode;

  async discover(request: YieldDiscoveryRequestV1): Promise<YieldDiscoveryPageV1> {
    return Object.freeze({
      adapterVersion: this.adapterVersion,
      opportunitySchemaVersion: this.opportunitySchemaVersion,
      providerId: this.providerId,
      discoveredAt: request.requestedAt,
      nextCursor: null,
      opportunities: Object.freeze([chainFixtureOpportunity(request)]),
    });
  }
}

function expectValidationCode(work: () => unknown, code: string): void {
  try {
    work();
    throw new Error('expected yield opportunity validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(YieldOpportunityValidationError);
    expect((error as YieldOpportunityValidationError).code).toBe(code);
  }
}

describe('versioned yield discovery adapter contract', () => {
  it('normalizes a decimal-string API fixture without precision or provenance loss', async () => {
    const adapter: YieldDiscoveryAdapterV1 = new ApiFixtureDiscoveryAdapter();
    const page = await adapter.discover(REQUEST);
    const opportunity = page.opportunities[0]!;

    expect(adapter.adapterVersion).toBe(1);
    expect(adapter.opportunitySchemaVersion).toBe(1);
    expect(page.adapterVersion).toBe(1);
    expect(page.opportunitySchemaVersion).toBe(1);
    expect(opportunity.schemaVersion).toBe(1);
    expect(opportunity.provider).toEqual({ id: 'fixture-api', name: 'Fixture API' });
    expect(opportunity.protocol.marketId).toBe(API_PROVIDER_FIXTURE.market_address);
    expect(opportunity.asset.contract).toBe(API_PROVIDER_FIXTURE.token.address);
    expect(opportunity.chain.id).toBe(API_PROVIDER_FIXTURE.network.caip2);
    expect(yieldDecimalToString(opportunity.apy.rate)).toBe(API_PROVIDER_FIXTURE.metrics.apy_ratio);
    expect(yieldDecimalToString(opportunity.tvl.amount.value)).toBe(
      API_PROVIDER_FIXTURE.metrics.tvl_usd,
    );
    expect(yieldDecimalToString(opportunity.utilization.rate)).toBe('0.833333333333333333333300');
    expect(yieldDecimalToString(opportunity.exitLiquidity.amount.value)).toBe(
      API_PROVIDER_FIXTURE.metrics.immediately_withdrawable_usdc,
    );
    expect(opportunity.apy.asOf).toBe(API_PROVIDER_FIXTURE.metrics.measured_at);
    expect(opportunity.fees.entries.map(({ label }) => label)).toEqual([
      'Manager fee',
      'Withdrawal processing',
    ]);
    expect(opportunity.limits.entries).toHaveLength(2);
    expect(opportunity.availability).toMatchObject({
      status: 'AVAILABLE',
      depositsEnabled: true,
      withdrawalsEnabled: true,
    });
    expect(opportunity.provenance).toMatchObject({
      sourceId: API_PROVIDER_FIXTURE.trace.response_id,
      sourceReference: API_PROVIDER_FIXTURE.trace.endpoint,
      sourceObservedAt: API_PROVIDER_FIXTURE.metrics.measured_at,
      retrievedAt: REQUEST.requestedAt,
      payloadSha256: payloadSha256(API_PROVIDER_FIXTURE),
    });
    expect(opportunity.provenance.attributes).toContainEqual({
      key: 'provider.sequence',
      value: API_PROVIDER_FIXTURE.trace.sequence,
    });
  });

  it('normalizes an atomic/on-chain fixture without precision or provenance loss', async () => {
    const adapter: YieldDiscoveryAdapterV1 = new ChainFixtureDiscoveryAdapter();
    const page = await adapter.discover(REQUEST);
    const opportunity = page.opportunities[0]!;

    expect(adapter.adapterVersion).toBe(1);
    expect(page.opportunitySchemaVersion).toBe(1);
    expect(page.providerId).toBe(CHAIN_PROVIDER_FIXTURE.venueCode);
    expect(opportunity.provider.id).toBe(CHAIN_PROVIDER_FIXTURE.venueCode);
    expect(opportunity.protocol.marketId).toBe(CHAIN_PROVIDER_FIXTURE.pool.address);
    expect(opportunity.asset.contract).toBe(CHAIN_PROVIDER_FIXTURE.suppliedToken.contractId);
    expect(opportunity.chain).toEqual({ id: 'eip155:8453', name: 'Base Mainnet' });
    expect(yieldDecimalToString(opportunity.apy.rate)).toBe('0.05234567890123456789012345');
    expect(yieldDecimalToString(opportunity.tvl.amount.value)).toBe('987654321012345678.901234');
    expect(yieldDecimalToString(opportunity.utilization.rate)).toBe('0.876543');
    expect(yieldDecimalToString(opportunity.exitLiquidity.amount.value)).toBe(
      '123456789012345.678901',
    );
    const performanceFee = opportunity.fees.entries[0]!.charge;
    expect(performanceFee.kind).toBe('RATE');
    if (performanceFee.kind !== 'RATE') throw new Error('expected rate fixture');
    expect(yieldDecimalToString(performanceFee.rate)).toBe('0.15001250');
    expect(yieldDecimalToString(opportunity.limits.entries[0]!.amount.value)).toBe('1.000001');
    expect(opportunity.availability).toMatchObject({
      status: 'LIMITED',
      depositsEnabled: true,
      withdrawalsEnabled: false,
      reasonCodes: ['WITHDRAWAL_QUEUE'],
    });
    expect(opportunity.provenance.payloadSha256).toBe(payloadSha256(CHAIN_PROVIDER_FIXTURE));
    expect(opportunity.provenance.attributes).toEqual([
      { key: 'chain.block_number', value: CHAIN_PROVIDER_FIXTURE.provenance.blockNumber },
      { key: 'chain.log_index', value: CHAIN_PROVIDER_FIXTURE.provenance.logIndex },
      { key: 'indexer.query_id', value: CHAIN_PROVIDER_FIXTURE.provenance.queryId },
      { key: 'provider.status', value: CHAIN_PROVIDER_FIXTURE.flags.status },
    ]);
  });

  it('returns deeply immutable normalized records', async () => {
    const page = await new ApiFixtureDiscoveryAdapter().discover(REQUEST);
    const opportunity = page.opportunities[0]!;

    for (const value of [
      page,
      page.opportunities,
      opportunity,
      opportunity.apy,
      opportunity.apy.rate,
      opportunity.fees,
      opportunity.fees.entries,
      opportunity.fees.entries[0]!,
      opportunity.provenance,
      opportunity.provenance.attributes,
      opportunity.provenance.attributes[0]!,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });

  it('rejects binary floats, ambiguous decimal text, invalid ratios, and altered provenance', () => {
    const valid = apiFixtureOpportunity(REQUEST);

    expectValidationCode(
      () =>
        normalizeYieldOpportunityV1({
          ...valid,
          apy: { ...valid.apy, rate: 0.05234567890123457 },
        }),
      'INVALID_APY',
    );
    expectValidationCode(() => yieldDecimalFromString('5.23e-2'), 'INVALID_DECIMAL');
    expectValidationCode(
      () =>
        normalizeYieldOpportunityV1({
          ...valid,
          utilization: { ...valid.utilization, rate: { mantissa: '1000001', scale: 6 } },
        }),
      'INVALID_UTILIZATION',
    );
    expectValidationCode(
      () =>
        normalizeYieldOpportunityV1({
          ...valid,
          provenance: { ...valid.provenance, payloadSha256: 'A'.repeat(64) },
        }),
      'INVALID_PROVENANCE',
    );
  });

  it('rejects extra fields, duplicate provenance keys, and accessor-bearing provider input', () => {
    const valid = apiFixtureOpportunity(REQUEST);
    expectValidationCode(
      () => normalizeYieldOpportunityV1({ ...valid, rawProviderPayload: API_PROVIDER_FIXTURE }),
      'INVALID_SCHEMA_VERSION',
    );
    expectValidationCode(
      () =>
        normalizeYieldOpportunityV1({
          ...valid,
          provenance: {
            ...valid.provenance,
            attributes: [
              ...valid.provenance.attributes,
              { key: 'provider.sequence', value: 'different' },
            ],
          },
        }),
      'INVALID_PROVENANCE',
    );

    const getter = jest.fn(() => API_PROVIDER_FIXTURE.trace.response_id);
    const accessorProvenance = { ...valid.provenance };
    Object.defineProperty(accessorProvenance, 'sourceId', { enumerable: true, get: getter });
    expectValidationCode(
      () => normalizeYieldOpportunityV1({ ...valid, provenance: accessorProvenance }),
      'INVALID_PROVENANCE',
    );
    expect(getter).not.toHaveBeenCalled();
  });
});
