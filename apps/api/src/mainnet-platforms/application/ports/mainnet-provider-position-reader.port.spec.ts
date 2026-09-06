import { parseAccountId } from '../../../accounts/domain/account-profile';
import { PORTFOLIO_BALANCE_READER } from '../../../portfolio/application/ports/portfolio-balance-reader.port';
import {
  MAINNET_PROVIDER_POSITION_COVERAGE_ONLY,
  MAINNET_PROVIDER_POSITION_COVERAGE_VERSION,
  type CoveredMainnetProviderPositionSnapshotV1,
  type MainnetProviderPositionCoverageManifestV1,
} from '../../domain/mainnet-provider-position-coverage';
import {
  MAINNET_PROVIDER_POSITION_OBSERVATION_USE,
  MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
  type MainnetProviderPositionObservationV1,
  type MainnetProviderPositionSnapshotV1,
} from '../../domain/mainnet-provider-position-observation';
import {
  MAINNET_PROVIDER_POSITION_READER,
  MAINNET_PROVIDER_POSITION_READER_VERSION,
  type MainnetProviderPositionReader,
} from './mainnet-provider-position-reader.port';

const ACCOUNT_ID = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const WALLET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SNAPSHOT_ID = 'mainnet-provider-position-read';
const POLICY_FINGERPRINT = 'b'.repeat(64);
const REGISTRY_FINGERPRINT = 'a'.repeat(64);
const COVERAGE_FINGERPRINT = 'c'.repeat(64);
const CAPTURED_AT = '2026-09-02T17:00:00.000Z';
const STALE_AFTER = '2026-09-02T17:00:45.000Z';
const MARKET = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

type ReaderResponse = Awaited<ReturnType<MainnetProviderPositionReader['readCurrentPositions']>>;
type BareSnapshotIsReaderResponse = MainnetProviderPositionSnapshotV1 extends ReaderResponse
  ? true
  : false;
const BARE_SNAPSHOT_IS_READER_RESPONSE: BareSnapshotIsReaderResponse = false;

function coverageManifest(positionCount: number): MainnetProviderPositionCoverageManifestV1 {
  return Object.freeze({
    coverageVersion: MAINNET_PROVIDER_POSITION_COVERAGE_VERSION,
    use: MAINNET_PROVIDER_POSITION_COVERAGE_ONLY,
    mayAuthorizeFinancialAction: false,
    manifestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    accountId: ACCOUNT_ID,
    positionSnapshotId: SNAPSHOT_ID,
    observationPolicyVersion: 1,
    observationPolicyId: 'strict-test-policy-v1',
    observationPolicyFingerprintSha256: POLICY_FINGERPRINT,
    assetRegistryVersion: 1,
    assetRegistryFingerprintSha256: REGISTRY_FINGERPRINT,
    capturedAt: CAPTURED_AT,
    staleAfter: STALE_AFTER,
    freshnessClass: 'CURRENT',
    targets: Object.freeze([
      Object.freeze({
        walletId: WALLET_ID,
        providerId: 'aave',
        protocolId: 'aave-v3',
        marketId: MARKET,
        networkId: 'eip155:1',
        assets: Object.freeze([Object.freeze({ stablecoin: 'USDC', identity: USDC })]),
        sourceIds: Object.freeze(['ethereum-rpc-primary', 'ethereum-indexer-secondary']),
        status: 'COMPLETE',
        divergenceStatus: 'AGREED',
        positionCount,
        observedAt: '2026-09-02T16:59:45.000Z',
        staleAfter: STALE_AFTER,
      }),
    ]),
    fingerprintSha256: COVERAGE_FINGERPRINT,
  });
}

function coveredSnapshot(
  observations: readonly MainnetProviderPositionObservationV1[],
): CoveredMainnetProviderPositionSnapshotV1 {
  return Object.freeze({
    schemaVersion: MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
    use: MAINNET_PROVIDER_POSITION_OBSERVATION_USE,
    mayAuthorizeFinancialAction: false,
    snapshotId: SNAPSHOT_ID,
    observationPolicyVersion: 1,
    observationPolicyId: 'strict-test-policy-v1',
    observationPolicyFingerprintSha256: POLICY_FINGERPRINT,
    assetRegistryVersion: 1,
    assetRegistryFingerprintSha256: REGISTRY_FINGERPRINT,
    capturedAt: CAPTURED_AT,
    staleAfter: STALE_AFTER,
    freshnessClass: 'CURRENT',
    observations: Object.freeze([...observations]),
    coverageManifest: coverageManifest(observations.length),
  });
}

