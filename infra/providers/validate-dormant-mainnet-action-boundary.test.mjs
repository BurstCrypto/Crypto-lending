import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  ACTION_BOUNDARY_INPUT_ERROR,
  ACTION_BOUNDARY_PATH,
  ACTION_BOUNDARY_SPEC_PATH,
  ACTION_AUTHENTICATED_FINALITY_MIGRATION_INTEGRATION_SPEC_PATH,
  ACTION_AUTHENTICATED_FINALITY_MIGRATION_PATH,
  ACTION_AUTHENTICATED_FINALITY_MIGRATION_SPEC_PATH,
  ACTION_ATOMIC_FINALITY_MIGRATION_INTEGRATION_SPEC_PATH,
  ACTION_ATOMIC_FINALITY_MIGRATION_PATH,
  ACTION_ATOMIC_FINALITY_MIGRATION_SPEC_PATH,
  ACTION_FINALITY_EVIDENCE_PRODUCER_PATH,
  ACTION_FINALITY_EVIDENCE_PRODUCER_SPEC_PATH,
  ACTION_FINALITY_EVIDENCE_SOURCE_PORT_PATH,
  ACTION_FINALITY_EVIDENCE_SOURCE_PORT_SPEC_PATH,
  ACTION_FINALITY_SIDECAR_DURABLE_PORT_PATH,
  ACTION_FINALITY_SIDECAR_DURABLE_PORT_SPEC_PATH,
  ACTION_FINALITY_SIDECAR_POSTGRES_ADAPTER_PATH,
  ACTION_FINALITY_SIDECAR_POSTGRES_ADAPTER_SPEC_PATH,
  ACTION_FINALITY_PREREQUISITE_ISSUER_PORT_PATH,
  ACTION_FINALITY_PREREQUISITE_MIGRATION_INTEGRATION_SPEC_PATH,
  ACTION_FINALITY_PREREQUISITE_MIGRATION_PATH,
  ACTION_FINALITY_PREREQUISITE_MIGRATION_SPEC_PATH,
  ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_PATH,
  ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_SPEC_PATH,
  ACTION_FINALITY_WALLET_READER_PATH,
  ACTION_FINALITY_WALLET_READER_SPEC_PATH,
  ACTION_LIFECYCLE_PATH,
  ACTION_LIFECYCLE_MIGRATION_PATH,
  ACTION_LIFECYCLE_MIGRATION_SPEC_PATH,
  ACTION_LIFECYCLE_DURABLE_PORT_PATH,
  ACTION_LIFECYCLE_POSTGRES_ADAPTER_INTEGRATION_SPEC_PATH,
  ACTION_LIFECYCLE_POSTGRES_ADAPTER_PATH,
  ACTION_LIFECYCLE_POSTGRES_ADAPTER_SPEC_PATH,
  ACTION_LIFECYCLE_SPEC_PATH,
  ACTION_WALLET_IDENTITY_BINDING_MIGRATION_INTEGRATION_SPEC_PATH,
  ACTION_WALLET_IDENTITY_BINDING_MIGRATION_PATH,
  ACTION_WALLET_IDENTITY_BINDING_MIGRATION_SPEC_PATH,
  DATABASE_MIGRATION_INDEX_PATH,
  EXPECTED_ACTIONS,
  EXPECTED_PROVIDER_CANDIDATES,
  loadDormantMainnetActionBoundarySnapshot,
  loadDormantMainnetActionBoundarySnapshotForTest,
  REVIEWED_ACTION_AUTHENTICATED_FINALITY_MIGRATION_INTEGRATION_SPEC_SHA256,
  REVIEWED_ACTION_AUTHENTICATED_FINALITY_MIGRATION_SHA256,
  REVIEWED_ACTION_AUTHENTICATED_FINALITY_MIGRATION_SPEC_SHA256,
  REVIEWED_ACTION_ATOMIC_FINALITY_MIGRATION_INTEGRATION_SPEC_SHA256,
  REVIEWED_ACTION_ATOMIC_FINALITY_MIGRATION_SHA256,
  REVIEWED_ACTION_ATOMIC_FINALITY_MIGRATION_SPEC_SHA256,
  REVIEWED_ACTION_BOUNDARY_SHA256,
  REVIEWED_ACTION_BOUNDARY_SPEC_SHA256,
  REVIEWED_ACTION_FINALITY_EVIDENCE_PRODUCER_SHA256,
  REVIEWED_ACTION_FINALITY_EVIDENCE_PRODUCER_SPEC_SHA256,
  REVIEWED_ACTION_FINALITY_EVIDENCE_SOURCE_PORT_SHA256,
  REVIEWED_ACTION_FINALITY_EVIDENCE_SOURCE_PORT_SPEC_SHA256,
  REVIEWED_ACTION_FINALITY_SIDECAR_DURABLE_PORT_SHA256,
  REVIEWED_ACTION_FINALITY_SIDECAR_DURABLE_PORT_SPEC_SHA256,
  REVIEWED_ACTION_FINALITY_SIDECAR_POSTGRES_ADAPTER_SHA256,
  REVIEWED_ACTION_FINALITY_SIDECAR_POSTGRES_ADAPTER_SPEC_SHA256,
  REVIEWED_ACTION_FINALITY_PREREQUISITE_ISSUER_PORT_SHA256,
  REVIEWED_ACTION_FINALITY_PREREQUISITE_MIGRATION_INTEGRATION_SPEC_SHA256,
  REVIEWED_ACTION_FINALITY_PREREQUISITE_MIGRATION_SHA256,
  REVIEWED_ACTION_FINALITY_PREREQUISITE_MIGRATION_SPEC_SHA256,
  REVIEWED_ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_SHA256,
  REVIEWED_ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_SPEC_SHA256,
  REVIEWED_ACTION_FINALITY_WALLET_READER_SHA256,
  REVIEWED_ACTION_FINALITY_WALLET_READER_SPEC_SHA256,
  REVIEWED_ACTION_LIFECYCLE_SHA256,
  REVIEWED_ACTION_LIFECYCLE_DURABLE_PORT_SHA256,
  REVIEWED_ACTION_LIFECYCLE_MIGRATION_SHA256,
  REVIEWED_ACTION_LIFECYCLE_MIGRATION_SPEC_SHA256,
  REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_INTEGRATION_SPEC_SHA256,
  REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_SHA256,
  REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_SPEC_SHA256,
  REVIEWED_ACTION_LIFECYCLE_SPEC_SHA256,
  REVIEWED_ACTION_WALLET_IDENTITY_BINDING_MIGRATION_INTEGRATION_SPEC_SHA256,
  REVIEWED_ACTION_WALLET_IDENTITY_BINDING_MIGRATION_SHA256,
  REVIEWED_ACTION_WALLET_IDENTITY_BINDING_MIGRATION_SPEC_SHA256,
  REVIEWED_DATABASE_MIGRATION_INDEX_SHA256,
  validateDormantMainnetActionBoundaryFiles,
  validateDormantMainnetActionBoundarySnapshot,
} from './validate-dormant-mainnet-action-boundary.mjs';

const baseline = loadDormantMainnetActionBoundarySnapshot();

test('pins every recovery, signed verification, key-rotation, and scheduler artifact', () => {
  assert.equal(baseline.recoverySchedulerSources.size, 42);
  for (const [path, source] of baseline.recoverySchedulerSources) {
    const changed = snapshot();
    changed.recoverySchedulerSources.set(path, `${source}\n`);
    assert.ok(
      validateDormantMainnetActionBoundarySnapshot(changed).includes(
        `reviewed recovery or scheduler artifact drifted: ${path}`,
      ),
    );
  }
  const omitted = snapshot();
  omitted.recoverySchedulerSources.delete(omitted.recoverySchedulerSources.keys().next().value);
  assert.ok(
    validateDormantMainnetActionBoundarySnapshot(omitted).includes(
      'recovery and scheduler artifact inventory is incomplete or extended',
    ),
  );
});

test('rejects scheduler grant, lease, durable-completion, and production-manifest widening', () => {
  const migrationPath =
    'apps/api/src/infrastructure/database/migrations/0042-create-mainnet-financial-action-durable-scheduler.migration.ts';
  const schedulerPath =
    'apps/api/src/mainnet-actions/application/dormant-mainnet-financial-action-two-queue.scheduler.ts';
  const changed = snapshot();
  changed.recoverySchedulerSources.set(
    migrationPath,
    changed.recoverySchedulerSources
      .get(migrationPath)
      .replace('FOR UPDATE OF job SKIP LOCKED', 'FOR UPDATE OF job'),
  );
  assert.ok(
    validateDormantMainnetActionBoundarySnapshot(changed).includes(
      'durable scheduler lost concurrency or quarantine control: FOR UPDATE OF job SKIP LOCKED',
    ),
  );
  changed.recoverySchedulerSources.set(
    migrationPath,
    baseline.recoverySchedulerSources.get(migrationPath) + '\n// GRANT EXECUTE TO public\n',
  );
  assert.ok(
    validateDormantMainnetActionBoundarySnapshot(changed).some((error) =>
      error.startsWith('recovery/scheduler migration widened owner authority'),
    ),
  );
  changed.recoverySchedulerSources.set(
    schedulerPath,
    changed.recoverySchedulerSources
      .get(schedulerPath)
      .replace('completedAt: durableCompletion.completedAt', 'completedAt: this.now().text'),
  );
  assert.ok(
    validateDormantMainnetActionBoundarySnapshot(changed).includes(
      'scheduler completion must be one-shot and authenticated by the durable source',
    ),
  );
  const manifestPath =
    'apps/api/src/mainnet-actions/infrastructure/mainnet-financial-action-write-manifest.ts';
  changed.recoverySchedulerSources.set(
    manifestPath,
    changed.recoverySchedulerSources
      .get(manifestPath)
      .replace('Object.freeze([]);', 'Object.freeze([{}]);'),
  );
  assert.ok(
    validateDormantMainnetActionBoundarySnapshot(changed).includes(
      'production write manifests must remain empty',
    ),
  );
});

test('rejects scheduler runtime wiring and unilateral registration of the dormant successor migrations', () => {
  mutationReports(
    'runtime scheduler',
    'dormant recovery/scheduler source is referenced by runtime source apps/api/src/scheduler-worker.ts',
    (changed) => {
      changed.runtimeSources.set(
        'apps/api/src/scheduler-worker.ts',
        "import './mainnet-actions/infrastructure/postgres-dormant-mainnet-financial-action-two-queue-scheduler.adapter';\n",
      );
    },
  );
  mutationReports(
    'successor registration',
    '0039-0042 must remain outside runtime migration registration',
    (changed) => {
      changed.migrationIndexSource +=
        "\nimport './0042-create-mainnet-financial-action-durable-scheduler.migration';\n";
    },
  );
});

