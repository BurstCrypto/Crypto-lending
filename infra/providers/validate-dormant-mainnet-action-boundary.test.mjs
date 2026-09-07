import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  ACTION_BOUNDARY_INPUT_ERROR,
  ACTION_BOUNDARY_PATH,
  ACTION_BOUNDARY_SPEC_PATH,
  EXPECTED_ACTIONS,
  EXPECTED_PROVIDER_CANDIDATES,
  loadDormantMainnetActionBoundarySnapshot,
  validateDormantMainnetActionBoundaryFiles,
  validateDormantMainnetActionBoundarySnapshot,
} from './validate-dormant-mainnet-action-boundary.mjs';

const baseline = loadDormantMainnetActionBoundarySnapshot();

function snapshot() {
  return {
    boundarySource: baseline.boundarySource,
    specSource: baseline.specSource,
    runtimeSources: new Map(baseline.runtimeSources),
  };
}

function mutationRejected(name, mutate) {
  const changed = snapshot();
  mutate(changed);
  assert.ok(validateDormantMainnetActionBoundarySnapshot(changed).length > 0, `${name} must fail`);
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
    '\nsendRawTransaction(payload);',
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
});

test('malformed snapshots and runtime inventories fail closed without throwing', () => {
  assert.deepEqual(validateDormantMainnetActionBoundarySnapshot(null), [
    'action boundary snapshot is malformed',
  ]);
  mutationRejected('malformed runtime entry', (value) => {
    value.runtimeSources.set(1, null);
  });
  mutationRejected('boundary in consumers', (value) => {
    value.runtimeSources.set(ACTION_BOUNDARY_PATH, value.boundarySource);
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
    assert.deepEqual(validateDormantMainnetActionBoundaryFiles(repositoryRoot), []);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});
