import { parseAccountId } from '../../accounts/domain/account-profile';
import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import {
  MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_USE,
  MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_VERSION,
  type MainnetProviderPositionChainAssessmentVerifierPort,
} from '../../mainnet-platforms/domain/mainnet-provider-position-chain-assessment';
import {
  MAINNET_PROVIDER_POSITION_COVERAGE_ONLY,
  MAINNET_PROVIDER_POSITION_COVERAGE_VERSION,
  mainnetProviderPositionCoverageManifestFingerprintV1,
} from '../../mainnet-platforms/domain/mainnet-provider-position-coverage';
import {
  MAINNET_PROVIDER_POSITION_OBSERVATION_USE,
  MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
} from '../../mainnet-platforms/domain/mainnet-provider-position-observation';
import {
  MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_USE,
  MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION,
  mainnetProviderPositionObservationPolicyFingerprintV1,
} from '../../mainnet-platforms/domain/mainnet-provider-position-observation-policy';
import {
  MainnetProviderPortfolioUnavailableError,
  composeMainnetProviderPortfolioV1,
  type ComposeMainnetProviderPortfolioRequestV1,
  type MainnetProviderPortfolioUnavailableCode,
} from './mainnet-provider-portfolio-composition';

const REGISTRY = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
const ACCOUNT_ID = parseAccountId('99999999-9999-4999-8999-999999999999');
const WALLET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ETHEREUM_USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const AAVE_MARKET = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2';
const CAPTURED_AT = '2026-09-04T17:00:00.000Z';
const OBSERVED_AT = '2026-09-04T16:59:45.000Z';
const ASSESSED_AT = '2026-09-04T16:59:50.000Z';
const STALE_AFTER = '2026-09-04T17:00:15.000Z';
const EVALUATED_AT = '2026-09-04T17:00:10.000Z';
const POSITION_SNAPSHOT_ID = 'positions-20260904-170000';
const WALLET_SNAPSHOT_ID = 'wallet-balances-20260904-170000';
const EVM_BLOCK_HASH = `0x${'ab'.repeat(32)}`;
const EXPECTED_WALLETS = Object.freeze([
  Object.freeze({ walletId: WALLET_ID, networkId: 'eip155:1' }),
]);
const TRUSTED_ASSESSMENTS = new WeakSet<object>();
const VERIFIER: MainnetProviderPositionChainAssessmentVerifierPort = Object.freeze({
  verify: (capability: unknown): boolean =>
    typeof capability === 'object' && capability !== null && TRUSTED_ASSESSMENTS.has(capability),
});

function policyContent(): Record<string, unknown> {
  return {
    policyVersion: MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION,
    use: MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_USE,
    policyId: 'composition-test-policy-v1',
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
                networkId: 'eip155:1',
                marketId: AAVE_MARKET,
                assets: [{ stablecoin: 'USDC', identity: ETHEREUM_USDC }],
              },
            ],
          },
        ],
      },
    ],
    sources: [
      {
        sourceId: 'ethereum-rpc-primary',
        sourceKind: 'RPC',
        networkId: 'eip155:1',
      },
    ],
  };
}

function policy(): Record<string, unknown> {
  const content = policyContent();
  return {
    ...content,
    fingerprintSha256: mainnetProviderPositionObservationPolicyFingerprintV1(content),
  };
}

function providerObservation(
  positionKind: 'SUPPLY' | 'BORROW',
  atomic: string,
  observationId: string,
  positionId: string,
): Record<string, unknown> {
  return {
    observationId,
    walletId: WALLET_ID,
    providerId: 'aave',
    protocolId: 'aave-v3',
    marketId: AAVE_MARKET,
    positionId,
    positionKind,
    asset: {
      stablecoin: 'USDC',
      networkId: 'eip155:1',
      identity: ETHEREUM_USDC,
      decimals: 6,
    },
    balance: {
      atomic,
      decimal: `${atomic.slice(0, -6) || '0'}.${atomic.slice(-6).padStart(6, '0')}`,
    },
    source: {
      sourceId: 'ethereum-rpc-primary',
      sourceKind: 'RPC',
      sourceObservationId: `ethereum-block-50000001-${positionKind.toLowerCase()}`,
      chainAnchor: {
        kind: 'EVM_BLOCK',
        blockNumber: '50000001',
        blockHash: EVM_BLOCK_HASH,
      },
    },
    observedAt: OBSERVED_AT,
    staleAfter: STALE_AFTER,
    freshnessClass: 'CURRENT',
  };
}