function snapshot() {
  return {
    boundarySource: baseline.boundarySource,
    specSource: baseline.specSource,
    lifecycleSource: baseline.lifecycleSource,
    lifecycleSpecSource: baseline.lifecycleSpecSource,
    durablePortSource: baseline.durablePortSource,
    postgresAdapterSource: baseline.postgresAdapterSource,
    postgresAdapterSpecSource: baseline.postgresAdapterSpecSource,
    postgresAdapterIntegrationSpecSource: baseline.postgresAdapterIntegrationSpecSource,
    migrationSource: baseline.migrationSource,
    migrationSpecSource: baseline.migrationSpecSource,
    walletIdentityBindingMigrationSource: baseline.walletIdentityBindingMigrationSource,
    walletIdentityBindingMigrationSpecSource: baseline.walletIdentityBindingMigrationSpecSource,
    walletIdentityBindingMigrationIntegrationSpecSource:
      baseline.walletIdentityBindingMigrationIntegrationSpecSource,
    finalityEvidenceSourcePortSource: baseline.finalityEvidenceSourcePortSource,
    finalityEvidenceSourcePortSpecSource: baseline.finalityEvidenceSourcePortSpecSource,
    finalityEvidenceProducerSource: baseline.finalityEvidenceProducerSource,
    finalityEvidenceProducerSpecSource: baseline.finalityEvidenceProducerSpecSource,
    finalitySidecarPortSource: baseline.finalitySidecarPortSource,
    finalitySidecarPortSpecSource: baseline.finalitySidecarPortSpecSource,
    finalitySidecarAdapterSource: baseline.finalitySidecarAdapterSource,
    finalitySidecarAdapterSpecSource: baseline.finalitySidecarAdapterSpecSource,
    authenticatedFinalityMigrationSource: baseline.authenticatedFinalityMigrationSource,
    authenticatedFinalityMigrationSpecSource: baseline.authenticatedFinalityMigrationSpecSource,
    authenticatedFinalityMigrationIntegrationSpecSource:
      baseline.authenticatedFinalityMigrationIntegrationSpecSource,
    finalityPrerequisiteIssuerPortSource: baseline.finalityPrerequisiteIssuerPortSource,
    finalityPrerequisiteAdapterSource: baseline.finalityPrerequisiteAdapterSource,
    finalityPrerequisiteAdapterSpecSource: baseline.finalityPrerequisiteAdapterSpecSource,
    finalityWalletReaderSource: baseline.finalityWalletReaderSource,
    finalityWalletReaderSpecSource: baseline.finalityWalletReaderSpecSource,
    finalityPrerequisiteMigrationSource: baseline.finalityPrerequisiteMigrationSource,
    finalityPrerequisiteMigrationSpecSource: baseline.finalityPrerequisiteMigrationSpecSource,
    finalityPrerequisiteMigrationIntegrationSpecSource:
      baseline.finalityPrerequisiteMigrationIntegrationSpecSource,
    atomicFinalityMigrationSource: baseline.atomicFinalityMigrationSource,
    atomicFinalityMigrationSpecSource: baseline.atomicFinalityMigrationSpecSource,
    atomicFinalityMigrationIntegrationSpecSource:
      baseline.atomicFinalityMigrationIntegrationSpecSource,
    migrationIndexSource: baseline.migrationIndexSource,
    recoverySchedulerSources: new Map(baseline.recoverySchedulerSources),
    runtimeSources: new Map(baseline.runtimeSources),
  };
}

function mutationRejected(name, mutate) {
  const changed = snapshot();
  mutate(changed);
  assert.ok(validateDormantMainnetActionBoundarySnapshot(changed).length > 0, `${name} must fail`);
}

function mutationReports(name, expectedError, mutate) {
  const changed = snapshot();
  mutate(changed);
  assert.ok(
    validateDormantMainnetActionBoundarySnapshot(changed).includes(expectedError),
    `${name} must report: ${expectedError}`,
  );
}

function writeFixture(repositoryRoot, path, source) {
  const absolute = join(repositoryRoot, ...path.split('/'));
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, source);
}

function writeCompleteReviewedFixture(repositoryRoot) {
  for (const [path, source] of baseline.recoverySchedulerSources)
    writeFixture(repositoryRoot, path, source);
  for (const [path, source] of [
    [ACTION_BOUNDARY_PATH, baseline.boundarySource],
    [ACTION_BOUNDARY_SPEC_PATH, baseline.specSource],
    [ACTION_LIFECYCLE_PATH, baseline.lifecycleSource],
    [ACTION_LIFECYCLE_SPEC_PATH, baseline.lifecycleSpecSource],
    [ACTION_LIFECYCLE_DURABLE_PORT_PATH, baseline.durablePortSource],
    [ACTION_LIFECYCLE_POSTGRES_ADAPTER_PATH, baseline.postgresAdapterSource],
    [ACTION_LIFECYCLE_POSTGRES_ADAPTER_SPEC_PATH, baseline.postgresAdapterSpecSource],
    [
      ACTION_LIFECYCLE_POSTGRES_ADAPTER_INTEGRATION_SPEC_PATH,
      baseline.postgresAdapterIntegrationSpecSource,
    ],
    [ACTION_LIFECYCLE_MIGRATION_PATH, baseline.migrationSource],
    [ACTION_LIFECYCLE_MIGRATION_SPEC_PATH, baseline.migrationSpecSource],
    [ACTION_WALLET_IDENTITY_BINDING_MIGRATION_PATH, baseline.walletIdentityBindingMigrationSource],
    [
      ACTION_WALLET_IDENTITY_BINDING_MIGRATION_SPEC_PATH,
      baseline.walletIdentityBindingMigrationSpecSource,
    ],
    [
      ACTION_WALLET_IDENTITY_BINDING_MIGRATION_INTEGRATION_SPEC_PATH,
      baseline.walletIdentityBindingMigrationIntegrationSpecSource,
    ],
    [ACTION_FINALITY_EVIDENCE_SOURCE_PORT_PATH, baseline.finalityEvidenceSourcePortSource],
    [ACTION_FINALITY_EVIDENCE_SOURCE_PORT_SPEC_PATH, baseline.finalityEvidenceSourcePortSpecSource],
    [ACTION_FINALITY_EVIDENCE_PRODUCER_PATH, baseline.finalityEvidenceProducerSource],
    [ACTION_FINALITY_EVIDENCE_PRODUCER_SPEC_PATH, baseline.finalityEvidenceProducerSpecSource],
    [ACTION_FINALITY_SIDECAR_DURABLE_PORT_PATH, baseline.finalitySidecarPortSource],
    [ACTION_FINALITY_SIDECAR_DURABLE_PORT_SPEC_PATH, baseline.finalitySidecarPortSpecSource],
    [ACTION_FINALITY_SIDECAR_POSTGRES_ADAPTER_PATH, baseline.finalitySidecarAdapterSource],
    [ACTION_FINALITY_SIDECAR_POSTGRES_ADAPTER_SPEC_PATH, baseline.finalitySidecarAdapterSpecSource],
    [ACTION_AUTHENTICATED_FINALITY_MIGRATION_PATH, baseline.authenticatedFinalityMigrationSource],
    [
      ACTION_AUTHENTICATED_FINALITY_MIGRATION_SPEC_PATH,
      baseline.authenticatedFinalityMigrationSpecSource,
    ],
    [
      ACTION_AUTHENTICATED_FINALITY_MIGRATION_INTEGRATION_SPEC_PATH,
      baseline.authenticatedFinalityMigrationIntegrationSpecSource,
    ],
    [ACTION_FINALITY_PREREQUISITE_ISSUER_PORT_PATH, baseline.finalityPrerequisiteIssuerPortSource],
    [
      ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_PATH,
      baseline.finalityPrerequisiteAdapterSource,
    ],
    [
      ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_SPEC_PATH,
      baseline.finalityPrerequisiteAdapterSpecSource,
    ],
    [ACTION_FINALITY_WALLET_READER_PATH, baseline.finalityWalletReaderSource],
    [ACTION_FINALITY_WALLET_READER_SPEC_PATH, baseline.finalityWalletReaderSpecSource],
    [ACTION_FINALITY_PREREQUISITE_MIGRATION_PATH, baseline.finalityPrerequisiteMigrationSource],
    [
      ACTION_FINALITY_PREREQUISITE_MIGRATION_SPEC_PATH,
      baseline.finalityPrerequisiteMigrationSpecSource,
    ],
    [
      ACTION_FINALITY_PREREQUISITE_MIGRATION_INTEGRATION_SPEC_PATH,
      baseline.finalityPrerequisiteMigrationIntegrationSpecSource,
    ],
    [ACTION_ATOMIC_FINALITY_MIGRATION_PATH, baseline.atomicFinalityMigrationSource],
    [ACTION_ATOMIC_FINALITY_MIGRATION_SPEC_PATH, baseline.atomicFinalityMigrationSpecSource],
    [
      ACTION_ATOMIC_FINALITY_MIGRATION_INTEGRATION_SPEC_PATH,
      baseline.atomicFinalityMigrationIntegrationSpecSource,
    ],
    [DATABASE_MIGRATION_INDEX_PATH, baseline.migrationIndexSource],
  ]) {
    writeFixture(repositoryRoot, path, source);
  }
}

