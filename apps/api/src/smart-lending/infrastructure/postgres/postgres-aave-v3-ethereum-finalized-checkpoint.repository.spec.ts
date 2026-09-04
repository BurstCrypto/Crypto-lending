import type { QueryResult } from 'pg';

import type { PostgresService } from '../../../infrastructure/database/postgres.service';
import type { AaveV3EthereumDeploymentEvidence } from '../../application/ports/aave-v3-ethereum-deployment-evidence-reader.port';
import { fingerprintAaveV3EthereumDeploymentEvidence } from '../../domain/aave-v3-ethereum-deployment-evidence-fingerprint';
import { AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_BINDING } from '../../domain/aave-v3-ethereum-finalized-checkpoint';
import { AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST } from '../aave/aave-v3-ethereum-deployment.manifest';
import {
  AaveV3EthereumFinalizedCheckpointPersistenceError,
  PostgresAaveV3EthereumFinalizedCheckpointRepository,
} from './postgres-aave-v3-ethereum-finalized-checkpoint.repository';

const HASH = `0x${'11'.repeat(32)}` as const;
const PARENT_HASH = `0x${'22'.repeat(32)}` as const;
const STATE_ROOT = `0x${'33'.repeat(32)}` as const;
const CODE_HASH = `0x${'44'.repeat(32)}` as const;
const OBSERVED_AT = '2026-09-04T12:00:00.000Z';

function evidence(): AaveV3EthereumDeploymentEvidence {
  const binding = AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_BINDING;
  const manifest = AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST;
  const placeholder = '00'.repeat(32);
  const base: AaveV3EthereumDeploymentEvidence = {
    schemaVersion: 1,
    sourceId: 'AAVE_V3_ETHEREUM_FINALIZED_RPC',
    use: 'DEPLOYMENT_CORROBORATION_ONLY',
    mayEstablishRecommendationEligibility: false,
    mayAuthorizeFinancialAction: false,
    networkId: 'eip155:1',
    chainId: '0x1',
    blockSelector: 'finalized',
    blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
    observedChainIdentityMatchesPolicy: true,
    manifestBindingValidated: true,
    observedDeploymentTopologyMatchesManifest: true,
    blockBindingExecutionStatus: 'SOURCE_ATTESTED_UNVERIFIED',
    runtimeCodeApprovalStatus: 'UNVERIFIED',
    sourceProviderApproved: false,
    exactHostEgressApproved: false,
    liveCapabilityProofValidated: false,
    independentFinalizedSourcesAgree: false,
    freshnessStatus: 'UNVERIFIED_WITHOUT_DURABLE_CHECKPOINT',
    finalityStatus: 'UNVERIFIED_WITHOUT_LIVE_CAPABILITY_PROOF',
    sourceReferenceId: 'rpc-primary:ethereum-mainnet',
    sourceObservationId: 'rpc-observation:00000001',
    deploymentManifestFingerprintSha256: binding.deploymentManifestFingerprintSha256,
    assetRegistryFingerprintSha256: binding.assetRegistryFingerprintSha256,
    readPlanFingerprintSha256: binding.readPlanFingerprintSha256,
    evidenceFingerprintSha256: placeholder,
    evidenceId: `aave-v3-ethereum-deployment:${placeholder}`,
    observedAt: OBSERVED_AT,
    finalizedBlock: {
      number: 20_000_000n,
      hash: HASH,
      parentHash: PARENT_HASH,
      stateRoot: STATE_ROOT,
      timestamp: '2026-09-04T11:59:00.000Z',
    },
    runtimeCodeKeccak256: {
      poolAddressesProvider: CODE_HASH,
      poolProxy: CODE_HASH,
      poolImplementation: CODE_HASH,
      protocolDataProvider: CODE_HASH,
      usdcAToken: CODE_HASH,
      usdcVariableDebtToken: CODE_HASH,
      usdtAToken: CODE_HASH,
      usdtVariableDebtToken: CODE_HASH,
    },
    reserves: {
      USDC: {
        underlyingAsset: manifest.assets.USDC.underlyingAsset.toLowerCase() as `0x${string}`,
        aToken: manifest.assets.USDC.aToken.toLowerCase() as `0x${string}`,
        stableDebtToken: `0x${'0'.repeat(40)}`,
        variableDebtToken: manifest.assets.USDC.variableDebtToken.toLowerCase() as `0x${string}`,
      },
      USDT: {
        underlyingAsset: manifest.assets.USDT.underlyingAsset.toLowerCase() as `0x${string}`,
        aToken: manifest.assets.USDT.aToken.toLowerCase() as `0x${string}`,
        stableDebtToken: `0x${'0'.repeat(40)}`,
        variableDebtToken: manifest.assets.USDT.variableDebtToken.toLowerCase() as `0x${string}`,
      },
    },
  };
  const fingerprint = fingerprintAaveV3EthereumDeploymentEvidence(base, base.observedAt);
  return {
    ...base,
    evidenceFingerprintSha256: fingerprint,
    evidenceId: `aave-v3-ethereum-deployment:${fingerprint}`,
  };
}

function checkpointRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const binding = AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_BINDING;
  return {
    checkpoint_schema_version: 1,
    checkpoint_deployment_id: 'AAVE_V3_ETHEREUM',
    checkpoint_network_id: 'eip155:1',
    checkpoint_source_reference_id: 'rpc-primary:ethereum-mainnet',
    checkpoint_manifest_fingerprint: binding.deploymentManifestFingerprintSha256,
    checkpoint_registry_fingerprint: binding.assetRegistryFingerprintSha256,
    checkpoint_read_plan_fingerprint: binding.readPlanFingerprintSha256,
    checkpoint_revision: '1',
    checkpoint_status: 'ACTIVE',
    checkpoint_block_number: '20000000',
    checkpoint_block_hash: HASH,
    checkpoint_parent_hash: PARENT_HASH,
    checkpoint_state_root: STATE_ROOT,
    checkpoint_block_timestamp: new Date('2026-09-04T11:59:00.000Z'),
    checkpoint_source_observation_id: 'rpc-observation:00000001',
    checkpoint_evidence_fingerprint: evidence().evidenceFingerprintSha256,
    checkpoint_content_fingerprint: '66'.repeat(32),
    checkpoint_observed_at: new Date(OBSERVED_AT),
    checkpoint_finalized_advanced_at: new Date(OBSERVED_AT),
    checkpoint_last_validated_at: new Date(OBSERVED_AT),
    checkpoint_quarantine_reason: null,
    checkpoint_quarantined_at: null,
    ...overrides,
  };
}

function queryResult(rows: Record<string, unknown>[]): QueryResult {
  return { rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
}

function harness(): {
  query: jest.Mock;
  repository: PostgresAaveV3EthereumFinalizedCheckpointRepository;
} {
  const query = jest.fn();
  const postgres = { query } as unknown as PostgresService;
  return {
    query,
    repository: new PostgresAaveV3EthereumFinalizedCheckpointRepository(postgres),
  };
}

describe('Postgres Aave V3 Ethereum finalized checkpoint repository', () => {
  it('loads and strictly maps one durable checkpoint', async () => {
    const test = harness();
    test.query.mockResolvedValue(queryResult([checkpointRow()]));

    await expect(test.repository.loadCurrent('rpc-primary:ethereum-mainnet')).resolves.toEqual(
      expect.objectContaining({
        revision: 1,
        status: 'ACTIVE',
        sourceReferenceId: 'rpc-primary:ethereum-mainnet',
        finalizedBlock: expect.objectContaining({ number: 20_000_000n, hash: HASH }),
      }),
    );
    expect(test.query).toHaveBeenCalledWith(
      expect.stringContaining('read_aave_v3_ethereum_finalized_checkpoint($1::text)'),
      ['rpc-primary:ethereum-mainnet'],
    );
  });

  it('returns null only when the read function returns no row', async () => {
    const test = harness();
    test.query.mockResolvedValue(queryResult([]));

    await expect(test.repository.loadCurrent('rpc-primary:ethereum-mainnet')).resolves.toBeNull();
  });

  it('records only the normalized, revision-bound checkpoint command', async () => {
    const test = harness();
    test.query.mockResolvedValue(queryResult([{ record_outcome: 'CREATED', ...checkpointRow() }]));
    const input = evidence();

    await expect(
      test.repository.record({
        expectedRevision: null,
        correlationId: '550e8400-e29b-41d4-a716-446655440000',
        evidence: input,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        outcome: 'CREATED',
        checkpoint: expect.objectContaining({ revision: 1 }),
      }),
    );
    const values = test.query.mock.calls[0]?.[1] as unknown[];
    expect(values).toEqual([
      null,
      '550e8400-e29b-41d4-a716-446655440000',
      input.sourceReferenceId,
      input.sourceObservationId,
      input.evidenceFingerprintSha256,
      expect.stringMatching(/^[0-9a-f]{64}$/u),
      expect.stringMatching(/^[0-9a-f]{64}$/u),
      '20000000',
      HASH,
      PARENT_HASH,
      STATE_ROOT,
      '2026-09-04T11:59:00.000Z',
      OBSERVED_AT,
    ]);
    expect(JSON.stringify(values)).not.toMatch(/https?:|credential|authorization/iu);
  });

  it('maps a revision conflict with no current head without manufacturing checkpoint data', async () => {
    const test = harness();
    test.query.mockResolvedValue(
      queryResult([
        {
          record_outcome: 'REVISION_CONFLICT',
          ...Object.fromEntries(Object.keys(checkpointRow()).map((key) => [key, null])),
        },
      ]),
    );

    await expect(
      test.repository.record({
        expectedRevision: 1,
        correlationId: '550e8400-e29b-41d4-a716-446655440000',
        evidence: evidence(),
      }),
    ).resolves.toEqual({ outcome: 'REVISION_CONFLICT', checkpoint: null });
  });

  it.each([
    { rows: [checkpointRow(), checkpointRow()] },
    { rows: [checkpointRow({ checkpoint_block_number: '18446744073709551616' })] },
    { rows: [checkpointRow({ checkpoint_manifest_fingerprint: '00'.repeat(32) })] },
    { rows: [checkpointRow({ checkpoint_status: 'QUARANTINED' })] },
  ])('fails closed on malformed database result %#', async ({ rows }) => {
    const test = harness();
    test.query.mockResolvedValue(queryResult(rows));

    await expect(test.repository.loadCurrent('rpc-primary:ethereum-mainnet')).rejects.toEqual(
      expect.objectContaining({
        code: 'AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_PERSISTENCE_FAILED',
        message: 'Aave V3 Ethereum finalized checkpoint persistence failed',
      }),
    );
  });

  it('sanitizes database and validation failures', async () => {
    const test = harness();
    test.query.mockRejectedValue(new Error('postgres https://secret.invalid key=super-secret'));

    await expect(
      test.repository.loadCurrent('rpc-primary:ethereum-mainnet'),
    ).rejects.toBeInstanceOf(AaveV3EthereumFinalizedCheckpointPersistenceError);
    await expect(test.repository.loadCurrent('https://not-an-opaque-source')).rejects.toEqual(
      expect.objectContaining({
        message: 'Aave V3 Ethereum finalized checkpoint persistence failed',
      }),
    );
  });
});
