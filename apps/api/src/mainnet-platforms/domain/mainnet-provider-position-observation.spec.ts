import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import {
  MAINNET_PROVIDER_POSITION_OBSERVATION_USE,
  MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
  MainnetProviderPositionValidationError,
  mainnetProviderPositionDecimalFromAtomic,
  parseMainnetProviderPositionSnapshotV1,
  type MainnetProviderPositionValidationCode,
} from './mainnet-provider-position-observation';
import {
  MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_USE,
  MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION,
  mainnetProviderPositionObservationPolicyFingerprintV1,
  parseMainnetProviderPositionObservationPolicyV1,
} from './mainnet-provider-position-observation-policy';
import {
  MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_USE,
  MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_VERSION,
  parseMainnetProviderPositionChainAssessmentV1,
  type MainnetProviderPositionChainAssessmentVerifierPort,
} from './mainnet-provider-position-chain-assessment';

const REGISTRY = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
const CAPTURED_AT = '2026-09-02T17:00:00.000Z';
const OBSERVED_AT = '2026-09-02T16:59:45.000Z';
const STALE_AFTER = '2026-09-02T17:00:15.000Z';
const EVALUATED_AT = '2026-09-02T17:00:10.000Z';
const SOLANA_OBSERVED_AT = '2026-09-02T16:59:55.000Z';
const SOLANA_STALE_AFTER = '2026-09-02T17:00:10.000Z';
const SOLANA_EVALUATED_AT = '2026-09-02T17:00:05.000Z';
const WALLET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const AAVE_BASE_MARKET = '0xa238dd80c259a72e81d7e4664a9801593f98d1c5';
const MORPHO_BASE_MARKET = `0x${'cd'.repeat(32)}`;
const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const EVM_BLOCK_HASH = `0x${'AB'.repeat(32)}`;
const TRUSTED_TEST_CHAIN_ASSESSMENTS = new WeakSet<object>();
const STRICT_TEST_CHAIN_ASSESSMENT_VERIFIER: MainnetProviderPositionChainAssessmentVerifierPort =
  Object.freeze({
    verify: (capability: unknown): boolean =>
      typeof capability === 'object' &&
      capability !== null &&
      TRUSTED_TEST_CHAIN_ASSESSMENTS.has(capability),
  });

function jsonCloneRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function strictTestPolicyContent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    policyVersion: MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION,
    use: MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_USE,
    policyId: 'strict-test-policy-v1',
    assetRegistryVersion: REGISTRY.version,
    assetRegistryFingerprintSha256: REGISTRY.fingerprintSha256,
    providers: [
      {
        providerId: 'aave',
        protocols: [
          {
            protocolId: 'aave-v3',
            markets: [
              {
                networkId: 'eip155:8453',
                marketId: AAVE_BASE_MARKET.toUpperCase().replace('0X', '0x'),
                assets: [{ stablecoin: 'USDC', identity: BASE_USDC }],
              },
            ],
          },
        ],
      },
      {
        providerId: 'morpho',
        protocols: [
          {
            protocolId: 'morpho-blue',
            markets: [
              {
                networkId: 'eip155:8453',
                marketId: MORPHO_BASE_MARKET.toUpperCase().replace('0X', '0x'),
                assets: [{ stablecoin: 'USDC', identity: BASE_USDC }],
              },
            ],
          },
        ],
      },
      {
        providerId: 'jupiter',
        protocols: [
          {
            protocolId: 'jupiter-lend',
            markets: [
              {
                networkId: SOLANA_MAINNET,
                marketId: 'JupiterUsdcEarnVault',
                assets: [
                  {
                    stablecoin: 'USDC',
                    identity: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    sources: [
      { sourceId: 'base-rpc-primary', sourceKind: 'RPC', networkId: 'eip155:8453' },
      { sourceId: 'solana-rpc-primary', sourceKind: 'RPC', networkId: SOLANA_MAINNET },
    ],
    ...overrides,
  };
}

function strictTestPolicy(contentOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  const content = strictTestPolicyContent(contentOverrides);
  return {
    ...content,
    fingerprintSha256: mainnetProviderPositionObservationPolicyFingerprintV1(content),
  };
}

function baseAsset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    stablecoin: 'USDC',
    networkId: 'eip155:8453',
    identity: BASE_USDC.toUpperCase().replace('0X', '0x'),
    decimals: 6,
    ...overrides,
  };
}

function evmSource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sourceId: 'base-rpc-primary',
    sourceKind: 'RPC',
    sourceObservationId: 'base-block-50000001',
    chainAnchor: {
      kind: 'EVM_BLOCK',
      blockNumber: '50000001',
      blockHash: EVM_BLOCK_HASH,
    },
    ...overrides,
  };
}

function observation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    observationId: '11111111-1111-4111-8111-111111111111',
    walletId: WALLET_ID,
    providerId: 'aave',
    protocolId: 'aave-v3',
    marketId: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    positionId: 'aave-base-usdc-supply',
    positionKind: 'SUPPLY',
    asset: baseAsset(),
    balance: { atomic: '5000000', decimal: '5.000000' },
    source: evmSource(),
    observedAt: OBSERVED_AT,
    staleAfter: STALE_AFTER,
    freshnessClass: 'CURRENT',
    ...overrides,
  };
}