function defaultPositions(): readonly Record<string, unknown>[] {
  return [
    providerObservation(
      'SUPPLY',
      '5000000',
      '11111111-1111-4111-8111-111111111111',
      'aave-ethereum-usdc-supply',
    ),
    providerObservation(
      'BORROW',
      '3000000',
      '22222222-2222-4222-8222-222222222222',
      'aave-ethereum-usdc-borrow',
    ),
  ];
}

function assessmentEntry(observation: Record<string, unknown>): Record<string, unknown> {
  const source = observation.source as Record<string, unknown>;
  return {
    observationId: observation.observationId,
    sourceId: source.sourceId,
    sourceKind: source.sourceKind,
    sourceObservationId: source.sourceObservationId,
    networkId: 'eip155:1',
    chainAnchor: source.chainAnchor,
    assessedAt: ASSESSED_AT,
    identityStatus: 'VERIFIED',
    progressionStatus: 'CURRENT',
    finalityStatus: 'HEALTHY',
  };
}

function assessment(
  observations: readonly Record<string, unknown>[],
  observationPolicy: Record<string, unknown>,
): Record<string, unknown> {
  const value = {
    assessmentVersion: MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_VERSION,
    use: MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_USE,
    mayAuthorizeFinancialAction: false,
    assessmentId: 'composition-chain-assessment-v1',
    observationPolicyFingerprintSha256: observationPolicy.fingerprintSha256,
    assetRegistryVersion: REGISTRY.version,
    assetRegistryFingerprintSha256: REGISTRY.fingerprintSha256,
    entries: observations.map(assessmentEntry),
  };
  TRUSTED_ASSESSMENTS.add(value);
  return value;
}

function coverageManifest(
  positionCount: number,
  observationPolicy: Record<string, unknown>,
): Record<string, unknown> {
  const content = {
    coverageVersion: MAINNET_PROVIDER_POSITION_COVERAGE_VERSION,
    use: MAINNET_PROVIDER_POSITION_COVERAGE_ONLY,
    mayAuthorizeFinancialAction: false,
    manifestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    accountId: ACCOUNT_ID,
    positionSnapshotId: POSITION_SNAPSHOT_ID,
    observationPolicyVersion: MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION,
    observationPolicyId: observationPolicy.policyId,
    observationPolicyFingerprintSha256: observationPolicy.fingerprintSha256,
    assetRegistryVersion: REGISTRY.version,
    assetRegistryFingerprintSha256: REGISTRY.fingerprintSha256,
    capturedAt: CAPTURED_AT,
    staleAfter: STALE_AFTER,
    freshnessClass: 'CURRENT',
    targets: [
      {
        walletId: WALLET_ID,
        providerId: 'aave',
        protocolId: 'aave-v3',
        marketId: AAVE_MARKET,
        networkId: 'eip155:1',
        assets: [{ stablecoin: 'USDC', identity: ETHEREUM_USDC }],
        sourceIds: ['ethereum-rpc-primary'],
        status: 'COMPLETE',
        divergenceStatus: 'AGREED',
        positionCount,
        observedAt: OBSERVED_AT,
        staleAfter: STALE_AFTER,
      },
    ],
  };
  const coverageContext = {
    accountId: ACCOUNT_ID,
    evaluatedAt: EVALUATED_AT,
    expectedWallets: EXPECTED_WALLETS,
    observationPolicy,
  };
  return {
    ...content,
    fingerprintSha256: mainnetProviderPositionCoverageManifestFingerprintV1(
      content,
      coverageContext,
    ),
  };
}

function positionSnapshot(
  observations: readonly Record<string, unknown>[],
  observationPolicy: Record<string, unknown>,
): Record<string, unknown> {
  return {
    schemaVersion: MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
    use: MAINNET_PROVIDER_POSITION_OBSERVATION_USE,
    mayAuthorizeFinancialAction: false,
    snapshotId: POSITION_SNAPSHOT_ID,
    observationPolicyVersion: MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION,
    observationPolicyId: observationPolicy.policyId,
    observationPolicyFingerprintSha256: observationPolicy.fingerprintSha256,
    assetRegistryVersion: REGISTRY.version,
    assetRegistryFingerprintSha256: REGISTRY.fingerprintSha256,
    capturedAt: CAPTURED_AT,
    staleAfter: STALE_AFTER,
    freshnessClass: 'CURRENT',
    observations,
  };
}