function ethereumObservation(): MainnetProviderPositionObservationV1 {
  return Object.freeze({
    observationId: '11111111-1111-4111-8111-111111111111',
    walletId: WALLET_ID,
    providerId: 'aave',
    protocolId: 'aave-v3',
    marketId: MARKET,
    positionId: 'aave-ethereum-usdc-supply',
    positionKind: 'SUPPLY',
    asset: Object.freeze({
      stablecoin: 'USDC',
      networkId: 'eip155:1',
      identity: USDC,
      decimals: 6,
    }),
    balance: Object.freeze({ atomic: '5000000', decimal: '5.000000' }),
    source: Object.freeze({
      sourceId: 'ethereum-rpc-primary',
      sourceKind: 'RPC',
      sourceObservationId: 'ethereum-block-50000001',
      chainAnchor: Object.freeze({
        kind: 'EVM_BLOCK',
        blockNumber: '50000001',
        blockHash: `0x${'ab'.repeat(32)}`,
      }),
    }),
    observedAt: '2026-09-02T16:59:45.000Z',
    staleAfter: STALE_AFTER,
    freshnessClass: 'CURRENT',
  });
}

function readerReturning(
  response: CoveredMainnetProviderPositionSnapshotV1,
): MainnetProviderPositionReader {
  return Object.freeze({
    readerVersion: MAINNET_PROVIDER_POSITION_READER_VERSION,
    positionSchemaVersion: MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
    coverageVersion: MAINNET_PROVIDER_POSITION_COVERAGE_VERSION,
    readCurrentPositions: jest.fn(async () => response),
  });
}

describe('MainnetProviderPositionReader port', () => {
  it('is a distinct coverage-aware versioned boundary', () => {
    expect(MAINNET_PROVIDER_POSITION_READER_VERSION).toBe(2);
    expect(MAINNET_PROVIDER_POSITION_SCHEMA_VERSION).toBe(1);
    expect(MAINNET_PROVIDER_POSITION_COVERAGE_VERSION).toBe(1);
    expect(MAINNET_PROVIDER_POSITION_READER).not.toBe(PORTFOLIO_BALANCE_READER);
    expect(BARE_SNAPSHOT_IS_READER_RESPONSE).toBe(false);
  });

  it('requires nonempty observations to retain exact coverage and evidence identity', async () => {
    const response = coveredSnapshot([ethereumObservation()]);
    const reader = readerReturning(response);

    await expect(
      reader.readCurrentPositions({
        accountId: ACCOUNT_ID,
        evaluatedAt: '2026-09-02T17:00:10.000Z',
        correlationId: 'position-read-1',
      }),
    ).resolves.toBe(response);
    expect(response.coverageManifest).toEqual(
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        positionSnapshotId: response.snapshotId,
        observationPolicyFingerprintSha256: response.observationPolicyFingerprintSha256,
        assetRegistryFingerprintSha256: response.assetRegistryFingerprintSha256,
        fingerprintSha256: COVERAGE_FINGERPRINT,
        targets: [expect.objectContaining({ positionCount: 1 })],
      }),
    );
    expect(Object.keys(response)).not.toEqual(
      expect.arrayContaining(['chainAssessment', 'chainAssessmentVerifier', 'capability']),
    );
    expect(response.mayAuthorizeFinancialAction).toBe(false);
  });

  it('represents zero only through an explicit complete zero-position target', async () => {
    const response = coveredSnapshot([]);
    const reader = readerReturning(response);

    await expect(
      reader.readCurrentPositions({
        accountId: ACCOUNT_ID,
        evaluatedAt: '2026-09-02T17:00:10.000Z',
        correlationId: 'position-read-zero',
      }),
    ).resolves.toBe(response);
    expect(response.observations).toEqual([]);
    expect(response.coverageManifest.targets).toEqual([
      expect.objectContaining({
        status: 'COMPLETE',
        divergenceStatus: 'AGREED',
        positionCount: 0,
      }),
    ]);
    expect(Object.keys(reader).sort()).toEqual([
      'coverageVersion',
      'positionSchemaVersion',
      'readCurrentPositions',
      'readerVersion',
    ]);
  });
});