function solanaObservation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return observation({
    providerId: 'jupiter',
    protocolId: 'jupiter-lend',
    marketId: 'JupiterUsdcEarnVault',
    positionId: 'JupiterWalletUsdcPosition',
    asset: {
      stablecoin: 'USDC',
      networkId: SOLANA_MAINNET,
      identity: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      decimals: 6,
    },
    source: {
      sourceId: 'solana-rpc-primary',
      sourceKind: 'RPC',
      sourceObservationId: 'solana-slot-441990796',
      chainAnchor: { kind: 'SOLANA_SLOT', slot: '441990796', root: '441990700' },
    },
    observedAt: SOLANA_OBSERVED_AT,
    staleAfter: SOLANA_STALE_AFTER,
    ...overrides,
  });
}

function baseAssessmentEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    observationId: '11111111-1111-4111-8111-111111111111',
    sourceId: 'base-rpc-primary',
    sourceKind: 'RPC',
    sourceObservationId: 'base-block-50000001',
    networkId: 'eip155:8453',
    chainAnchor: {
      kind: 'EVM_BLOCK',
      blockNumber: '50000001',
      blockHash: EVM_BLOCK_HASH,
    },
    assessedAt: '2026-09-02T16:59:50.000Z',
    identityStatus: 'VERIFIED',
    progressionStatus: 'CURRENT',
    finalityStatus: 'HEALTHY',
    ...overrides,
  };
}

function solanaAssessmentEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    observationId: '11111111-1111-4111-8111-111111111111',
    sourceId: 'solana-rpc-primary',
    sourceKind: 'RPC',
    sourceObservationId: 'solana-slot-441990796',
    networkId: SOLANA_MAINNET,
    chainAnchor: { kind: 'SOLANA_SLOT', slot: '441990796', root: '441990700' },
    assessedAt: '2026-09-02T16:59:58.000Z',
    identityStatus: 'VERIFIED',
    progressionStatus: 'CURRENT',
    finalityStatus: 'HEALTHY',
    ...overrides,
  };
}

function strictTestAssessment(
  entries: readonly unknown[] = [baseAssessmentEntry()],
  observationPolicy: Record<string, unknown> = strictTestPolicy(),
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const assessment = {
    assessmentVersion: MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_VERSION,
    use: MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_USE,
    mayAuthorizeFinancialAction: false,
    assessmentId: 'strict-test-chain-assessment-v1',
    observationPolicyFingerprintSha256: observationPolicy.fingerprintSha256,
    assetRegistryVersion: REGISTRY.version,
    assetRegistryFingerprintSha256: REGISTRY.fingerprintSha256,
    entries,
    ...overrides,
  };
  TRUSTED_TEST_CHAIN_ASSESSMENTS.add(assessment);
  return assessment;
}

function solanaSnapshot(observations: unknown): Record<string, unknown> {
  return snapshot(observations, { staleAfter: SOLANA_STALE_AFTER });
}

function snapshot(
  observations: unknown = [observation()],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const observationPolicy = strictTestPolicy();
  return {
    schemaVersion: MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
    use: MAINNET_PROVIDER_POSITION_OBSERVATION_USE,
    mayAuthorizeFinancialAction: false,
    snapshotId: 'mainnet-provider-positions-20260902-170000',
    observationPolicyVersion: MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION,
    observationPolicyId: 'strict-test-policy-v1',
    observationPolicyFingerprintSha256: observationPolicy.fingerprintSha256,
    assetRegistryVersion: REGISTRY.version,
    assetRegistryFingerprintSha256: REGISTRY.fingerprintSha256,
    capturedAt: CAPTURED_AT,
    staleAfter: STALE_AFTER,
    freshnessClass: 'CURRENT',
    observations,
    ...overrides,
  };
}

