import { parseAccountId } from '../../accounts/domain/account-profile';
import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import {
  MAINNET_PROVIDER_POSITION_OBSERVATION_USE,
  MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
} from './mainnet-provider-position-observation';
import {
  MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_USE,
  MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION,
  mainnetProviderPositionObservationPolicyFingerprintV1,
} from './mainnet-provider-position-observation-policy';
import {
  MAINNET_PROVIDER_POSITION_COVERAGE_ONLY,
  MAINNET_PROVIDER_POSITION_COVERAGE_VERSION,
  MainnetProviderPositionCoverageUnavailableError,
  mainnetProviderPositionCoverageManifestFingerprintV1,
  parseCoveredMainnetProviderPositionSnapshotV1,
  parseMainnetProviderPositionCoverageManifestV1,
  type MainnetProviderPositionCoverageUnavailableCode,
} from './mainnet-provider-position-coverage';

const REGISTRY = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
const ACCOUNT_ID = parseAccountId('99999999-9999-4999-8999-999999999999');
const EVM_WALLET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SOLANA_WALLET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ETHEREUM_USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const AAVE_MARKET = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2';
const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const CAPTURED_AT = '2026-09-04T17:00:00.000Z';
const EVALUATED_AT = '2026-09-04T17:00:05.000Z';
const STALE_AFTER = '2026-09-04T17:00:10.000Z';
const POSITION_SNAPSHOT_ID = 'positions-20260904-170000';

const EXPECTED_WALLETS = Object.freeze([
  Object.freeze({ walletId: EVM_WALLET_ID, networkId: 'eip155:1' }),
  Object.freeze({ walletId: SOLANA_WALLET_ID, networkId: SOLANA_MAINNET }),
]);

function policyContent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    policyVersion: MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION,
    use: MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_USE,
    policyId: 'coverage-test-policy-v1',
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
      {
        providerId: 'jupiter',
        protocols: [
          {
            protocolId: 'jupiter-lend',
            markets: [
              {
                networkId: SOLANA_MAINNET,
                marketId: 'JupiterUsdcEarnVault',
                assets: [{ stablecoin: 'USDC', identity: SOLANA_USDC }],
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
      {
        sourceId: 'solana-rpc-primary',
        sourceKind: 'RPC',
        networkId: SOLANA_MAINNET,
      },
    ],
    ...overrides,
  };
}

function policy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const content = policyContent(overrides);
  return {
    ...content,
    fingerprintSha256: mainnetProviderPositionObservationPolicyFingerprintV1(content),
  };
}

function coverageTargets(): readonly Record<string, unknown>[] {
  return [
    {
      walletId: EVM_WALLET_ID,
      providerId: 'aave',
      protocolId: 'aave-v3',
      marketId: AAVE_MARKET,
      networkId: 'eip155:1',
      assets: [{ stablecoin: 'USDC', identity: ETHEREUM_USDC }],
      sourceIds: ['ethereum-rpc-primary'],
      status: 'COMPLETE',
      divergenceStatus: 'AGREED',
      positionCount: 0,
      observedAt: '2026-09-04T16:59:55.000Z',
      staleAfter: '2026-09-04T17:00:15.000Z',
    },
    {
      walletId: SOLANA_WALLET_ID,
      providerId: 'jupiter',
      protocolId: 'jupiter-lend',
      marketId: 'JupiterUsdcEarnVault',
      networkId: SOLANA_MAINNET,
      assets: [{ stablecoin: 'USDC', identity: SOLANA_USDC }],
      sourceIds: ['solana-rpc-primary'],
      status: 'COMPLETE',
      divergenceStatus: 'AGREED',
      positionCount: 0,
      observedAt: '2026-09-04T16:59:58.000Z',
      staleAfter: STALE_AFTER,
    },
  ];
}

function context(observationPolicy: unknown = policy()): {
  accountId: typeof ACCOUNT_ID;
  evaluatedAt: string;
  expectedWallets: unknown;
  observationPolicy: unknown;
} {
  return {
    accountId: ACCOUNT_ID,
    evaluatedAt: EVALUATED_AT,
    expectedWallets: EXPECTED_WALLETS,
    observationPolicy,
  };
}

function coverageContent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const observationPolicy = policy();
  return {
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
    targets: coverageTargets(),
    ...overrides,
  };
}

function coverageManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const content = coverageContent(overrides);
  return {
    ...content,
    fingerprintSha256: mainnetProviderPositionCoverageManifestFingerprintV1(content, context()),
  };
}

function emptyPositionSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const observationPolicy = policy();
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
    observations: [],
    ...overrides,
  };
}

function clone(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function expectUnavailable(
  operation: () => unknown,
  code: MainnetProviderPositionCoverageUnavailableCode,
): void {
  let captured: unknown;
  try {
    operation();
  } catch (error) {
    captured = error;
  }

  expect(captured).toBeInstanceOf(MainnetProviderPositionCoverageUnavailableError);
  expect((captured as MainnetProviderPositionCoverageUnavailableError).code).toBe(code);
  expect((captured as Error).message).toBe('Mainnet provider-position coverage is unavailable.');
}

describe('mainnet provider position exact coverage', () => {
  it('permits an immutable honest zero only with every exact target COMPLETE', () => {
    const result = parseCoveredMainnetProviderPositionSnapshotV1({
      ...context(),
      coverageManifest: coverageManifest(),
      positionSnapshot: emptyPositionSnapshot(),
    });

    expect(result.observations).toEqual([]);
    expect(result.coverageManifest.targets).toHaveLength(2);
    expect(
      result.coverageManifest.targets.every(
        (target) =>
          target.status === 'COMPLETE' &&
          target.divergenceStatus === 'AGREED' &&
          target.positionCount === 0,
      ),
    ).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.coverageManifest.targets)).toBe(true);
  });

  it.each([
    ['PARTIAL', 'INCOMPLETE_TARGET'],
    ['UNAVAILABLE', 'INCOMPLETE_TARGET'],
    ['STALE', 'INCOMPLETE_TARGET'],
  ] as const)('rejects a %s target instead of interpreting it as zero', (status, expectedCode) => {
    const input = clone(coverageManifest());
    ((input.targets as Array<Record<string, unknown>>)[0] as Record<string, unknown>).status =
      status;
    expectUnavailable(
      () => parseMainnetProviderPositionCoverageManifestV1(input, context()),
      expectedCode,
    );
  });

  it('rejects missing, extra, and duplicate coverage targets', () => {
    const missing = clone(coverageManifest());
    (missing.targets as unknown[]).pop();
    expectUnavailable(
      () => parseMainnetProviderPositionCoverageManifestV1(missing, context()),
      'MISSING_TARGET',
    );

    const duplicate = clone(coverageManifest());
    (duplicate.targets as unknown[]).push(clone((duplicate.targets as unknown[])[0]));
    expectUnavailable(
      () => parseMainnetProviderPositionCoverageManifestV1(duplicate, context()),
      'DUPLICATE_TARGET',
    );

    const extra = clone(coverageManifest());
    const extraTarget = clone((extra.targets as unknown[])[0]);
    extraTarget.marketId = 'unapproved-market';
    (extra.targets as unknown[]).push(extraTarget);
    expectUnavailable(
      () => parseMainnetProviderPositionCoverageManifestV1(extra, context()),
      'EXTRA_TARGET',
    );
  });

  it('rejects divergent source results, stale evidence, and source-set drift', () => {
    const divergent = clone(coverageManifest());
    (
      (divergent.targets as Array<Record<string, unknown>>)[0] as Record<string, unknown>
    ).divergenceStatus = 'DIVERGENT';
    expectUnavailable(
      () => parseMainnetProviderPositionCoverageManifestV1(divergent, context()),
      'DIVERGENT_COVERAGE',
    );

    const stale = clone(coverageManifest());
    ((stale.targets as Array<Record<string, unknown>>)[1] as Record<string, unknown>).staleAfter =
      EVALUATED_AT;
    expectUnavailable(
      () => parseMainnetProviderPositionCoverageManifestV1(stale, context()),
      'STALE_COVERAGE',
    );

    const sourceDrift = clone(coverageManifest());
    (
      (sourceDrift.targets as Array<Record<string, unknown>>)[0] as Record<string, unknown>
    ).sourceIds = ['ethereum-rpc-secondary'];
    expectUnavailable(
      () => parseMainnetProviderPositionCoverageManifestV1(sourceDrift, context()),
      'TARGET_MISMATCH',
    );
  });

  it('rejects cross-account, cross-wallet, network, and asset substitution', () => {
    const crossAccount = clone(coverageManifest());
    crossAccount.accountId = '88888888-8888-4888-8888-888888888888';
    expectUnavailable(
      () => parseMainnetProviderPositionCoverageManifestV1(crossAccount, context()),
      'ACCOUNT_MISMATCH',
    );

    const crossWallet = clone(coverageManifest());
    (
      (crossWallet.targets as Array<Record<string, unknown>>)[0] as Record<string, unknown>
    ).walletId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    expectUnavailable(
      () => parseMainnetProviderPositionCoverageManifestV1(crossWallet, context()),
      'EXTRA_TARGET',
    );

    const crossNetwork = clone(coverageManifest());
    (
      (crossNetwork.targets as Array<Record<string, unknown>>)[0] as Record<string, unknown>
    ).networkId = SOLANA_MAINNET;
    expectUnavailable(
      () => parseMainnetProviderPositionCoverageManifestV1(crossNetwork, context()),
      'EXTRA_TARGET',
    );

    const assetSwap = clone(coverageManifest());
    const assetSwapTarget = (assetSwap.targets as Array<Record<string, unknown>>)[0];
    if (assetSwapTarget === undefined) throw new Error('fixture target missing');
    const assetSwapAsset = (assetSwapTarget.assets as Array<Record<string, unknown>>)[0];
    if (assetSwapAsset === undefined) throw new Error('fixture asset missing');
    assetSwapAsset.stablecoin = 'USDT';
    expectUnavailable(
      () => parseMainnetProviderPositionCoverageManifestV1(assetSwap, context()),
      'TARGET_MISMATCH',
    );
  });

  it('binds the exact policy, fingerprint, and position snapshot', () => {
    const wrongPolicy = clone(coverageManifest());
    wrongPolicy.observationPolicyFingerprintSha256 = '0'.repeat(64);
    expectUnavailable(
      () => parseMainnetProviderPositionCoverageManifestV1(wrongPolicy, context()),
      'POLICY_MISMATCH',
    );

    const wrongFingerprint = clone(coverageManifest());
    wrongFingerprint.fingerprintSha256 = '0'.repeat(64);
    expectUnavailable(
      () => parseMainnetProviderPositionCoverageManifestV1(wrongFingerprint, context()),
      'FINGERPRINT_MISMATCH',
    );

    expectUnavailable(
      () =>
        parseCoveredMainnetProviderPositionSnapshotV1({
          ...context(),
          coverageManifest: coverageManifest(),
          positionSnapshot: emptyPositionSnapshot({
            snapshotId: 'different-position-snapshot',
          }),
        }),
      'POSITION_SNAPSHOT_INVALID',
    );
  });

  it('does not accept empty observations when coverage declares a position', () => {
    const targets = clone(coverageTargets()) as unknown as Array<Record<string, unknown>>;
    const firstTarget = targets[0];
    if (firstTarget === undefined) throw new Error('fixture target missing');
    firstTarget.positionCount = 1;
    const manifest = coverageManifest({ targets });

    expectUnavailable(
      () =>
        parseCoveredMainnetProviderPositionSnapshotV1({
          ...context(),
          coverageManifest: manifest,
          positionSnapshot: emptyPositionSnapshot(),
        }),
      'POSITION_COUNT_MISMATCH',
    );
  });

  it('rejects non-data properties and non-Ethereum/Solana policy networks', () => {
    const accessorInput = clone(coverageManifest());
    Object.defineProperty(accessorInput, 'fingerprintSha256', {
      enumerable: true,
      get: () => coverageManifest().fingerprintSha256 as string,
    });
    expectUnavailable(
      () => parseMainnetProviderPositionCoverageManifestV1(accessorInput, context()),
      'INVALID_MANIFEST',
    );

    const throwingProxy = new Proxy(coverageManifest(), {
      getPrototypeOf: () => {
        throw new Error('untrusted proxy trap');
      },
    });
    expectUnavailable(
      () => parseMainnetProviderPositionCoverageManifestV1(throwingProxy, context()),
      'INVALID_MANIFEST',
    );

    for (const networkId of ['eip155:8453', 'eip155:56', 'eip155:11155111']) {
      const invalidPolicy = policyContent({
        providers: [
          {
            providerId: 'other',
            protocols: [
              {
                protocolId: 'other-v1',
                markets: [
                  {
                    networkId,
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
            sourceId: 'other-rpc',
            sourceKind: 'RPC',
            networkId,
          },
        ],
      });
      expectUnavailable(
        () =>
          parseMainnetProviderPositionCoverageManifestV1(
            coverageManifest(),
            context({
              ...invalidPolicy,
              fingerprintSha256: '0'.repeat(64),
            }),
          ),
        'POLICY_MISMATCH',
      );
    }
  });
});