test('the exact Ethereum and Solana lending action candidate boundary is dormant', () => {
  assert.deepEqual(validateDormantMainnetActionBoundaryFiles(), []);
  assert.deepEqual(EXPECTED_ACTIONS, ['SUPPLY', 'WITHDRAW', 'BORROW', 'REPAY']);
  assert.equal(EXPECTED_PROVIDER_CANDIDATES.length, 10);
  assert.deepEqual(
    [...new Set(EXPECTED_PROVIDER_CANDIDATES.map((entry) => entry[2]))],
    ['eip155:1', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
  );
  assert.equal(REVIEWED_ACTION_BOUNDARY_SHA256.length, 64);
  assert.equal(REVIEWED_ACTION_BOUNDARY_SPEC_SHA256.length, 64);
  assert.equal(REVIEWED_ACTION_LIFECYCLE_SHA256.length, 64);
  assert.equal(REVIEWED_ACTION_LIFECYCLE_SPEC_SHA256.length, 64);
  assert.equal(REVIEWED_ACTION_LIFECYCLE_DURABLE_PORT_SHA256.length, 64);
  assert.equal(REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_SHA256.length, 64);
  assert.equal(REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_SPEC_SHA256.length, 64);
  assert.equal(REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_INTEGRATION_SPEC_SHA256.length, 64);
  assert.equal(REVIEWED_ACTION_LIFECYCLE_MIGRATION_SHA256.length, 64);
  assert.equal(REVIEWED_ACTION_LIFECYCLE_MIGRATION_SPEC_SHA256.length, 64);
  assert.equal(REVIEWED_ACTION_WALLET_IDENTITY_BINDING_MIGRATION_SHA256.length, 64);
  assert.equal(REVIEWED_ACTION_WALLET_IDENTITY_BINDING_MIGRATION_SPEC_SHA256.length, 64);
  assert.equal(
    REVIEWED_ACTION_WALLET_IDENTITY_BINDING_MIGRATION_INTEGRATION_SPEC_SHA256.length,
    64,
  );
  for (const digest of [
    REVIEWED_ACTION_FINALITY_EVIDENCE_SOURCE_PORT_SHA256,
    REVIEWED_ACTION_FINALITY_EVIDENCE_SOURCE_PORT_SPEC_SHA256,
    REVIEWED_ACTION_FINALITY_EVIDENCE_PRODUCER_SHA256,
    REVIEWED_ACTION_FINALITY_EVIDENCE_PRODUCER_SPEC_SHA256,
    REVIEWED_ACTION_FINALITY_SIDECAR_DURABLE_PORT_SHA256,
    REVIEWED_ACTION_FINALITY_SIDECAR_DURABLE_PORT_SPEC_SHA256,
    REVIEWED_ACTION_FINALITY_SIDECAR_POSTGRES_ADAPTER_SHA256,
    REVIEWED_ACTION_FINALITY_SIDECAR_POSTGRES_ADAPTER_SPEC_SHA256,
    REVIEWED_ACTION_AUTHENTICATED_FINALITY_MIGRATION_SHA256,
    REVIEWED_ACTION_AUTHENTICATED_FINALITY_MIGRATION_SPEC_SHA256,
    REVIEWED_ACTION_AUTHENTICATED_FINALITY_MIGRATION_INTEGRATION_SPEC_SHA256,
    REVIEWED_ACTION_FINALITY_PREREQUISITE_ISSUER_PORT_SHA256,
    REVIEWED_ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_SHA256,
    REVIEWED_ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_SPEC_SHA256,
    REVIEWED_ACTION_FINALITY_WALLET_READER_SHA256,
    REVIEWED_ACTION_FINALITY_WALLET_READER_SPEC_SHA256,
    REVIEWED_ACTION_FINALITY_PREREQUISITE_MIGRATION_SHA256,
    REVIEWED_ACTION_FINALITY_PREREQUISITE_MIGRATION_SPEC_SHA256,
    REVIEWED_ACTION_FINALITY_PREREQUISITE_MIGRATION_INTEGRATION_SPEC_SHA256,
    REVIEWED_ACTION_ATOMIC_FINALITY_MIGRATION_SHA256,
    REVIEWED_ACTION_ATOMIC_FINALITY_MIGRATION_SPEC_SHA256,
    REVIEWED_ACTION_ATOMIC_FINALITY_MIGRATION_INTEGRATION_SPEC_SHA256,
  ]) {
    assert.equal(digest.length, 64);
  }
  assert.equal(REVIEWED_DATABASE_MIGRATION_INDEX_SHA256.length, 64);
  assert.equal(
    REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_SHA256,
    'b2a21481711153b4dd9482d18a0f9a0a1b391c142772f558523545e9fcd73c66',
  );
  assert.equal(
    REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_SPEC_SHA256,
    '089acbe297762e20d5a3ee065d36642dd802f7997660fe2340203de6b23d84e1',
  );
  assert.equal(
    REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_INTEGRATION_SPEC_SHA256,
    'a3d584df8529a6f15480d0cc469576236825ea26ba436eea8c632619d8854f0e',
  );
  assert.equal(
    REVIEWED_ACTION_LIFECYCLE_MIGRATION_SHA256,
    'c3840f3b3cd7de0e7dbf159c335fbe0784e55e81c936defdf618c9b0092ffa27',
  );
  assert.equal(
    REVIEWED_ACTION_LIFECYCLE_MIGRATION_SPEC_SHA256,
    'c14640d07c43ec41e5cda394f1f1c1cfccb5cb227541fce55a230cc7a94545e9',
  );
  assert.equal(
    REVIEWED_ACTION_WALLET_IDENTITY_BINDING_MIGRATION_SHA256,
    '11fd11a882e81f417d0efdfbbb7da3c8bed0171ed9aec420068772e8c56a75a7',
  );
  assert.equal(
    REVIEWED_ACTION_WALLET_IDENTITY_BINDING_MIGRATION_SPEC_SHA256,
    '389e1b6c28265e841ec9b3afcce9f80bd103fe5cc630592b974632058fcc4c74',
  );
  assert.equal(
    REVIEWED_ACTION_WALLET_IDENTITY_BINDING_MIGRATION_INTEGRATION_SPEC_SHA256,
    '7aa0e97a3563468bd1c520a80876ee0f7c12939f13b3a8021d9e6bb44b49d31b',
  );
  assert.equal(
    REVIEWED_DATABASE_MIGRATION_INDEX_SHA256,
    '3ceea27f4922a0e72022d6aac83504083c96b683a1b711aa37ce91acced4f35f',
  );
  assert.deepEqual(
    [
      REVIEWED_ACTION_FINALITY_PREREQUISITE_ISSUER_PORT_SHA256,
      REVIEWED_ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_SHA256,
      REVIEWED_ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_SPEC_SHA256,
      REVIEWED_ACTION_FINALITY_WALLET_READER_SHA256,
      REVIEWED_ACTION_FINALITY_WALLET_READER_SPEC_SHA256,
      REVIEWED_ACTION_FINALITY_PREREQUISITE_MIGRATION_SHA256,
      REVIEWED_ACTION_FINALITY_PREREQUISITE_MIGRATION_SPEC_SHA256,
      REVIEWED_ACTION_FINALITY_PREREQUISITE_MIGRATION_INTEGRATION_SPEC_SHA256,
      REVIEWED_ACTION_ATOMIC_FINALITY_MIGRATION_SHA256,
      REVIEWED_ACTION_ATOMIC_FINALITY_MIGRATION_SPEC_SHA256,
      REVIEWED_ACTION_ATOMIC_FINALITY_MIGRATION_INTEGRATION_SPEC_SHA256,
    ],
    [
      'f4ab74832dd8ff63608989129c728a0f66d789fdc784338f5661e72a6acefdda',
      'ba81fa57285644e5976094b5bf831486a5aaa276a318452db9c5e4b240fa98e1',
      '9224299e2df17f177ec6a1f6b46898a4fcff21464a69aad2af2255713b182f63',
      'e0e03424b4f8e4735541c3d0649cda89c3d0d7abccef8e6eb1298cda07bc73a8',
      'c72cc2b093fc3bbeb8f5fbcfd88c270e57db7617e6c4f85afe8a11c504a4349b',
      'ee6fb9a68cb3766a5a146ee9a435895ce13c5645976a4a0df9761c88e3c91bcb',
      'e94876618f421970d26e8385a292e42f1924529b93dc00574144e416a2488391',
      'c2f93d2974e5ffd81ac7894798edd4dc5af77f73ae14d4ed3d9df3617af1d073',
      '174ac457309a3ef938c72f93ba2158b7e3887ac40560db0fa92a5bba5e4e439c',
      'fbaf4c633c1a66f9248a5566bbafa0184a47f533f39764d55ea740ae86fbb326',
      '5a572918e6c0802852760a4235e9476f792a47f1c9d046fd5bccfa335dde66c6',
    ],
  );
});

test('action, provider, protocol, order, and chain drift fail closed', () => {
  const mutations = [
    (value) => {
      value.boundarySource = value.boundarySource.replace("  'REPAY',", "  'BRIDGE',");
    },
    (value) => {
      value.boundarySource = value.boundarySource.replace(
        "candidate('save', 'save-lend'",
        "candidate('save', 'solend'",
      );
    },
    (value) => {
      value.boundarySource = value.boundarySource.replace(
        "candidate('aave', 'aave-v3', 'eip155:1'),",
        "candidate('aave', 'aave-v3', 'eip155:8453'),",
      );
    },
    (value) => {
      value.boundarySource = value.boundarySource.replace(
        "candidate('aave', 'aave-v3', 'eip155:1'),",
        "candidate('morpho', 'morpho-blue', 'eip155:1'),",
      );
    },
    (value) => {
      value.boundarySource = value.boundarySource.replace(
        "candidate('jupiter', 'jupiter-lend', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'),",
        "candidate('jupiter', 'jupiter-lend', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'),\n    candidate('base', 'aave-v3', 'eip155:8453'),",
      );
    },
  ];
  mutations.forEach((mutate, index) => mutationRejected(`identity mutation ${index}`, mutate));
});

test('approval, limit, signing, broadcast, and decision activation fail closed', () => {
  const mutations = [
    ["mode: 'DISABLED' as const", "mode: 'ENABLED' as const"],
    ['approvedProviders: NO_APPROVALS', "approvedProviders: ['aave']"],
    ["perTransactionUsdMicros: '0' as const", "perTransactionUsdMicros: '1' as const"],
    ['apiMaySign: false as const', 'apiMaySign: true as const'],
    ['apiMayBroadcast: false as const', 'apiMayBroadcast: true as const'],
    ["decision: 'DENY' as const", "decision: 'ALLOW' as const"],
    ["'eip155:1': 'HALT' as const", "'eip155:1': 'GO' as const"],
  ];
  mutations.forEach(([from, to], index) =>
    mutationRejected(`authority mutation ${index}`, (value) => {
      value.boundarySource = value.boundarySource.replace(from, to);
    }),
  );
});

test('I/O, dynamic code, runtime decorators, and transaction construction fail closed', () => {
  for (const prohibited of [
    "\nprocess.env['RPC_URL'];",
    "\nfetch('https://rpc.invalid');",
    "\nimport('./transaction-writer');",
    "\nexport * from './transaction-writer';",
    "\nexport { request } from 'node:https';",
    '\nsendRawTransaction(payload);',
    "\nFunction('return true')();",
    '\n@Controller() class MainnetActionController {}',
  ]) {
    mutationRejected(prohibited, (value) => {
      value.boundarySource += prohibited;
    });
  }
  mutationRejected('unreviewed import', (value) => {
    value.boundarySource = `import { request } from 'node:https';\n${value.boundarySource}`;
  });
});

test('weak or detached tests fail closed', () => {
  mutationRejected('detached spec', (value) => {
    value.specSource = value.specSource.replace('./dormant-mainnet-financial-action', './other');
  });
  mutationRejected('insufficient depth', (value) => {
    value.specSource = "import './dormant-mainnet-financial-action';\ntest('only one', () => {});";
  });
  mutationRejected('marker-preserving fake spec', (value) => {
    value.specSource += "\n// new Proxy; decision: 'DENY'; test(\n";
  });
});

test('lifecycle bytes, pure imports, closed authority, and adversarial spec are exact', () => {
  mutationRejected('lifecycle source drift', (value) => {
    value.lifecycleSource += '\n// drift';
  });
  mutationRejected('lifecycle spec drift', (value) => {
    value.lifecycleSpecSource += '\n// drift';
  });
  mutationRejected('lifecycle I/O import', (value) => {
    value.lifecycleSource = `import { request } from 'node:https';\n${value.lifecycleSource}`;
  });
  mutationRejected('lifecycle dynamic load', (value) => {
    value.lifecycleSource += "\nvoid import('./wallet-broadcaster');";
  });
  mutationRejected('lifecycle execution authority', (value) => {
    value.lifecycleSource = value.lifecycleSource.replace(
      'executionAuthority: false as const',
      'executionAuthority: true as const',
    );
  });
  mutationRejected('lifecycle persistence authority', (value) => {
    value.lifecycleSource = value.lifecycleSource.replace(
      'persistenceAuthority: false as const',
      'persistenceAuthority: true as const',
    );
  });
  mutationRejected('detached lifecycle spec', (value) => {
    value.lifecycleSpecSource = value.lifecycleSpecSource.replace(
      './dormant-mainnet-financial-action-lifecycle',
      './other-lifecycle',
    );
  });
  mutationRejected('weak lifecycle spec', (value) => {
    value.lifecycleSpecSource =
      "import './dormant-mainnet-financial-action-lifecycle';\ntest('only one', () => {});";
  });
});

test('durable port and Postgres adapter bytes, imports, and exports are exact', () => {
  for (const [name, field, expectedError] of [
    [
      'durable port drift',
      'durablePortSource',
      'dormant durable port bytes drifted from the reviewed source',
    ],
    [
      'Postgres adapter drift',
      'postgresAdapterSource',
      'dormant Postgres adapter bytes drifted from the reviewed source',
    ],
    [
      'Postgres adapter spec drift',
      'postgresAdapterSpecSource',
      'dormant Postgres adapter spec bytes drifted from the reviewed source',
    ],
    [
      'Postgres adapter integration drift',
      'postgresAdapterIntegrationSpecSource',
      'dormant Postgres adapter integration spec bytes drifted from the reviewed source',
    ],
  ]) {
    mutationReports(name, expectedError, (value) => {
      value[field] += '\n// unreviewed drift';
    });
  }

  mutationReports('port import', 'dormant durable port import inventory changed', (value) => {
    value.durablePortSource = `import type { Signer } from 'ethers';\n${value.durablePortSource}`;
  });
  mutationReports(
    'adapter import',
    'dormant Postgres adapter import inventory changed',
    (value) => {
      value.postgresAdapterSource = `import { request } from 'node:https';\n${value.postgresAdapterSource}`;
    },
  );
  mutationReports('port export', 'dormant durable port export inventory changed', (value) => {
    value.durablePortSource += '\nexport type RuntimeMainnetWriter = unknown;';
  });
  mutationReports(
    'adapter export',
    'dormant Postgres adapter export inventory changed',
    (value) => {
      value.postgresAdapterSource += '\nexport class MainnetWriter {}';
    },
  );
  mutationReports(
    'test export',
    'dormant Postgres adapter tests export runtime capabilities',
    (value) => {
      value.postgresAdapterSpecSource += '\nexport const adapterFixture = true;';
    },
  );
});

test('cursor provenance and raw result review cannot become forgeable exports', () => {
  mutationReports(
    'Symbol cursor brand',
    'dormant durable lifecycle uses a reflectable Symbol cursor brand',
    (value) => {
      value.postgresAdapterSource += "\nconst CURSOR_BRAND = Symbol.for('clma-cursor');";
    },
  );
  for (const source of [
    '\nexport function decodeDormantMainnetFinancialActionDatabaseResult() {}',
    '\nexport const createDormantMainnetFinancialActionDatabaseOutcomeUnknown = () => ({});',
    '\nexport type DormantMainnetFinancialActionLifecycleDatabaseCommandV1 = unknown;',
    '\nexport class DormantMainnetFinancialActionLifecycleDatabaseCodecError extends Error {}',
  ]) {
    mutationReports(
      source,
      'dormant Postgres adapter exposes a standalone raw decoder, outcome maker, or database command',
      (value) => {
        value.postgresAdapterSource += source;
      },
    );
  }
});

test('adapter database access is one-call, cancellable, allowlisted, and retry-free', () => {
  mutationReports(
    'SQL function drift',
    'dormant Postgres adapter function-SQL allowlist changed',
    (value) => {
      value.postgresAdapterSource = value.postgresAdapterSource.replace(
        'read_mainnet_financial_action_lifecycle',
        'write_unreviewed_mainnet_financial_action',
      );
    },
  );
  mutationReports(
    'V1 prepare fallback',
    'dormant Postgres adapter no longer uses only the address-bound V2 prepare call',
    (value) => {
      value.postgresAdapterSource = value.postgresAdapterSource.replace(
        'FROM prepare_mainnet_financial_action_lifecycle_v2(',
        'FROM prepare_mainnet_financial_action_lifecycle(',
      );
    },
  );
  mutationReports(
    'second database call',
    'dormant Postgres adapter no longer performs one cancellable call without retry',
    (value) => {
      value.postgresAdapterSource +=
        '\nvoid Reflect.apply(this.#databaseQuery, this.#databaseReceiver, []);';
    },
  );
  for (const source of [
    "\nvoid postgres.query('SELECT 1');",
    '\nvoid postgres.withTransaction(async () => undefined);',
    '\nconst retryAttempts = 2;',
    '\nsetTimeout(() => undefined, 1);',
  ]) {
    mutationReports(
      source,
      'dormant Postgres adapter no longer performs one cancellable call without retry',
      (value) => {
        value.postgresAdapterSource += source;
      },
    );
  }
});

test('adapter candidates stay internally derived, V2-only, and out of logs', () => {
  mutationReports(
    'caller-authored candidate versions',
    'dormant Postgres adapter no longer derives wallet identity candidates internally',
    (value) => {
      value.postgresAdapterSource = value.postgresAdapterSource.replace(
        "  'correlationId',",
        "  'correlationId',\n  'walletIdentityDigestVersions',",
      );
    },
  );
  mutationReports(
    'digest derivation removed',
    'dormant Postgres adapter no longer derives wallet identity candidates internally',
    (value) => {
      value.postgresAdapterSource = value.postgresAdapterSource.replace(
        'const reference = digestWalletIdentity(key, networkId, canonicalAddress);',
        'const reference = candidate;',
      );
    },
  );
  for (const source of [
    '\nlogger.info(walletIdentityDigestCandidates);',
    '\nJSON.stringify(walletIdentityKeyRing);',
  ]) {
    mutationReports(
      source,
      'dormant Postgres adapter can log or serialize wallet identity key material',
      (value) => {
        value.postgresAdapterSource += source;
      },
    );
  }
});

test('adapter grants, DDL, registration, barrels, and execution authority fail closed', () => {
  for (const source of [
    "\nconst grant = 'GRANT EXECUTE ON FUNCTION unsafe TO crypto_api_runtime';",
    "\nconst ddl = 'CREATE TABLE unsafe(value text)';",
  ]) {
    mutationReports(
      source,
      'dormant Postgres adapter contains grant, DDL, or write-table SQL authority',
      (value) => {
        value.postgresAdapterSource += source;
      },
    );
  }
  for (const source of [
    '\n@Injectable() class RegisteredAdapter {}',
    "\nexport * from './runtime-mainnet-writer';",
    '\nconst moduleMetadata = { providers: [PostgresDormantMainnetFinancialActionLifecycleDurableAdapter] };',
  ]) {
    mutationReports(
      source,
      'dormant durable lifecycle is registered, re-exported, dynamic, or network-capable',
      (value) => {
        value.postgresAdapterSource += source;
      },
    );
  }
  for (const source of [
    '\nsendTransaction(payload);',
    "\nconst provider = new JsonRpcProvider('https://rpc.invalid');",
    "\nenqueue('job_outbox');",
    '\nconst unsafe = { ledgerSettlementAuthority: true };',
  ]) {
    mutationReports(
      source,
      'dormant durable lifecycle gained signer, provider, outbox, retry, or ledger authority',
      (value) => {
        value.postgresAdapterSource += source;
      },
    );
  }
});

test('adapter unit and loopback integration security evidence is pinned', () => {
  mutationReports(
    'unit provenance coverage removed',
    'dormant Postgres adapter spec lost exact provenance, one-call, or denial coverage',
    (value) => {
      value.postgresAdapterSpecSource = value.postgresAdapterSpecSource.replace(
        "Symbol.for('forged-clma-brand')",
        "'removed-forged-brand'",
      );
    },
  );
  mutationReports(
    'unit wallet key-ring rejection removed',
    'dormant Postgres adapter spec lost exact provenance, one-call, or denial coverage',
    (value) => {
      value.postgresAdapterSpecSource = value.postgresAdapterSpecSource.replace(
        'rejects forged identity key rings before any database operation',
        'accepts unreviewed identity configuration',
      );
    },
  );
  for (const [name, from, to] of [
    ['loopback removed', "!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)", 'false'],
    ['PostgreSQL 16 removed', 'serverVersionNum < 160_000', 'serverVersionNum < 1'],
    ['migration cap widened', "({ id }) => id <= '0034'", "({ id }) => id <= '9999'"],
    [
      'direct reconciliation removed',
      'await adapter.recordReconciliation(reconciliationRequest)',
      'await adapter.recordBroadcast(reconciliationRequest)',
    ],
    ['settlement authority enabled', 'ledger_authority_count: 0', 'ledger_authority_count: 1'],
    ['rotation evidence removed', 'accepted_read_versions: [2]', 'accepted_read_versions: [1]'],
  ]) {
    mutationReports(
      name,
      'dormant Postgres adapter integration lost loopback 0034 flow or denial coverage',
      (value) => {
        value.postgresAdapterIntegrationSpecSource =
          value.postgresAdapterIntegrationSpecSource.replace(from, to);
      },
    );
  }
});

test('authenticated finality source and producer stay dormant and semantically pinned', () => {
  for (const [field, expectedError] of [
    [
      'finalityEvidenceSourcePortSource',
      'authenticated finality source port bytes drifted from the reviewed source',
    ],
    [
      'finalityEvidenceSourcePortSpecSource',
      'authenticated finality source port spec bytes drifted from the reviewed source',
    ],
    [
      'finalityEvidenceProducerSource',
      'authenticated finality producer bytes drifted from the reviewed source',
    ],
    [
      'finalityEvidenceProducerSpecSource',
      'authenticated finality producer spec bytes drifted from the reviewed source',
    ],
  ]) {
    mutationReports(field, expectedError, (value) => {
      value[field] += '\n// unreviewed drift';
    });
  }
  mutationReports(
    'third chain',
    'authenticated finality producer gained registration, retry, egress, or authority',
    (value) => {
      value.finalityEvidenceProducerSource += "\nconst BASE = 'eip155:8453';";
    },
  );
  mutationReports(
    'recurring timer',
    'authenticated finality producer gained registration, retry, egress, or authority',
    (value) => {
      value.finalityEvidenceProducerSource += '\nsetInterval(() => undefined, 1);';
    },
  );
  mutationReports(
    'not-yet-durable action coverage removed',
    'authenticated finality source or producer specs lost fail-closed evidence',
    (value) => {
      value.finalityEvidenceProducerSpecSource = value.finalityEvidenceProducerSpecSource.replace(
        "it.each(['BORROW', 'REPAY'] as const)(",
        "it.each(['BORROW'] as const)(",
      );
    },
  );
});

test('legacy lifecycle cannot author terminal reconciliation evidence', () => {
  mutationReports(
    'terminal legacy input',
    'legacy durable adapter no longer excludes caller-authored terminal reconciliation',
    (value) => {
      value.postgresAdapterSource = value.postgresAdapterSource.replace(
        "Object.freeze(['PENDING', 'UNKNOWN']);",
        "Object.freeze(['PENDING', 'UNKNOWN', 'FINALIZED_SUCCESS']);",
      );
    },
  );
  mutationReports(
    'terminal rejection coverage removed',
    'legacy durable adapter no longer excludes caller-authored terminal reconciliation',
    (value) => {
      value.postgresAdapterSpecSource = value.postgresAdapterSpecSource.replace(
        'rejects caller-authored terminal reconciliation %s before database I/O',
        'accepts terminal reconciliation',
      );
    },
  );
});

test('authenticated finality sidecar stays one-call, provenance-bound, and authority-free', () => {
  for (const [field, expectedError] of [
    [
      'finalitySidecarPortSource',
      'authenticated finality sidecar port bytes drifted from the reviewed source',
    ],
    [
      'finalitySidecarPortSpecSource',
      'authenticated finality sidecar port spec bytes drifted from the reviewed source',
    ],
    [
      'finalitySidecarAdapterSource',
      'authenticated finality sidecar adapter bytes drifted from the reviewed source',
    ],
    [
      'finalitySidecarAdapterSpecSource',
      'authenticated finality sidecar adapter spec bytes drifted from the reviewed source',
    ],
  ]) {
    mutationReports(field, expectedError, (value) => {
      value[field] += '\n// unreviewed drift';
    });
  }
  mutationReports(
    'sidecar SQL drift',
    'authenticated finality sidecar SQL or argument allowlist changed',
    (value) => {
      value.finalitySidecarAdapterSource = value.finalitySidecarAdapterSource.replace(
        'read_mainnet_financial_action_effective_safety_state_v1',
        'write_mainnet_financial_action_effective_safety_state_v1',
      );
    },
  );
  mutationReports(
    'sidecar retry',
    'authenticated finality sidecar no longer performs one cancellable call without retry',
    (value) => {
      value.finalitySidecarAdapterSource += '\nconst retryAttempts = 2;';
    },
  );
  mutationReports(
    'sidecar signer',
    'authenticated finality sidecar gained registration, SQL, signing, or settlement authority',
    (value) => {
      value.finalitySidecarAdapterSource += '\nsignTransaction(payload);';
    },
  );
});

test('0035 authenticated finality remains exact, owner-only, and fail closed', () => {
  for (const [field, expectedError] of [
    [
      'authenticatedFinalityMigrationSource',
      '0035 authenticated finality migration bytes drifted from the reviewed source',
    ],
    [
      'authenticatedFinalityMigrationSpecSource',
      '0035 authenticated finality migration spec bytes drifted from the reviewed source',
    ],
    [
      'authenticatedFinalityMigrationIntegrationSpecSource',
      '0035 authenticated finality migration integration spec bytes drifted from the reviewed source',
    ],
  ]) {
    mutationReports(field, expectedError, (value) => {
      value[field] += '\n// unreviewed drift';
    });
  }
  mutationReports(
    '0035 runtime grant',
    '0035 authenticated finality seeds, grants, registers, widens, or executes authority',
    (value) => {
      value.authenticatedFinalityMigrationSource +=
        "\nconst unsafe = 'GRANT EXECUTE ON FUNCTION unsafe TO crypto_api_runtime';";
    },
  );
  mutationReports(
    '0035 authority seed',
    '0035 authenticated finality seeds, grants, registers, widens, or executes authority',
    (value) => {
      value.authenticatedFinalityMigrationSource +=
        '\nconst seed = `INSERT INTO mainnet_financial_action_reconciliation_source_authorities DEFAULT VALUES`;';
    },
  );
  mutationReports(
    '0035 action widening',
    "0035 authenticated finality lacks fail-closed marker: action_type IN ('SUPPLY', 'WITHDRAW')",
    (value) => {
      value.authenticatedFinalityMigrationSource =
        value.authenticatedFinalityMigrationSource.replace(
          "action_type IN ('SUPPLY', 'WITHDRAW')",
          "action_type IN ('SUPPLY', 'WITHDRAW', 'BORROW')",
        );
    },
  );
});

test('0036 prerequisites and 0037 atomic persistence remain exact and authority-free', () => {
  for (const [field, expectedError] of [
    [
      'finalityPrerequisiteIssuerPortSource',
      '0036 finality prerequisite issuer port bytes drifted from the reviewed source',
    ],
    [
      'finalityPrerequisiteAdapterSource',
      '0036 finality prerequisite adapter bytes drifted from the reviewed source',
    ],
    [
      'finalityPrerequisiteAdapterSpecSource',
      '0036 finality prerequisite adapter spec bytes drifted from the reviewed source',
    ],
    [
      'finalityWalletReaderSource',
      '0036 finality wallet reader bytes drifted from the reviewed source',
    ],
    [
      'finalityWalletReaderSpecSource',
      '0036 finality wallet reader spec bytes drifted from the reviewed source',
    ],
    [
      'finalityPrerequisiteMigrationSource',
      '0036 finality prerequisite migration bytes drifted from the reviewed source',
    ],
    [
      'finalityPrerequisiteMigrationSpecSource',
      '0036 finality prerequisite migration spec bytes drifted from the reviewed source',
    ],
    [
      'finalityPrerequisiteMigrationIntegrationSpecSource',
      '0036 finality prerequisite migration integration spec bytes drifted from the reviewed source',
    ],
    [
      'atomicFinalityMigrationSource',
      '0037 atomic finality migration bytes drifted from the reviewed source',
    ],
    [
      'atomicFinalityMigrationSpecSource',
      '0037 atomic finality migration spec bytes drifted from the reviewed source',
    ],
    [
      'atomicFinalityMigrationIntegrationSpecSource',
      '0037 atomic finality migration integration spec bytes drifted from the reviewed source',
    ],
  ]) {
    mutationReports(field, expectedError, (value) => {
      value[field] += '\n// unreviewed drift';
    });
  }
  mutationReports(
    '0036 prerequisite SQL drift',
    '0036 prerequisite adapter SQL or one-shot dispatch allowlist changed',
    (value) => {
      value.finalityPrerequisiteAdapterSource = value.finalityPrerequisiteAdapterSource.replace(
        'read_mainnet_financial_action_reconciliation_prerequisite_v2',
        'write_mainnet_financial_action_reconciliation_prerequisite_v1',
      );
    },
  );
  mutationReports(
    'wallet signer',
    '0036 prerequisite or wallet adapter gained runtime, signing, or settlement authority',
    (value) => {
      value.finalityWalletReaderSource += '\nsignTransaction(payload);';
    },
  );
  mutationReports(
    '0036 runtime grant',
    '0036 prerequisite migration grants, persists, signs, or broadcasts authority',
    (value) => {
      value.finalityPrerequisiteMigrationSource +=
        "\nconst unsafe = 'GRANT EXECUTE ON FUNCTION unsafe TO crypto_api_runtime';";
    },
  );
  mutationReports(
    '0037 unreviewed v1 dependency',
    '0037 internal v1 database-call allowlist changed',
    (value) => {
      value.atomicFinalityMigrationSource += '\nconst unsafe = `unreviewed_mainnet_writer_v1()`;';
    },
  );
  mutationReports(
    '0037 runtime grant',
    '0037 atomic finality migration grants, persists extra state, signs, or broadcasts',
    (value) => {
      value.atomicFinalityMigrationSource +=
        "\nconst unsafe = 'GRANT EXECUTE ON FUNCTION unsafe TO crypto_api_runtime';";
    },
  );
});

test('the exact 0033 migration, spec, and index inventory is pinned', () => {
  mutationReports(
    'migration byte drift',
    '0033 action lifecycle migration bytes drifted from the reviewed source',
    (value) => {
      value.migrationSource += '\n// unauthorized drift';
    },
  );
  mutationReports(
    'migration spec byte drift',
    '0033 action lifecycle migration spec bytes drifted from the reviewed source',
    (value) => {
      value.migrationSpecSource += '\n// weakened review';
    },
  );
  mutationReports(
    'migration index byte drift',
    'database migration index bytes drifted from the reviewed 0033-0037 registration',
    (value) => {
      value.migrationIndexSource += '\n// reordered elsewhere';
    },
  );
  mutationReports(
    'predecessor drift',
    '0033 migration identity or predecessor verification changed',
    (value) => {
      value.migrationSource = value.migrationSource.replace(
        "supersedesVerificationOf: ['0032']",
        "supersedesVerificationOf: ['0031']",
      );
    },
  );
});

test('the exact 0034 migration and focused security evidence are pinned', () => {
  for (const [name, field, expectedError] of [
    [
      '0034 migration byte drift',
      'walletIdentityBindingMigrationSource',
      '0034 wallet identity binding migration bytes drifted from the reviewed source',
    ],
    [
      '0034 migration spec byte drift',
      'walletIdentityBindingMigrationSpecSource',
      '0034 wallet identity binding migration spec bytes drifted from the reviewed source',
    ],
    [
      '0034 migration integration byte drift',
      'walletIdentityBindingMigrationIntegrationSpecSource',
      '0034 wallet identity binding migration integration spec bytes drifted from the reviewed source',
    ],
  ]) {
    mutationReports(name, expectedError, (value) => {
      value[field] += '\n// unreviewed drift';
    });
  }
  mutationReports(
    '0034 detached import',
    '0034 wallet identity binding migration import or export inventory changed',
    (value) => {
      value.walletIdentityBindingMigrationSource = `import { request } from 'node:https';\n${value.walletIdentityBindingMigrationSource}`;
    },
  );
  mutationReports(
    '0034 weak migration spec',
    '0034 wallet identity binding migration spec lost fail-closed evidence',
    (value) => {
      value.walletIdentityBindingMigrationSpecSource =
        value.walletIdentityBindingMigrationSpecSource.replace(
          'validates a bounded exact key ring and every digest',
          'performs a shallow happy-path check',
        );
    },
  );
  mutationReports(
    '0034 weak loopback integration',
    '0034 wallet identity binding loopback integration lost security evidence',
    (value) => {
      value.walletIdentityBindingMigrationIntegrationSpecSource =
        value.walletIdentityBindingMigrationIntegrationSpecSource.replaceAll(
          'hostileCandidates',
          'uncheckedCandidates',
        );
    },
  );
});

test('0034 function identity, candidate proof, lock order, and rotation rules fail closed', () => {
  mutationReports(
    'function identity changed',
    '0034 wallet identity binding migration or function identity changed',
    (value) => {
      value.walletIdentityBindingMigrationSource =
        value.walletIdentityBindingMigrationSource.replace(
          "uuid,smallint[],text[])';",
          "uuid,text[],text[])';",
        );
    },
  );
  mutationReports(
    'accepted-version equality removed',
    '0034 wallet identity candidate validation lost marker: IS DISTINCT FROM policy_accepted_read_versions',
    (value) => {
      value.walletIdentityBindingMigrationSource =
        value.walletIdentityBindingMigrationSource.replace(
          'IS DISTINCT FROM policy_accepted_read_versions',
          'IS NOT DISTINCT FROM policy_accepted_read_versions',
        );
    },
  );
  mutationReports(
    'wallet lock removed',
    '0034 wallet identity binding lost atomic proof marker: FOR UPDATE OF operation, submission, ledger_transaction, wallet',
    (value) => {
      value.walletIdentityBindingMigrationSource =
        value.walletIdentityBindingMigrationSource.replace(
          'FOR UPDATE OF operation, submission, ledger_transaction, wallet',
          'FOR UPDATE OF operation',
        );
    },
  );
  mutationReports(
    'parent digest required after rotation',
    '0034 wallet identity binding incorrectly requires the immutable parent digest',
    (value) => {
      value.walletIdentityBindingMigrationSource =
        value.walletIdentityBindingMigrationSource.replace(
          "AND wallet.registry_environment = 'MAINNET'",
          "AND wallet.registry_environment = 'MAINNET'\n        AND wallet.address_digest_version = requested_wallet_identity_digest_versions[1]",
        );
    },
  );
  mutationReports(
    'second V1 delegation',
    '0034 wallet identity binding no longer delegates exactly once to reviewed 0033',
    (value) => {
      value.walletIdentityBindingMigrationSource =
        value.walletIdentityBindingMigrationSource.replace(
          'RETURN QUERY SELECT * FROM prepare_mainnet_financial_action_lifecycle(',
          'PERFORM prepare_mainnet_financial_action_lifecycle(\n        requested_intent_id);\n      RETURN QUERY SELECT * FROM prepare_mainnet_financial_action_lifecycle(',
        );
    },
  );
});

test('0034 grants, runtime activation, candidate persistence, and logging fail closed', () => {
  for (const source of [
    "\nconst unsafeGrant = 'GRANT EXECUTE ON FUNCTION prepare_mainnet_financial_action_lifecycle_v2 TO crypto_api_runtime';",
    '\n@Controller() class RuntimeWalletBinding {}',
    "\nconst unreviewedNetwork = 'eip155:8453';",
  ]) {
    mutationReports(
      source,
      '0034 wallet identity binding grants, registers, widens, or executes authority',
      (value) => {
        value.walletIdentityBindingMigrationSource += source;
      },
    );
  }
  for (const [name, injected] of [
    [
      'candidate persistence',
      'INSERT INTO unsafe_wallet_candidate_log VALUES (requested_wallet_identity_digests_hex);',
    ],
    [
      'candidate logging',
      "RAISE LOG 'wallet identity candidates %', requested_wallet_identity_digests_hex;",
    ],
  ]) {
    mutationReports(
      name,
      '0034 wallet identity candidates can be logged, persisted, or exposed',
      (value) => {
        value.walletIdentityBindingMigrationSource =
          value.walletIdentityBindingMigrationSource.replace(
            'RETURN QUERY SELECT * FROM prepare_mainnet_financial_action_lifecycle(',
            `${injected}\n      RETURN QUERY SELECT * FROM prepare_mainnet_financial_action_lifecycle(`,
          );
      },
    );
  }
});

test('0033-0037 index registration and exact predecessor order fail closed', () => {
  mutationReports(
    'production order drift',
    '0033-0037 migration index registration, predecessor order, or export inventory changed',
    (value) => {
      value.migrationIndexSource = value.migrationIndexSource.replace(
        /createMainnetBalanceAgreementEvidenceV2MigrationV0032,\s+createMainnetFinancialActionLifecycleMigrationV0033,/u,
        'createMainnetFinancialActionLifecycleMigrationV0033,\n  createMainnetBalanceAgreementEvidenceV2MigrationV0032,',
      );
    },
  );
  mutationReports(
    'wallet binding order drift',
    '0033-0037 migration index registration, predecessor order, or export inventory changed',
    (value) => {
      value.migrationIndexSource = value.migrationIndexSource.replace(
        /createMainnetFinancialActionLifecycleMigrationV0033,\s+createMainnetFinancialActionWalletIdentityBindingMigrationV0034,/u,
        'createMainnetFinancialActionWalletIdentityBindingMigrationV0034,\n  createMainnetFinancialActionLifecycleMigrationV0033,',
      );
    },
  );
  mutationReports(
    'duplicate registration',
    '0033-0037 migration index registration, predecessor order, or export inventory changed',
    (value) => {
      value.migrationIndexSource = value.migrationIndexSource.replaceAll(
        'createMainnetFinancialActionLifecycleMigrationV0033,',
        'createMainnetFinancialActionLifecycleMigrationV0033,\n  createMainnetFinancialActionLifecycleMigrationV0033,',
      );
    },
  );
  mutationReports(
    'duplicate wallet binding registration',
    '0033-0037 migration index registration, predecessor order, or export inventory changed',
    (value) => {
      value.migrationIndexSource = value.migrationIndexSource.replaceAll(
        'createMainnetFinancialActionWalletIdentityBindingMigrationV0034,',
        'createMainnetFinancialActionWalletIdentityBindingMigrationV0034,\n  createMainnetFinancialActionWalletIdentityBindingMigrationV0034,',
      );
    },
  );
  mutationReports(
    'duplicate authenticated finality registration',
    '0033-0037 migration index registration, predecessor order, or export inventory changed',
    (value) => {
      value.migrationIndexSource = value.migrationIndexSource.replaceAll(
        'createMainnetFinancialActionAuthenticatedFinalityMigrationV0035,',
        'createMainnetFinancialActionAuthenticatedFinalityMigrationV0035,\n  createMainnetFinancialActionAuthenticatedFinalityMigrationV0035,',
      );
    },
  );
  mutationReports(
    '0036/0037 predecessor order drift',
    '0033-0037 migration index registration, predecessor order, or export inventory changed',
    (value) => {
      value.migrationIndexSource = value.migrationIndexSource.replace(
        /createMainnetFinancialActionFinalityPrerequisiteReadMigrationV0036,\s+createMainnetFinancialActionAtomicFinalityPersistenceMigrationV0037,/u,
        'createMainnetFinancialActionAtomicFinalityPersistenceMigrationV0037,\n  createMainnetFinancialActionFinalityPrerequisiteReadMigrationV0036,',
      );
    },
  );
  mutationReports(
    'detached 0037 import',
    '0033-0037 migration index registration, predecessor order, or export inventory changed',
    (value) => {
      value.migrationIndexSource = value.migrationIndexSource.replace(
        "from './0037-atomically-persist-mainnet-financial-action-finality.migration';",
        "from './0037-unreviewed.migration';",
      );
    },
  );
  mutationReports(
    'detached wallet binding import',
    '0033-0037 migration index registration, predecessor order, or export inventory changed',
    (value) => {
      value.migrationIndexSource = value.migrationIndexSource.replace(
        "from './0034-bind-mainnet-financial-action-wallet-identity.migration';",
        "from './0034-unreviewed.migration';",
      );
    },
  );
  mutationReports(
    'detached import',
    '0033-0037 migration index registration, predecessor order, or export inventory changed',
    (value) => {
      value.migrationIndexSource = value.migrationIndexSource.replace(
        "from './0033-create-mainnet-financial-action-lifecycle.migration';",
        "from './0033-unreviewed.migration';",
      );
    },
  );
});

test('0033 weak specs, grants, and authority activation fail closed', () => {
  mutationReports(
    'weak spec',
    '0033 migration spec is weak, detached, or no longer tests the dormant boundary',
    (value) => {
      value.migrationSpecSource = value.migrationSpecSource.replaceAll(
        'encodeClmaFp1',
        'removedFingerprintReview',
      );
    },
  );
  mutationReports(
    'runtime grant',
    '0033 migration grants or activates runtime financial-action authority',
    (value) => {
      value.migrationSource +=
        '\nconst unsafeGrant = `GRANT EXECUTE ON FUNCTION prepare_mainnet_financial_action_lifecycle TO crypto_api_runtime;`;';
    },
  );
  mutationReports(
    'API signing authority',
    '0033 migration lacks dormant authority marker: AND NOT api_may_sign AND NOT api_may_broadcast',
    (value) => {
      value.migrationSource = value.migrationSource.replace(
        'AND NOT api_may_sign AND NOT api_may_broadcast',
        'AND api_may_sign AND api_may_broadcast',
      );
    },
  );
  mutationReports(
    'database replay disabled',
    '0033 migration lacks dormant authority marker: AND database_replay_protection_enforced',
    (value) => {
      value.migrationSource = value.migrationSource.replace(
        'AND database_replay_protection_enforced',
        'AND NOT database_replay_protection_enforced',
      );
    },
  );
});

test('0033 prepare, bind, and crash-recovery guarantees fail closed', () => {
  mutationReports(
    'prepare accepts revoked wallets',
    '0033 prepare path no longer requires an active wallet and unexpired intent',
    (value) => {
      value.migrationSource = value.migrationSource.replace(
        "OR wallet_status <> 'ACTIVE'",
        "OR wallet_status <> 'ANY'",
      );
    },
  );
  mutationReports(
    'bind accepts expired intents',
    '0033 bind path no longer requires an active wallet and unexpired intent',
    (value) => {
      value.migrationSource = value.migrationSource.replace(
        'OR database_recorded_at >= intent.expires_at',
        'OR database_recorded_at < intent.expires_at',
      );
    },
  );
  mutationReports(
    'post-bind expiry gate',
    '0033 post-bind evidence path can be stranded by wallet, operation, or expiry drift',
    (value) => {
      value.migrationSource = value.migrationSource.replace(
        "IF current_event.stage <> 'WALLET_SIGNED_SUBMISSION_BOUND'",
        "IF intent.expires_at <= database_recorded_at\n        OR current_event.stage <> 'WALLET_SIGNED_SUBMISSION_BOUND'",
      );
    },
  );
  mutationReports(
    'direct reconciliation removed',
    '0033 reconciliation cannot recover directly from a signed-bound submission',
    (value) => {
      value.migrationSource = value.migrationSource.replace(
        "current_event.stage NOT IN (\n          'WALLET_SIGNED_SUBMISSION_BOUND',",
        "current_event.stage NOT IN (\n          'BROADCAST_REQUIRED',",
      );
    },
  );
});

test('0033 canonical identities, digest-only evidence, framing, and goldens fail closed', () => {
  mutationReports(
    'public transaction identity removed',
    '0033 migration lacks canonical public identity or digest evidence: chain_transaction_id text',
    (value) => {
      value.migrationSource = value.migrationSource.replaceAll(
        'chain_transaction_id text',
        'chain_transaction_digest text',
      );
    },
  );
  mutationReports(
    'raw signature persisted',
    '0033 migration persists raw signing, transaction, credential, or endpoint material',
    (value) => {
      value.migrationSource += '\nconst unsafeSchema = `wallet_signature bytea`;';
    },
  );
  mutationReports(
    'fingerprint frame changed',
    '0033 CLMA-FP-1 framing or reviewed golden vectors changed',
    (value) => {
      value.migrationSource = value.migrationSource.replaceAll('434c4d41465001', '434c4d41465002');
    },
  );
  mutationReports(
    'golden digest changed',
    '0033 CLMA-FP-1 framing or reviewed golden vectors changed',
    (value) => {
      value.migrationSource = value.migrationSource.replace(
        'e672e31e8e43af4e842b455732232f6edcb398b4be16b0e2481127877781b16c',
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      );
    },
  );
});

test('only the reviewed migration index may wire or reference 0033-0037 at runtime', () => {
  assert.ok(baseline.runtimeSources.has(DATABASE_MIGRATION_INDEX_PATH));
  mutationReports(
    'runtime migration import',
    '0033-0037 dormant action persistence is referenced by runtime source apps/api/src/application-root.ts',
    (value) => {
      value.runtimeSources.set(
        'apps/api/src/application-root.ts',
        `${value.runtimeSources.get('apps/api/src/application-root.ts')}\nimport { createMainnetFinancialActionLifecycleMigrationV0033 } from './infrastructure/database/migrations/0033-create-mainnet-financial-action-lifecycle.migration';`,
      );
    },
  );
  mutationReports(
    'runtime wallet binding migration import',
    '0033-0037 dormant action persistence is referenced by runtime source apps/api/src/application-root.ts',
    (value) => {
      value.runtimeSources.set(
        'apps/api/src/application-root.ts',
        `${value.runtimeSources.get('apps/api/src/application-root.ts')}\nimport { createMainnetFinancialActionWalletIdentityBindingMigrationV0034 } from './infrastructure/database/migrations/0034-bind-mainnet-financial-action-wallet-identity.migration';`,
      );
    },
  );
  mutationReports(
    'runtime repository access',
    '0033-0037 dormant action persistence is referenced by runtime source apps/api/src/mainnet-actions/runtime-repository.ts',
    (value) => {
      value.runtimeSources.set(
        'apps/api/src/mainnet-actions/runtime-repository.ts',
        "export const query = 'SELECT * FROM mainnet_financial_action_intents';",
      );
    },
  );
  mutationReports(
    'runtime lifecycle SQL function',
    'migration-0033-0037 action SQL function is referenced outside the reviewed adapters by runtime source apps/api/src/mainnet-actions/unsafe-durable-store.ts',
    (value) => {
      value.runtimeSources.set(
        'apps/api/src/mainnet-actions/unsafe-durable-store.ts',
        "const sql = 'SELECT * FROM prepare_mainnet_financial_action_lifecycle($1)';",
      );
    },
  );
  mutationReports(
    'runtime V2 lifecycle SQL function',
    'migration-0033-0037 action SQL function is referenced outside the reviewed adapters by runtime source apps/api/src/mainnet-actions/unsafe-wallet-binding-store.ts',
    (value) => {
      value.runtimeSources.set(
        'apps/api/src/mainnet-actions/unsafe-wallet-binding-store.ts',
        "const sql = 'SELECT * FROM prepare_mainnet_financial_action_lifecycle_v2($1)';",
      );
    },
  );
  mutationReports(
    'raw atomic-finality v2 callsite',
    'migration-0033-0037 action SQL function is referenced outside the reviewed adapters by runtime source apps/api/src/mainnet-actions/unsafe-atomic-finality-store.ts',
    (value) => {
      value.runtimeSources.set(
        'apps/api/src/mainnet-actions/unsafe-atomic-finality-store.ts',
        "const sql = 'SELECT * FROM record_authenticated_mainnet_financial_action_reconciliation_v2($1)';",
      );
    },
  );
  mutationReports(
    'alternate 0036 prerequisite reference',
    'dormant mainnet action boundary is referenced by runtime source apps/api/src/mainnet-actions/unsafe-prerequisite-loader.ts',
    (value) => {
      value.runtimeSources.set(
        'apps/api/src/mainnet-actions/unsafe-prerequisite-loader.ts',
        "import './infrastructure/database/migrations/0036-read-mainnet-financial-action-finality-prerequisite.migration';",
      );
    },
  );
  mutationReports(
    'alternate 0037 persistence reference',
    '0033-0037 dormant action persistence is referenced by runtime source apps/api/src/mainnet-actions/unsafe-atomic-loader.ts',
    (value) => {
      value.runtimeSources.set(
        'apps/api/src/mainnet-actions/unsafe-atomic-loader.ts',
        'const migration = createMainnetFinancialActionAtomicFinalityPersistenceMigration;',
      );
    },
  );
});

test('any runtime reference to the dormant boundary fails closed', () => {
  for (const source of [
    "export * from './domain/dormant-mainnet-financial-action';",
    'providers: [DormantMainnetFinancialActionService]',
    'assessDormantMainnetFinancialAction(candidate, now);',
  ]) {
    mutationRejected(source, (value) => {
      value.runtimeSources.set('apps/api/src/mainnet-actions/runtime.ts', source);
    });
  }
  mutationRejected('compiled test barrel', (value) => {
    value.runtimeSources.set(
      'apps/api/src/mainnet-actions/unsafe.test.ts',
      "export * from './domain/dormant-mainnet-financial-action';",
    );
  });
  mutationRejected('split dynamic path', (value) => {
    value.runtimeSources.set(
      'apps/api/src/mainnet-actions/unsafe-runtime.ts',
      "void import('./domain/dormant-mainnet-' + 'financial-action');",
    );
  });
  for (const source of [
    "export * from './domain/dormant-mainnet-financial-action-lifecycle';",
    'createDormantMainnetFinancialActionLifecycleProtocol();',
    'providers: [DormantMainnetFinancialActionLifecycleProtocol]',
  ]) {
    mutationRejected(source, (value) => {
      value.runtimeSources.set('apps/api/src/mainnet-actions/lifecycle-runtime.ts', source);
    });
  }
  mutationRejected('split lifecycle dynamic path', (value) => {
    value.runtimeSources.set(
      'apps/api/src/mainnet-actions/lifecycle-loader.ts',
      "void import('./domain/dormant-mainnet-financial-action-' + 'lifecycle');",
    );
  });
  for (const source of [
    "export * from './application/ports/dormant-mainnet-financial-action-lifecycle-durable.port';",
    "import { PostgresDormantMainnetFinancialActionLifecycleDurableAdapter } from './infrastructure/postgres-dormant-mainnet-financial-action-lifecycle-durable.adapter';",
    'const moduleMetadata = { providers: [PostgresDormantMainnetFinancialActionLifecycleDurableAdapter] };',
  ]) {
    mutationRejected(source, (value) => {
      value.runtimeSources.set('apps/api/src/mainnet-actions/unsafe-durable-runtime.ts', source);
    });
  }
  mutationReports(
    'standalone codec restored',
    'standalone dormant lifecycle database codec must remain absent',
    (value) => {
      value.runtimeSources.set(
        'apps/api/src/mainnet-actions/application/dormant-mainnet-financial-action-lifecycle-database.codec.ts',
        'export const rawDecode = () => undefined;',
      );
    },
  );
});

test('malformed snapshots and runtime inventories fail closed without throwing', () => {
  assert.deepEqual(validateDormantMainnetActionBoundarySnapshot(null), [
    'action boundary snapshot is malformed',
  ]);
  mutationRejected('malformed runtime entry', (value) => {
    value.runtimeSources.set(1, null);
  });
  mutationRejected('missing migration source', (value) => {
    delete value.migrationSource;
  });
  mutationRejected('missing wallet binding migration source', (value) => {
    delete value.walletIdentityBindingMigrationSource;
  });
  mutationRejected('malformed migration index', (value) => {
    value.migrationIndexSource = null;
  });
  mutationRejected('boundary in consumers', (value) => {
    value.runtimeSources.set(ACTION_BOUNDARY_PATH, value.boundarySource);
  });
  mutationRejected('lifecycle in consumers', (value) => {
    value.runtimeSources.set(ACTION_LIFECYCLE_PATH, value.lifecycleSource);
  });
  mutationRejected('durable port in consumers', (value) => {
    value.runtimeSources.set(ACTION_LIFECYCLE_DURABLE_PORT_PATH, value.durablePortSource);
  });
  mutationRejected('Postgres adapter in consumers', (value) => {
    value.runtimeSources.set(ACTION_LIFECYCLE_POSTGRES_ADAPTER_PATH, value.postgresAdapterSource);
  });
});

test('repository loading scans dormant runtime references in tsx sources', () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'mainnet-action-boundary-tsx-'));
  try {
    writeCompleteReviewedFixture(repositoryRoot);
    writeFixture(
      repositoryRoot,
      'apps/api/src/mainnet-actions/unsafe-runtime.tsx',
      "export * from './application/dormant-mainnet-financial-action-finality-evidence.producer';",
    );
    assert.deepEqual(validateDormantMainnetActionBoundaryFiles(repositoryRoot), [
      'dormant mainnet action boundary is referenced by runtime source apps/api/src/mainnet-actions/unsafe-runtime.tsx',
    ]);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('repository loading rejects aggregate runtime inventory races', () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'mainnet-action-boundary-race-'));
  try {
    writeCompleteReviewedFixture(repositoryRoot);
    assert.throws(
      () =>
        loadDormantMainnetActionBoundarySnapshotForTest(repositoryRoot, () => {
          writeFixture(
            repositoryRoot,
            'apps/api/src/runtime-added-after-inventory.ts',
            'export const raced = true;',
          );
        }),
      (error) => error instanceof Error && error.message === ACTION_BOUNDARY_INPUT_ERROR,
    );
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('repository loading rejects missing reviewed artifacts with a value-free error', () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'mainnet-action-boundary-'));
  try {
    writeFixture(repositoryRoot, ACTION_BOUNDARY_PATH, baseline.boundarySource);
    assert.deepEqual(validateDormantMainnetActionBoundaryFiles(repositoryRoot), [
      ACTION_BOUNDARY_INPUT_ERROR,
    ]);
    writeFixture(repositoryRoot, ACTION_BOUNDARY_SPEC_PATH, baseline.specSource);
    assert.deepEqual(validateDormantMainnetActionBoundaryFiles(repositoryRoot), [
      ACTION_BOUNDARY_INPUT_ERROR,
    ]);
    writeFixture(repositoryRoot, ACTION_LIFECYCLE_PATH, baseline.lifecycleSource);
    assert.deepEqual(validateDormantMainnetActionBoundaryFiles(repositoryRoot), [
      ACTION_BOUNDARY_INPUT_ERROR,
    ]);
    writeFixture(repositoryRoot, ACTION_LIFECYCLE_SPEC_PATH, baseline.lifecycleSpecSource);
    assert.deepEqual(validateDormantMainnetActionBoundaryFiles(repositoryRoot), [
      ACTION_BOUNDARY_INPUT_ERROR,
    ]);
    writeFixture(repositoryRoot, ACTION_LIFECYCLE_DURABLE_PORT_PATH, baseline.durablePortSource);
    assert.deepEqual(validateDormantMainnetActionBoundaryFiles(repositoryRoot), [
      ACTION_BOUNDARY_INPUT_ERROR,
    ]);
    writeFixture(
      repositoryRoot,
      ACTION_LIFECYCLE_POSTGRES_ADAPTER_PATH,
      baseline.postgresAdapterSource,
    );
    assert.deepEqual(validateDormantMainnetActionBoundaryFiles(repositoryRoot), [
      ACTION_BOUNDARY_INPUT_ERROR,
    ]);
    writeFixture(
      repositoryRoot,
      ACTION_LIFECYCLE_POSTGRES_ADAPTER_SPEC_PATH,
      baseline.postgresAdapterSpecSource,
    );
    assert.deepEqual(validateDormantMainnetActionBoundaryFiles(repositoryRoot), [
      ACTION_BOUNDARY_INPUT_ERROR,
    ]);
    writeFixture(
      repositoryRoot,
      ACTION_LIFECYCLE_POSTGRES_ADAPTER_INTEGRATION_SPEC_PATH,
      baseline.postgresAdapterIntegrationSpecSource,
    );
    assert.deepEqual(validateDormantMainnetActionBoundaryFiles(repositoryRoot), [
      ACTION_BOUNDARY_INPUT_ERROR,
    ]);
    writeFixture(repositoryRoot, ACTION_LIFECYCLE_MIGRATION_PATH, baseline.migrationSource);
    assert.deepEqual(validateDormantMainnetActionBoundaryFiles(repositoryRoot), [
      ACTION_BOUNDARY_INPUT_ERROR,
    ]);
    writeFixture(
      repositoryRoot,
      ACTION_LIFECYCLE_MIGRATION_SPEC_PATH,
      baseline.migrationSpecSource,
    );
    assert.deepEqual(validateDormantMainnetActionBoundaryFiles(repositoryRoot), [
      ACTION_BOUNDARY_INPUT_ERROR,
    ]);
    writeFixture(
      repositoryRoot,
      ACTION_WALLET_IDENTITY_BINDING_MIGRATION_PATH,
      baseline.walletIdentityBindingMigrationSource,
    );
    assert.deepEqual(validateDormantMainnetActionBoundaryFiles(repositoryRoot), [
      ACTION_BOUNDARY_INPUT_ERROR,
    ]);
    writeFixture(
      repositoryRoot,
      ACTION_WALLET_IDENTITY_BINDING_MIGRATION_SPEC_PATH,
      baseline.walletIdentityBindingMigrationSpecSource,
    );
    assert.deepEqual(validateDormantMainnetActionBoundaryFiles(repositoryRoot), [
      ACTION_BOUNDARY_INPUT_ERROR,
    ]);
    writeFixture(
      repositoryRoot,
      ACTION_WALLET_IDENTITY_BINDING_MIGRATION_INTEGRATION_SPEC_PATH,
      baseline.walletIdentityBindingMigrationIntegrationSpecSource,
    );
    assert.deepEqual(validateDormantMainnetActionBoundaryFiles(repositoryRoot), [
      ACTION_BOUNDARY_INPUT_ERROR,
    ]);
    for (const [path, source] of [
      [ACTION_FINALITY_EVIDENCE_SOURCE_PORT_PATH, baseline.finalityEvidenceSourcePortSource],
      [
        ACTION_FINALITY_EVIDENCE_SOURCE_PORT_SPEC_PATH,
        baseline.finalityEvidenceSourcePortSpecSource,
      ],
      [ACTION_FINALITY_EVIDENCE_PRODUCER_PATH, baseline.finalityEvidenceProducerSource],
      [ACTION_FINALITY_EVIDENCE_PRODUCER_SPEC_PATH, baseline.finalityEvidenceProducerSpecSource],
      [ACTION_FINALITY_SIDECAR_DURABLE_PORT_PATH, baseline.finalitySidecarPortSource],
      [ACTION_FINALITY_SIDECAR_DURABLE_PORT_SPEC_PATH, baseline.finalitySidecarPortSpecSource],
      [ACTION_FINALITY_SIDECAR_POSTGRES_ADAPTER_PATH, baseline.finalitySidecarAdapterSource],
      [
        ACTION_FINALITY_SIDECAR_POSTGRES_ADAPTER_SPEC_PATH,
        baseline.finalitySidecarAdapterSpecSource,
      ],
      [ACTION_AUTHENTICATED_FINALITY_MIGRATION_PATH, baseline.authenticatedFinalityMigrationSource],
      [
        ACTION_AUTHENTICATED_FINALITY_MIGRATION_SPEC_PATH,
        baseline.authenticatedFinalityMigrationSpecSource,
      ],
      [
        ACTION_AUTHENTICATED_FINALITY_MIGRATION_INTEGRATION_SPEC_PATH,
        baseline.authenticatedFinalityMigrationIntegrationSpecSource,
      ],
      [
        ACTION_FINALITY_PREREQUISITE_ISSUER_PORT_PATH,
        baseline.finalityPrerequisiteIssuerPortSource,
      ],
      [
        ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_PATH,
        baseline.finalityPrerequisiteAdapterSource,
      ],
      [
        ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_SPEC_PATH,
        baseline.finalityPrerequisiteAdapterSpecSource,
      ],
      [ACTION_FINALITY_WALLET_READER_PATH, baseline.finalityWalletReaderSource],
      [ACTION_FINALITY_WALLET_READER_SPEC_PATH, baseline.finalityWalletReaderSpecSource],
      [ACTION_FINALITY_PREREQUISITE_MIGRATION_PATH, baseline.finalityPrerequisiteMigrationSource],
      [
        ACTION_FINALITY_PREREQUISITE_MIGRATION_SPEC_PATH,
        baseline.finalityPrerequisiteMigrationSpecSource,
      ],
      [
        ACTION_FINALITY_PREREQUISITE_MIGRATION_INTEGRATION_SPEC_PATH,
        baseline.finalityPrerequisiteMigrationIntegrationSpecSource,
      ],
      [ACTION_ATOMIC_FINALITY_MIGRATION_PATH, baseline.atomicFinalityMigrationSource],
      [ACTION_ATOMIC_FINALITY_MIGRATION_SPEC_PATH, baseline.atomicFinalityMigrationSpecSource],
      [
        ACTION_ATOMIC_FINALITY_MIGRATION_INTEGRATION_SPEC_PATH,
        baseline.atomicFinalityMigrationIntegrationSpecSource,
      ],
    ]) {
      writeFixture(repositoryRoot, path, source);
      assert.deepEqual(validateDormantMainnetActionBoundaryFiles(repositoryRoot), [
        ACTION_BOUNDARY_INPUT_ERROR,
      ]);
    }
    for (const [path, source] of baseline.recoverySchedulerSources) {
      writeFixture(repositoryRoot, path, source);
      assert.deepEqual(validateDormantMainnetActionBoundaryFiles(repositoryRoot), [
        ACTION_BOUNDARY_INPUT_ERROR,
      ]);
    }
    writeFixture(repositoryRoot, DATABASE_MIGRATION_INDEX_PATH, baseline.migrationIndexSource);
    assert.deepEqual(validateDormantMainnetActionBoundaryFiles(repositoryRoot), []);
    writeFixture(
      repositoryRoot,
      'apps/api/src/mainnet-actions/application/dormant-mainnet-financial-action-lifecycle-database.codec.ts',
      'export const rawDecode = () => undefined;',
    );
    assert.deepEqual(validateDormantMainnetActionBoundaryFiles(repositoryRoot), [
      'standalone dormant lifecycle database codec must remain absent',
    ]);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});