function expectValidationCode(
  value: unknown,
  code: MainnetProviderPositionValidationCode,
  evaluatedAt = EVALUATED_AT,
  observationPolicy: unknown = strictTestPolicy(),
  chainAssessment: unknown = strictTestAssessment(),
  chainAssessmentVerifier: MainnetProviderPositionChainAssessmentVerifierPort = STRICT_TEST_CHAIN_ASSESSMENT_VERIFIER,
): void {
  let captured: unknown;
  try {
    parseMainnetProviderPositionSnapshotV1(
      value,
      evaluatedAt,
      observationPolicy,
      chainAssessment,
      chainAssessmentVerifier,
    );
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(MainnetProviderPositionValidationError);
  expect((captured as MainnetProviderPositionValidationError).code).toBe(code);
  expect((captured as Error).message).toBe('mainnet provider position snapshot is invalid');
}

describe('mainnet provider position observation contract', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps two Base USDC positions at different providers as distinct observations', () => {
    const aave = observation();
    const morpho = observation({
      observationId: '22222222-2222-4222-8222-222222222222',
      providerId: 'morpho',
      protocolId: 'morpho-blue',
      marketId: `0x${'CD'.repeat(32)}`,
      positionId: 'morpho-base-usdc-supply',
      balance: { atomic: '7250000', decimal: '7.250000' },
      source: evmSource({ sourceObservationId: 'base-block-50000001-morpho' }),
    });

    const result = parseMainnetProviderPositionSnapshotV1(
      snapshot([morpho, aave]),
      EVALUATED_AT,
      strictTestPolicy(),
      strictTestAssessment([
        baseAssessmentEntry(),
        baseAssessmentEntry({
          observationId: '22222222-2222-4222-8222-222222222222',
          sourceObservationId: 'base-block-50000001-morpho',
        }),
      ]),
      STRICT_TEST_CHAIN_ASSESSMENT_VERIFIER,
    );

    expect(result.observations).toHaveLength(2);
    expect(result.observationPolicyFingerprintSha256).toBe(strictTestPolicy().fingerprintSha256);
    expect(result.observations.map(({ providerId }) => providerId)).toEqual(['aave', 'morpho']);
    expect(result.observations.map(({ asset }) => asset)).toEqual([
      {
        stablecoin: 'USDC',
        networkId: 'eip155:8453',
        identity: BASE_USDC,
        decimals: 6,
      },
      {
        stablecoin: 'USDC',
        networkId: 'eip155:8453',
        identity: BASE_USDC,
        decimals: 6,
      },
    ]);
    expect(result.observations.map(({ balance }) => balance)).toEqual([
      { atomic: '5000000', decimal: '5.000000' },
      { atomic: '7250000', decimal: '7.250000' },
    ]);
    expect(new Set(result.observations.map(({ positionId }) => positionId)).size).toBe(2);
  });

  it('normalizes EVM identities and returns only deeply immutable copied data', () => {
    const inputObservation = observation();
    const input = snapshot([inputObservation]);

    const result = parseMainnetProviderPositionSnapshotV1(
      input,
      EVALUATED_AT,
      strictTestPolicy(),
      strictTestAssessment(),
      STRICT_TEST_CHAIN_ASSESSMENT_VERIFIER,
    );
    const parsed = result.observations[0];

    expect(parsed).toMatchObject({
      marketId: '0xa238dd80c259a72e81d7e4664a9801593f98d1c5',
      asset: { identity: BASE_USDC },
      source: { chainAnchor: { blockHash: EVM_BLOCK_HASH.toLowerCase() } },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.observations)).toBe(true);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed?.asset)).toBe(true);
    expect(Object.isFrozen(parsed?.balance)).toBe(true);
    expect(Object.isFrozen(parsed?.source)).toBe(true);
    expect(Object.isFrozen(parsed?.source.chainAnchor)).toBe(true);

    inputObservation.providerId = 'attacker';
    expect(parsed?.providerId).toBe('aave');
    expect(JSON.stringify(result)).not.toMatch(
      /transaction|calldata|instruction|signature|destination|allowance/iu,
    );
  });

  it('rejects a repeated provider-position composite key even with a new observation ID', () => {
    const duplicate = observation({
      observationId: '22222222-2222-4222-8222-222222222222',
      balance: { atomic: '6000000', decimal: '6.000000' },
      source: evmSource({ sourceObservationId: 'base-block-50000002' }),
    });

    expectValidationCode(
      snapshot([observation(), duplicate]),
      'DUPLICATE_POSITION',
      EVALUATED_AT,
      strictTestPolicy(),
      strictTestAssessment([
        baseAssessmentEntry(),
        baseAssessmentEntry({
          observationId: '22222222-2222-4222-8222-222222222222',
          sourceObservationId: 'base-block-50000002',
        }),
      ]),
    );
  });

  it('keeps supply and borrow legs distinct when a protocol reuses one position identifier', () => {
    const borrow = observation({
      observationId: '22222222-2222-4222-8222-222222222222',
      positionKind: 'BORROW',
      balance: { atomic: '1250000', decimal: '1.250000' },
      source: evmSource({ sourceObservationId: 'base-block-50000002-borrow' }),
    });
    const result = parseMainnetProviderPositionSnapshotV1(
      snapshot([observation(), borrow]),
      EVALUATED_AT,
      strictTestPolicy(),
      strictTestAssessment([
        baseAssessmentEntry(),
        baseAssessmentEntry({
          observationId: '22222222-2222-4222-8222-222222222222',
          sourceObservationId: 'base-block-50000002-borrow',
        }),
      ]),
      STRICT_TEST_CHAIN_ASSESSMENT_VERIFIER,
    );

    expect(result.observations.map(({ positionKind }) => positionKind)).toEqual([
      'BORROW',
      'SUPPLY',
    ]);
    expect(new Set(result.observations.map(({ positionId }) => positionId)).size).toBe(1);
  });

  it('rejects a repeated observation identity even when the provider position differs', () => {
    const second = observation({
      providerId: 'morpho',
      protocolId: 'morpho-blue',
      marketId: `0x${'CD'.repeat(32)}`,
      positionId: 'morpho-base-usdc-supply',
    });

    expectValidationCode(snapshot([observation(), second]), 'DUPLICATE_OBSERVATION');
  });

  it('derives exact decimal text without using JavaScript financial numbers', () => {
    expect(mainnetProviderPositionDecimalFromAtomic('0', 6)).toBe('0.000000');
    expect(mainnetProviderPositionDecimalFromAtomic('1', 6)).toBe('0.000001');
    expect(mainnetProviderPositionDecimalFromAtomic('1234567890123456789012345', 6)).toBe(
      '1234567890123456789.012345',
    );

    for (const balance of [
      { atomic: 5_000_000, decimal: '5.000000' },
      { atomic: '05000000', decimal: '5.000000' },
      { atomic: '5000000', decimal: 5 },
      { atomic: '5000000', decimal: '5' },
      {
        atomic: '115792089237316195423570985008687907853269984665640564039457584007913129639936',
        decimal: '115792089237316195423570985008687907853269984665640564039457584007913129.639936',
      },
    ]) {
      expectValidationCode(snapshot([observation({ balance })]), 'INVALID_BALANCE');
    }
  });

  it('uses uint256 for EVM atomic balances and uint64 for Solana atomic balances', () => {
    const evmMaximum =
      '115792089237316195423570985008687907853269984665640564039457584007913129639935';
    const evmResult = parseMainnetProviderPositionSnapshotV1(
      snapshot([
        observation({
          balance: {
            atomic: evmMaximum,
            decimal: mainnetProviderPositionDecimalFromAtomic(evmMaximum, 6),
          },
        }),
      ]),
      EVALUATED_AT,
      strictTestPolicy(),
      strictTestAssessment(),
      STRICT_TEST_CHAIN_ASSESSMENT_VERIFIER,
    );
    expect(evmResult.observations[0]?.balance.atomic).toBe(evmMaximum);
    expectValidationCode(
      snapshot([
        observation({
          balance: {
            atomic:
              '115792089237316195423570985008687907853269984665640564039457584007913129639936',
            decimal:
              '115792089237316195423570985008687907853269984665640564039457584007913129.639936',
          },
        }),
      ]),
      'INVALID_BALANCE',
    );

    const solanaMaximum = '18446744073709551615';
    const solanaResult = parseMainnetProviderPositionSnapshotV1(
      solanaSnapshot([
        solanaObservation({
          balance: {
            atomic: solanaMaximum,
            decimal: mainnetProviderPositionDecimalFromAtomic(solanaMaximum, 6),
          },
        }),
      ]),
      SOLANA_EVALUATED_AT,
      strictTestPolicy(),
      strictTestAssessment([solanaAssessmentEntry()]),
      STRICT_TEST_CHAIN_ASSESSMENT_VERIFIER,
    );
    expect(solanaResult.observations[0]?.balance.atomic).toBe(solanaMaximum);
    expectValidationCode(
      solanaSnapshot([
        solanaObservation({
          balance: {
            atomic: '18446744073709551616',
            decimal: '18446744073709.551616',
          },
        }),
      ]),
      'INVALID_BALANCE',
      SOLANA_EVALUATED_AT,
      strictTestPolicy(),
      strictTestAssessment([solanaAssessmentEntry()]),
      STRICT_TEST_CHAIN_ASSESSMENT_VERIFIER,
    );
  });

  it('pins every asset to an active versioned mainnet registry identity and exact decimals', () => {
    expectValidationCode(
      snapshot([observation({ asset: baseAsset({ decimals: 18 }) })]),
      'INVALID_ASSET',
    );
    expectValidationCode(
      snapshot([
        observation({
          asset: baseAsset({
            networkId: 'eip155:84532',
            identity: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
          }),
        }),
      ]),
      'INVALID_ASSET',
    );
    expectValidationCode(
      snapshot([observation()], { assetRegistryFingerprintSha256: '0'.repeat(64) }),
      'INVALID_SNAPSHOT',
    );
  });

  it('rejects an active asset that is not approved for the exact provider market', () => {
    const usdtOnUsdcMarket = solanaObservation({
      asset: {
        stablecoin: 'USDT',
        networkId: SOLANA_MAINNET,
        identity: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        decimals: 6,
      },
    });

    expectValidationCode(
      solanaSnapshot([usdtOnUsdcMarket]),
      'UNAPPROVED_ATTRIBUTION',
      SOLANA_EVALUATED_AT,
      strictTestPolicy(),
      strictTestAssessment([solanaAssessmentEntry()]),
      STRICT_TEST_CHAIN_ASSESSMENT_VERIFIER,
    );
  });

  it('supports canonical Solana slot/root evidence without weakening the source identity', () => {
    const result = parseMainnetProviderPositionSnapshotV1(
      solanaSnapshot([solanaObservation()]),
      SOLANA_EVALUATED_AT,
      strictTestPolicy(),
      strictTestAssessment([solanaAssessmentEntry()]),
      STRICT_TEST_CHAIN_ASSESSMENT_VERIFIER,
    );

    expect(result.observations[0]?.source).toEqual({
      sourceId: 'solana-rpc-primary',
      sourceKind: 'RPC',
      sourceObservationId: 'solana-slot-441990796',
      chainAnchor: { kind: 'SOLANA_SLOT', slot: '441990796', root: '441990700' },
    });
  });

  it('requires chain-appropriate, exact-string source anchors', () => {
    for (const source of [
      evmSource({
        chainAnchor: { kind: 'EVM_BLOCK', blockNumber: 50_000_001, blockHash: EVM_BLOCK_HASH },
      }),
      evmSource({
        chainAnchor: {
          kind: 'EVM_BLOCK',
          blockNumber: '50000001',
          blockHash: `0x${'0'.repeat(64)}`,
        },
      }),
      evmSource({ chainAnchor: { kind: 'SOLANA_SLOT', slot: '10', root: '9' } }),
      evmSource({ sourceKind: 'UNAPPROVED_SOURCE' }),
      evmSource({ sourceId: 'not canonical' }),
    ]) {
      expectValidationCode(snapshot([observation({ source })]), 'INVALID_SOURCE');
    }
  });

  it('requires an opaque independent assessment bound to the exact normalized observation', () => {
    const currentCapability = strictTestAssessment();
    const seenObservationFingerprints: string[] = [];
    const contextCheckingVerifier: MainnetProviderPositionChainAssessmentVerifierPort = {
      verify: jest.fn((capability, context) => {
        seenObservationFingerprints.push(context.observationFingerprintSha256);
        return (
          capability === currentCapability &&
          context.observationPolicyFingerprintSha256 === strictTestPolicy().fingerprintSha256 &&
          context.snapshotId === 'mainnet-provider-positions-20260902-170000' &&
          context.observationId === '11111111-1111-4111-8111-111111111111' &&
          context.walletId === WALLET_ID &&
          context.providerId === 'aave' &&
          context.protocolId === 'aave-v3' &&
          context.marketId === AAVE_BASE_MARKET &&
          context.positionId === 'aave-base-usdc-supply' &&
          context.positionKind === 'SUPPLY' &&
          context.stablecoin === 'USDC' &&
          context.assetIdentity === BASE_USDC &&
          context.assetDecimals === 6 &&
          context.balanceAtomic === '5000000' &&
          context.balanceDecimal === '5.000000' &&
          context.sourceObservationId === 'base-block-50000001' &&
          context.networkId === 'eip155:8453' &&
          context.observationTier === 'PROVISIONAL' &&
          context.selector === 'latest' &&
          context.authority === 'DISPLAY_ONLY' &&
          context.chainAnchor.kind === 'EVM_BLOCK' &&
          context.chainAnchor.blockNumber === '50000001' &&
          /^[0-9a-f]{64}$/u.test(context.observationFingerprintSha256) &&
          context.mayAuthorizeFinancialAction === false
        );
      }),
    };
    expect(
      parseMainnetProviderPositionSnapshotV1(
        snapshot(),
        EVALUATED_AT,
        strictTestPolicy(),
        currentCapability,
        contextCheckingVerifier,
      ).freshnessClass,
    ).toBe('CURRENT');
    expect(contextCheckingVerifier.verify).toHaveBeenCalledTimes(1);
    expectValidationCode(
      snapshot([observation({ balance: { atomic: '6000000', decimal: '6.000000' } })]),
      'INVALID_CHAIN_ASSESSMENT',
      EVALUATED_AT,
      strictTestPolicy(),
      currentCapability,
      contextCheckingVerifier,
    );
    expect(seenObservationFingerprints).toHaveLength(2);
    expect(seenObservationFingerprints[1]).not.toBe(seenObservationFingerprints[0]);

    const blockOneSource = evmSource({
      sourceObservationId: 'base-block-1',
      chainAnchor: { kind: 'EVM_BLOCK', blockNumber: '1', blockHash: EVM_BLOCK_HASH },
    });
    const blockOneObservation = observation({ source: blockOneSource });
    const matchingBlockAssessment = baseAssessmentEntry({
      sourceObservationId: 'base-block-1',
      chainAnchor: { kind: 'EVM_BLOCK', blockNumber: '1', blockHash: EVM_BLOCK_HASH },
    });

    for (const assessment of [
      strictTestAssessment([]),
      strictTestAssessment([baseAssessmentEntry()]),
      strictTestAssessment([
        baseAssessmentEntry({
          ...matchingBlockAssessment,
          identityStatus: 'FAILED',
        }),
      ]),
      strictTestAssessment([
        baseAssessmentEntry({
          ...matchingBlockAssessment,
          progressionStatus: 'UNAVAILABLE',
        }),
      ]),
      strictTestAssessment([
        baseAssessmentEntry({
          ...matchingBlockAssessment,
          finalityStatus: 'QUARANTINED',
        }),
      ]),
    ]) {
      expectValidationCode(
        snapshot([blockOneObservation]),
        'INVALID_CHAIN_ASSESSMENT',
        EVALUATED_AT,
        strictTestPolicy(),
        assessment,
        STRICT_TEST_CHAIN_ASSESSMENT_VERIFIER,
      );
    }

    const trustedCapability = strictTestAssessment([matchingBlockAssessment]);
    const untrustedCopy = jsonCloneRecord(trustedCapability);
    expect(parseMainnetProviderPositionChainAssessmentV1(untrustedCopy).assessmentId).toBe(
      'strict-test-chain-assessment-v1',
    );
    expectValidationCode(
      snapshot([blockOneObservation]),
      'INVALID_CHAIN_ASSESSMENT',
      EVALUATED_AT,
      strictTestPolicy(),
      untrustedCopy,
      STRICT_TEST_CHAIN_ASSESSMENT_VERIFIER,
    );
    expectValidationCode(
      snapshot([blockOneObservation]),
      'INVALID_CHAIN_ASSESSMENT',
      EVALUATED_AT,
      strictTestPolicy(),
      trustedCapability,
      { verify: () => false },
    );

    const slotOneObservation = solanaObservation({
      source: {
        sourceId: 'solana-rpc-primary',
        sourceKind: 'RPC',
        sourceObservationId: 'solana-slot-1',
        chainAnchor: { kind: 'SOLANA_SLOT', slot: '1', root: '1' },
      },
    });
    for (const assessment of [
      strictTestAssessment([]),
      strictTestAssessment([solanaAssessmentEntry()]),
      strictTestAssessment([
        solanaAssessmentEntry({
          sourceObservationId: 'solana-slot-1',
          chainAnchor: { kind: 'SOLANA_SLOT', slot: '1', root: '1' },
          finalityStatus: 'UNAVAILABLE',
        }),
      ]),
    ]) {
      expectValidationCode(
        solanaSnapshot([slotOneObservation]),
        'INVALID_CHAIN_ASSESSMENT',
        SOLANA_EVALUATED_AT,
        strictTestPolicy(),
        assessment,
        STRICT_TEST_CHAIN_ASSESSMENT_VERIFIER,
      );
    }
  });

  it('requires an immutable versioned policy and rejects unapproved attribution', () => {
    const policyInput = strictTestPolicy();
    const policy = parseMainnetProviderPositionObservationPolicyV1(policyInput);

    expect(policy).toMatchObject({
      policyVersion: 1,
      use: 'MAINNET_PROVIDER_POSITION_OBSERVATION_APPROVALS',
      policyId: 'strict-test-policy-v1',
    });
    expect(policy.providers[0]?.protocols[0]?.markets[0]?.marketId).toBe(AAVE_BASE_MARKET);
    expect(
      policy.providers.find(({ providerId }) => providerId === 'morpho')?.protocols[0]?.markets[0]
        ?.marketId,
    ).toBe(MORPHO_BASE_MARKET);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.providers)).toBe(true);
    expect(Object.isFrozen(policy.providers[0])).toBe(true);
    expect(Object.isFrozen(policy.providers[0]?.protocols)).toBe(true);
    expect(Object.isFrozen(policy.providers[0]?.protocols[0]?.markets)).toBe(true);
    expect(Object.isFrozen(policy.sources)).toBe(true);

    const rawProviders = policyInput.providers as Array<Record<string, unknown>>;
    rawProviders[0]!.providerId = 'changed-after-parse';
    expect(policy.providers[0]?.providerId).toBe('aave');

    for (const unapproved of [
      observation({ providerId: 'compound' }),
      observation({ protocolId: 'aave-v4' }),
      observation({ marketId: `0x${'ef'.repeat(32)}` }),
      observation({ source: evmSource({ sourceId: 'base-rpc-secondary' }) }),
      observation({ source: evmSource({ sourceKind: 'INDEXER' }) }),
      observation({ source: evmSource({ sourceId: 'solana-rpc-primary' }) }),
    ]) {
      expectValidationCode(snapshot([unapproved]), 'UNAPPROVED_ATTRIBUTION');
    }

    expectValidationCode(
      snapshot(undefined, { observationPolicyId: 'different-policy' }),
      'INVALID_SNAPSHOT',
    );
    expectValidationCode(snapshot(), 'INVALID_POLICY', EVALUATED_AT, null);
    expectValidationCode(snapshot(), 'INVALID_POLICY', EVALUATED_AT, {
      ...strictTestPolicy(),
      extra: true,
    });

    const policyWithArrayProperty = strictTestPolicy();
    Object.defineProperty(policyWithArrayProperty.providers as unknown[], 'extra', {
      value: true,
      enumerable: true,
    });
    expectValidationCode(snapshot(), 'INVALID_POLICY', EVALUATED_AT, policyWithArrayProperty);
    const policyWithAccessor = strictTestPolicy();
    Object.defineProperty(
      (policyWithAccessor.sources as Array<Record<string, unknown>>)[0]!,
      'sourceId',
      { enumerable: true, get: () => 'base-rpc-primary' },
    );
    expectValidationCode(snapshot(), 'INVALID_POLICY', EVALUATED_AT, policyWithAccessor);
    expectValidationCode(
      snapshot(),
      'INVALID_POLICY',
      EVALUATED_AT,
      new Proxy(strictTestPolicy(), {
        ownKeys: () => {
          throw new Error('proxy trap');
        },
      }),
    );
  });

  it('binds snapshots to a canonical fingerprint of sorted normalized policy content', () => {
    const originalContent = strictTestPolicyContent();
    const originalFingerprint =
      mainnetProviderPositionObservationPolicyFingerprintV1(originalContent);
    const reorderedContent = jsonCloneRecord(originalContent);
    reorderedContent.providers = [
      ...(reorderedContent.providers as Array<Record<string, unknown>>),
    ].reverse();
    reorderedContent.sources = [
      ...(reorderedContent.sources as Array<Record<string, unknown>>),
    ].reverse();
    expect(mainnetProviderPositionObservationPolicyFingerprintV1(reorderedContent)).toBe(
      originalFingerprint,
    );

    const changedContent = jsonCloneRecord(originalContent);
    const providers = changedContent.providers as Array<Record<string, unknown>>;
    const jupiter = providers.find(({ providerId }) => providerId === 'jupiter')!;
    const protocols = jupiter.protocols as Array<Record<string, unknown>>;
    const markets = protocols[0]!.markets as Array<Record<string, unknown>>;
    const assets = markets[0]!.assets as Array<Record<string, unknown>>;
    assets.push({
      stablecoin: 'USDT',
      identity: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    });
    const changedFingerprint =
      mainnetProviderPositionObservationPolicyFingerprintV1(changedContent);
    expect(changedFingerprint).not.toBe(originalFingerprint);
    const changedPolicy = {
      ...changedContent,
      fingerprintSha256: changedFingerprint,
    };

    expectValidationCode(
      snapshot(),
      'INVALID_SNAPSHOT',
      EVALUATED_AT,
      changedPolicy,
      strictTestAssessment(undefined, changedPolicy),
      STRICT_TEST_CHAIN_ASSESSMENT_VERIFIER,
    );
    expectValidationCode(
      snapshot(undefined, { observationPolicyFingerprintSha256: '0'.repeat(64) }),
      'INVALID_SNAPSHOT',
    );
    expectValidationCode(snapshot(), 'INVALID_POLICY', EVALUATED_AT, {
      ...strictTestPolicy(),
      fingerprintSha256: originalFingerprint.toUpperCase(),
    });

    const tamperedPolicy = jsonCloneRecord(strictTestPolicy());
    const tamperedSources = tamperedPolicy.sources as Array<Record<string, unknown>>;
    tamperedSources[0]!.sourceKind = 'INDEXER';
    expectValidationCode(snapshot(), 'INVALID_POLICY', EVALUATED_AT, tamperedPolicy);

    const parsed = parseMainnetProviderPositionObservationPolicyV1(strictTestPolicy());
    expect(parsed.fingerprintSha256).toBe(originalFingerprint);
    expect(Object.isFrozen(parsed.providers[0]?.protocols[0]?.markets[0]?.assets)).toBe(true);
  });

  it('enforces an aggregate policy parsing budget across nested approvals', () => {
    const providers = Array.from({ length: 9 }, (_, providerIndex) => ({
      providerId: `provider-${providerIndex}`,
      protocols: Array.from({ length: 32 }, (_, protocolIndex) => ({
        protocolId: `protocol-${protocolIndex}`,
        markets: [
          {
            networkId: 'eip155:8453',
            marketId: AAVE_BASE_MARKET,
            assets: [{ stablecoin: 'USDC', identity: BASE_USDC }],
          },
        ],
      })),
    }));

    expect(() =>
      mainnetProviderPositionObservationPolicyFingerprintV1(
        strictTestPolicyContent({
          providers,
          sources: [{ sourceId: 'base-rpc-primary', sourceKind: 'RPC', networkId: 'eip155:8453' }],
        }),
      ),
    ).toThrow('aggregate protocol approval budget');
  });

  it('validates freshness against the server clock and the conservative snapshot deadline', () => {
    const stale = snapshot([observation({ freshnessClass: 'STALE' })], { freshnessClass: 'STALE' });
    const result = parseMainnetProviderPositionSnapshotV1(
      stale,
      STALE_AFTER,
      strictTestPolicy(),
      strictTestAssessment(),
      STRICT_TEST_CHAIN_ASSESSMENT_VERIFIER,
    );

    expect(result.freshnessClass).toBe('STALE');
    expect(result.observations[0]?.freshnessClass).toBe('STALE');
    expectValidationCode(snapshot(), 'INVALID_FRESHNESS', STALE_AFTER);
    const sourceDeadlineIsCapped = parseMainnetProviderPositionSnapshotV1(
      snapshot([observation({ staleAfter: '2027-09-02T17:00:00.000Z' })]),
      EVALUATED_AT,
      strictTestPolicy(),
      strictTestAssessment(),
      STRICT_TEST_CHAIN_ASSESSMENT_VERIFIER,
    );
    expect(sourceDeadlineIsCapped.observations[0]?.staleAfter).toBe(STALE_AFTER);
    expectValidationCode(snapshot(), 'INVALID_FRESHNESS', '2026-09-02T16:59:59.999Z');
  });

  it('rejects year-old observations and year-long snapshot deadlines', () => {
    expectValidationCode(
      snapshot([
        observation({
          observedAt: '2025-09-02T17:00:00.000Z',
          staleAfter: '2027-09-02T17:00:00.000Z',
        }),
      ]),
      'INVALID_FRESHNESS',
    );
    expectValidationCode(
      snapshot([observation({ staleAfter: '2027-09-02T17:00:00.000Z' })], {
        staleAfter: '2027-09-02T17:00:00.000Z',
      }),
      'INVALID_FRESHNESS',
    );
  });

  it('retains bounded stale data and makes snapshot freshness use the earliest deadline', () => {
    const morpho = observation({
      observationId: '22222222-2222-4222-8222-222222222222',
      providerId: 'morpho',
      protocolId: 'morpho-blue',
      marketId: MORPHO_BASE_MARKET,
      positionId: 'morpho-base-usdc-supply',
      observedAt: '2026-09-02T16:58:00.000Z',
      staleAfter: '2027-09-02T17:00:00.000Z',
      freshnessClass: 'STALE',
    });
    const result = parseMainnetProviderPositionSnapshotV1(
      snapshot([observation(), morpho], { freshnessClass: 'STALE' }),
      EVALUATED_AT,
      strictTestPolicy(),
      strictTestAssessment([
        baseAssessmentEntry(),
        baseAssessmentEntry({
          observationId: '22222222-2222-4222-8222-222222222222',
        }),
      ]),
      STRICT_TEST_CHAIN_ASSESSMENT_VERIFIER,
    );

    expect(result.staleAfter).toBe('2026-09-02T16:58:30.000Z');
    expect(result.freshnessClass).toBe('STALE');
    expect(result.observations.map(({ freshnessClass }) => freshnessClass)).toEqual([
      'CURRENT',
      'STALE',
    ]);
    expectValidationCode(
      snapshot(
        [
          observation({
            observedAt: '2026-09-02T16:55:00.000Z',
            staleAfter: '2027-09-02T17:00:00.000Z',
            freshnessClass: 'STALE',
          }),
        ],
        { freshnessClass: 'STALE' },
      ),
      'INVALID_FRESHNESS',
    );
  });

  it('rejects extra properties, accessors, sparse arrays, and the wrong safety contract', () => {
    expectValidationCode(snapshot(undefined, { extra: true }), 'INVALID_SNAPSHOT');
    expectValidationCode(
      snapshot([observation({ transaction: 'forbidden' })]),
      'INVALID_OBSERVATION',
    );
    expectValidationCode(
      snapshot(undefined, { mayAuthorizeFinancialAction: true }),
      'INVALID_SNAPSHOT',
    );

    const accessorObservation = observation();
    Object.defineProperty(accessorObservation, 'providerId', {
      enumerable: true,
      get: jest.fn(() => 'aave'),
    });
    expectValidationCode(snapshot([accessorObservation]), 'INVALID_OBSERVATION');

    const sparse = new Array<unknown>(1);
    expectValidationCode(snapshot(sparse), 'INVALID_SNAPSHOT');
  });

  it('rejects empty snapshots until completeness evidence is modeled', () => {
    expectValidationCode(snapshot([]), 'INVALID_SNAPSHOT');
    expectValidationCode(
      snapshot([], { staleAfter: CAPTURED_AT, freshnessClass: 'STALE' }),
      'INVALID_SNAPSHOT',
    );
  });
});