function walletSnapshot(
  amountAtomic = '10000000',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    snapshotId: WALLET_SNAPSHOT_ID,
    capturedAt: CAPTURED_AT,
    freshnessClass: 'CURRENT',
    coverage: {
      status: 'COMPLETE',
      targets: [
        {
          walletId: WALLET_ID,
          networkId: 'eip155:1',
          status: 'COMPLETE',
        },
      ],
    },
    observations: [
      {
        observationId: '33333333-3333-4333-8333-333333333333',
        walletId: WALLET_ID,
        networkId: 'eip155:1',
        assetIdentity: ETHEREUM_USDC,
        amountAtomic,
        observedAt: OBSERVED_AT,
        freshnessClass: 'CURRENT',
      },
    ],
    ...overrides,
  };
}

function composeRequest(
  observations: readonly Record<string, unknown>[] = defaultPositions(),
  balanceSnapshot: unknown = walletSnapshot(),
): ComposeMainnetProviderPortfolioRequestV1 {
  const observationPolicy = policy();
  return {
    accountId: ACCOUNT_ID,
    evaluatedAt: EVALUATED_AT,
    expectedWallets: EXPECTED_WALLETS,
    observationPolicy,
    coverageManifest: coverageManifest(observations.length, observationPolicy),
    positionSnapshot: positionSnapshot(observations, observationPolicy),
    chainAssessment: assessment(observations, observationPolicy),
    chainAssessmentVerifier: VERIFIER,
    walletBalanceSnapshot: balanceSnapshot,
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function expectUnavailable(
  operation: () => unknown,
  code: MainnetProviderPortfolioUnavailableCode,
): void {
  let captured: unknown;
  try {
    operation();
  } catch (error) {
    captured = error;
  }

  expect(captured).toBeInstanceOf(MainnetProviderPortfolioUnavailableError);
  expect((captured as MainnetProviderPortfolioUnavailableError).code).toBe(code);
  expect((captured as Error).message).toBe(
    'Mainnet provider portfolio composition is unavailable.',
  );
}

describe('conservative mainnet provider portfolio composition', () => {
  it('counts liquid and supplied assets once and treats borrow only as liability', () => {
    const result = composeMainnetProviderPortfolioV1(composeRequest());
    const usdc = result.assetTotals.find(
      (total) =>
        total.walletId === WALLET_ID &&
        total.asset.networkId === 'eip155:1' &&
        total.asset.stablecoin === 'USDC',
    );

    expect(usdc).toEqual({
      walletId: WALLET_ID,
      asset: {
        stablecoin: 'USDC',
        networkId: 'eip155:1',
        identity: ETHEREUM_USDC,
        decimals: 6,
      },
      liquidWalletBalance: { atomic: '10000000', decimal: '10' },
      suppliedBalance: { atomic: '5000000', decimal: '5' },
      borrowedLiability: { atomic: '3000000', decimal: '3' },
      grossAssets: { atomic: '15000000', decimal: '15' },
      netPosition: { signedAtomic: '12000000', signedDecimal: '12' },
      supplyPositionCount: 1,
      borrowPositionCount: 1,
    });
    expect(result.providerPositions).toHaveLength(2);
    expect(
      result.providerPositions.map(({ providerId, marketId, positionId, positionKind }) => ({
        providerId,
        marketId,
        positionId,
        positionKind,
      })),
    ).toEqual([
      {
        providerId: 'aave',
        marketId: AAVE_MARKET,
        positionId: 'aave-ethereum-usdc-borrow',
        positionKind: 'BORROW',
      },
      {
        providerId: 'aave',
        marketId: AAVE_MARKET,
        positionId: 'aave-ethereum-usdc-supply',
        positionKind: 'SUPPLY',
      },
    ]);
    expect(result.mayIncreaseBuyingPower).toBe(false);
    expect(result.mayAuthorizeFinancialAction).toBe(false);
    expect(Object.isFrozen(result.assetTotals)).toBe(true);
    expect(Object.isFrozen(usdc)).toBe(true);
  });

  it('keeps a liability-driven net position negative without clipping it to zero', () => {
    const positions = [
      providerObservation(
        'BORROW',
        '3000000',
        '22222222-2222-4222-8222-222222222222',
        'aave-ethereum-usdc-borrow',
      ),
    ];
    const result = composeMainnetProviderPortfolioV1(
      composeRequest(positions, walletSnapshot('1000000')),
    );
    const usdc = result.assetTotals.find((total) => total.asset.stablecoin === 'USDC');

    expect(usdc?.grossAssets).toEqual({ atomic: '1000000', decimal: '1' });
    expect(usdc?.netPosition).toEqual({
      signedAtomic: '-2000000',
      signedDecimal: '-2',
    });
  });

  it('seeds explicit zero totals for active wallet assets absent from both sources', () => {
    const result = composeMainnetProviderPortfolioV1(composeRequest());
    const usdt = result.assetTotals.find(
      (total) =>
        total.walletId === WALLET_ID &&
        total.asset.networkId === 'eip155:1' &&
        total.asset.stablecoin === 'USDT',
    );

    expect(usdt?.liquidWalletBalance.atomic).toBe('0');
    expect(usdt?.suppliedBalance.atomic).toBe('0');
    expect(usdt?.borrowedLiability.atomic).toBe('0');
    expect(usdt?.netPosition.signedAtomic).toBe('0');
  });

  it('rejects duplicate observation identity across wallet and provider sources', () => {
    const balance = walletSnapshot();
    const observations = balance.observations as Array<Record<string, unknown>>;
    const first = observations[0];
    if (first === undefined) throw new Error('fixture observation missing');
    first.observationId = '11111111-1111-4111-8111-111111111111';

    expectUnavailable(
      () => composeMainnetProviderPortfolioV1(composeRequest(defaultPositions(), balance)),
      'CROSS_SOURCE_DUPLICATE',
    );
  });

  it('rejects stale or incomplete wallet coverage instead of using partial balances', () => {
    const stale = walletSnapshot('10000000', {
      freshnessClass: 'STALE',
    });
    expectUnavailable(
      () => composeMainnetProviderPortfolioV1(composeRequest(defaultPositions(), stale)),
      'WALLET_BALANCE_UNAVAILABLE',
    );

    const incomplete = walletSnapshot();
    incomplete.coverage = {
      status: 'PARTIAL',
      targets: [
        {
          walletId: WALLET_ID,
          networkId: 'eip155:1',
          status: 'PARTIAL',
        },
      ],
    };
    expectUnavailable(
      () => composeMainnetProviderPortfolioV1(composeRequest(defaultPositions(), incomplete)),
      'WALLET_BALANCE_UNAVAILABLE',
    );
  });

  it('rejects unsupported assets and wallet/network substitution', () => {
    const unsupported = walletSnapshot();
    const unsupportedObservation = (unsupported.observations as Array<Record<string, unknown>>)[0];
    if (unsupportedObservation === undefined) {
      throw new Error('fixture observation missing');
    }
    unsupportedObservation.assetIdentity = '0x1111111111111111111111111111111111111111';
    expectUnavailable(
      () => composeMainnetProviderPortfolioV1(composeRequest(defaultPositions(), unsupported)),
      'ASSET_MISMATCH',
    );

    const wrongWallet = clone(walletSnapshot());
    const wrongWalletObservation = (wrongWallet.observations as Array<Record<string, unknown>>)[0];
    if (wrongWalletObservation === undefined) {
      throw new Error('fixture observation missing');
    }
    wrongWalletObservation.walletId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    expectUnavailable(
      () => composeMainnetProviderPortfolioV1(composeRequest(defaultPositions(), wrongWallet)),
      'WALLET_BALANCE_UNAVAILABLE',
    );
  });

  it('rejects a provider position attributed to a different account wallet', () => {
    const positions = clone(defaultPositions());
    const firstPosition = positions[0];
    if (firstPosition === undefined) throw new Error('fixture position missing');
    firstPosition.walletId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

    expectUnavailable(
      () => composeMainnetProviderPortfolioV1(composeRequest(positions)),
      'PROVIDER_COVERAGE_UNAVAILABLE',
    );
  });

  it('rejects forged provider coverage and an unauthenticated chain assessment', () => {
    const crossAccount = composeRequest();
    const manifest = clone(crossAccount.coverageManifest as Record<string, unknown>);
    manifest.accountId = '88888888-8888-4888-8888-888888888888';
    expectUnavailable(
      () =>
        composeMainnetProviderPortfolioV1({
          ...crossAccount,
          coverageManifest: manifest,
        }),
      'PROVIDER_COVERAGE_UNAVAILABLE',
    );

    const untrusted = composeRequest();
    expectUnavailable(
      () =>
        composeMainnetProviderPortfolioV1({
          ...untrusted,
          chainAssessment: clone(untrusted.chainAssessment),
        }),
      'PROVIDER_COVERAGE_UNAVAILABLE',
    );
  });
});
