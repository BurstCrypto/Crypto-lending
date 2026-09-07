import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  ACTION_BOUNDARY_INPUT_ERROR,
  ACTION_BOUNDARY_PATH,
  ACTION_BOUNDARY_SPEC_PATH,
  ACTION_LIFECYCLE_PATH,
  ACTION_LIFECYCLE_MIGRATION_PATH,
  ACTION_LIFECYCLE_MIGRATION_SPEC_PATH,
  ACTION_LIFECYCLE_DURABLE_PORT_PATH,
  ACTION_LIFECYCLE_POSTGRES_ADAPTER_INTEGRATION_SPEC_PATH,
  ACTION_LIFECYCLE_POSTGRES_ADAPTER_PATH,
  ACTION_LIFECYCLE_POSTGRES_ADAPTER_SPEC_PATH,
  ACTION_LIFECYCLE_SPEC_PATH,
  DATABASE_MIGRATION_INDEX_PATH,
  EXPECTED_ACTIONS,
  EXPECTED_PROVIDER_CANDIDATES,
  loadDormantMainnetActionBoundarySnapshot,
  REVIEWED_ACTION_BOUNDARY_SHA256,
  REVIEWED_ACTION_BOUNDARY_SPEC_SHA256,
  REVIEWED_ACTION_LIFECYCLE_SHA256,
  REVIEWED_ACTION_LIFECYCLE_DURABLE_PORT_SHA256,
  REVIEWED_ACTION_LIFECYCLE_MIGRATION_SHA256,
  REVIEWED_ACTION_LIFECYCLE_MIGRATION_SPEC_SHA256,
  REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_INTEGRATION_SPEC_SHA256,
  REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_SHA256,
  REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_SPEC_SHA256,
  REVIEWED_ACTION_LIFECYCLE_SPEC_SHA256,
  REVIEWED_DATABASE_MIGRATION_INDEX_SHA256,
  validateDormantMainnetActionBoundaryFiles,
  validateDormantMainnetActionBoundarySnapshot,
} from './validate-dormant-mainnet-action-boundary.mjs';

const baseline = loadDormantMainnetActionBoundarySnapshot();

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
    migrationIndexSource: baseline.migrationIndexSource,
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
  assert.equal(REVIEWED_DATABASE_MIGRATION_INDEX_SHA256.length, 64);
  assert.equal(
    REVIEWED_ACTION_LIFECYCLE_MIGRATION_SHA256,
    'c3840f3b3cd7de0e7dbf159c335fbe0784e55e81c936defdf618c9b0092ffa27',
  );
  assert.equal(
    REVIEWED_ACTION_LIFECYCLE_MIGRATION_SPEC_SHA256,
    '7015c5fc30584e868cbdc2df3a376479521d1972f516134d4e95c595a4b7816e',
  );
  assert.equal(
    REVIEWED_DATABASE_MIGRATION_INDEX_SHA256,
    '6ec4f52c67e555070782c3b0a87950ff887e1f513cd92567534ee9dd9393a78b',
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
  for (const [name, from, to] of [
    ['loopback removed', "!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)", 'false'],
    ['PostgreSQL 16 removed', 'serverVersionNum < 160_000', 'serverVersionNum < 1'],
    ['migration cap widened', "({ id }) => id <= '0033'", "({ id }) => id <= '9999'"],
    [
      'direct reconciliation removed',
      'await adapter.recordReconciliation(reconciliationRequest)',
      'await adapter.recordBroadcast(reconciliationRequest)',
    ],
    ['settlement authority enabled', 'ledger_authority_count: 0', 'ledger_authority_count: 1'],
  ]) {
    mutationReports(
      name,
      'dormant Postgres adapter integration lost loopback 0033 flow or denial coverage',
      (value) => {
        value.postgresAdapterIntegrationSpecSource =
          value.postgresAdapterIntegrationSpecSource.replace(from, to);
      },
    );
  }
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
    'database migration index bytes drifted from the reviewed 0033 registration',
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

test('0033 index registration and exact predecessor order fail closed', () => {
  mutationReports(
    'production order drift',
    '0033 migration index registration, predecessor order, or export inventory changed',
    (value) => {
      value.migrationIndexSource = value.migrationIndexSource.replace(
        /createMainnetBalanceAgreementEvidenceV2MigrationV0032,\s+createMainnetFinancialActionLifecycleMigrationV0033,/u,
        'createMainnetFinancialActionLifecycleMigrationV0033,\n  createMainnetBalanceAgreementEvidenceV2MigrationV0032,',
      );
    },
  );
  mutationReports(
    'duplicate registration',
    '0033 migration index registration, predecessor order, or export inventory changed',
    (value) => {
      value.migrationIndexSource = value.migrationIndexSource.replaceAll(
        'createMainnetFinancialActionLifecycleMigrationV0033,',
        'createMainnetFinancialActionLifecycleMigrationV0033,\n  createMainnetFinancialActionLifecycleMigrationV0033,',
      );
    },
  );
  mutationReports(
    'detached import',
    '0033 migration index registration, predecessor order, or export inventory changed',
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

test('only the reviewed migration index may wire or reference 0033 at runtime', () => {
  assert.ok(baseline.runtimeSources.has(DATABASE_MIGRATION_INDEX_PATH));
  mutationReports(
    'runtime migration import',
    '0033 dormant action persistence is referenced by runtime source apps/api/src/application-root.ts',
    (value) => {
      value.runtimeSources.set(
        'apps/api/src/application-root.ts',
        `${value.runtimeSources.get('apps/api/src/application-root.ts')}\nimport { createMainnetFinancialActionLifecycleMigrationV0033 } from './infrastructure/database/migrations/0033-create-mainnet-financial-action-lifecycle.migration';`,
      );
    },
  );
  mutationReports(
    'runtime repository access',
    '0033 dormant action persistence is referenced by runtime source apps/api/src/mainnet-actions/runtime-repository.ts',
    (value) => {
      value.runtimeSources.set(
        'apps/api/src/mainnet-actions/runtime-repository.ts',
        "export const query = 'SELECT * FROM mainnet_financial_action_intents';",
      );
    },
  );
  mutationReports(
    'runtime lifecycle SQL function',
    'migration-0033 lifecycle SQL function is referenced outside the reviewed adapter by runtime source apps/api/src/mainnet-actions/unsafe-durable-store.ts',
    (value) => {
      value.runtimeSources.set(
        'apps/api/src/mainnet-actions/unsafe-durable-store.ts',
        "const sql = 'SELECT * FROM prepare_mainnet_financial_action_lifecycle($1)';",
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
