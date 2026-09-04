import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  DORMANT_PROVIDER_INVENTORY,
  loadDormantProviderInventorySnapshot,
  REPOSITORY_ROOT,
  validateDormantProviderInventoryFiles,
  validateDormantProviderInventorySnapshot,
} from './validate-dormant-provider-inventory.mjs';

const baseline = loadDormantProviderInventorySnapshot();

function snapshot() {
  return {
    directorySource: baseline.directorySource,
    artifacts: new Map(baseline.artifacts),
    runtimeSources: new Map(baseline.runtimeSources),
  };
}

function assertMutationRejected(name, mutate) {
  const changed = snapshot();
  mutate(changed);
  assert.ok(validateDormantProviderInventorySnapshot(changed).length > 0, `${name} must fail`);
}

test('the exact ten planning entries have dormant adapter, hostile spec, and research artifacts', () => {
  assert.deepEqual(validateDormantProviderInventoryFiles(), []);
  assert.deepEqual(
    DORMANT_PROVIDER_INVENTORY.map(({ id }) => id),
    [
      'aave',
      'morpho',
      'compound',
      'spark',
      'euler',
      'gearbox',
      'kamino',
      'save',
      'project-0',
      'jupiter',
    ],
  );
});

test('planning additions, removals, reorderings, renames, and chain substitutions fail closed', () => {
  const mutations = [
    (value) => {
      value.directorySource = value.directorySource.replace(
        "plannedPlatform({ id: 'aave'",
        "plannedPlatform({ id: 'attacker'",
      );
    },
    (value) => {
      value.directorySource = value.directorySource.replace(
        "plannedPlatform({ id: 'aave', name: 'Aave', protocol: 'Aave V3' }, 'EVM', [ETHEREUM]),",
        '',
      );
    },
    (value) => {
      const first =
        "plannedPlatform({ id: 'aave', name: 'Aave', protocol: 'Aave V3' }, 'EVM', [ETHEREUM])";
      const second =
        "plannedPlatform({ id: 'morpho', name: 'Morpho', protocol: 'Morpho Blue' }, 'EVM', [ETHEREUM])";
      value.directorySource = value.directorySource
        .replace(first, '__SECOND__')
        .replace(second, first)
        .replace('__SECOND__', second);
    },
    (value) => {
      value.directorySource = value.directorySource.replace(
        "plannedPlatform({ id: 'project-0', name: 'Project 0'",
        "plannedPlatform({ id: 'project-0', name: 'Marginfi'",
      );
    },
    (value) => {
      value.directorySource = value.directorySource.replace(
        "'Jupiter Lend' }, 'SOLANA', [SOLANA]",
        "'Jupiter Lend' }, 'EVM', [ETHEREUM]",
      );
    },
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`planning mutation ${index}`, mutate),
  );
});

test('availability and financial-capability mutations fail closed', () => {
  const mutations = [
    (value) => {
      value.directorySource = value.directorySource.replace(
        "'PLANNED' as const",
        "'LIVE' as const",
      );
    },
    (value) => {
      value.directorySource = value.directorySource.replace(
        "'UNAVAILABLE' as const",
        "'AVAILABLE' as const",
      );
    },
    (value) => {
      value.directorySource = value.directorySource.replace(
        'mayAuthorizeFinancialAction: false as const',
        'mayAuthorizeFinancialAction: true as const',
      );
    },
    (value) => {
      const provider = DORMANT_PROVIDER_INVENTORY[0];
      value.artifacts.set(
        provider.capabilityPath,
        value.artifacts
          .get(provider.capabilityPath)
          .replace('mayAuthorizeFinancialAction: false', 'mayAuthorizeFinancialAction: true'),
      );
    },
    (value) => {
      const provider = DORMANT_PROVIDER_INVENTORY[1];
      value.artifacts.set(
        provider.adapterPath,
        value.artifacts.get(provider.adapterPath).replace('mayPersist: false', 'mayPersist: true'),
      );
    },
    (value) => {
      const provider = DORMANT_PROVIDER_INVENTORY[2];
      value.artifacts.set(
        provider.adapterPath,
        value.artifacts
          .get(provider.adapterPath)
          .replace(
            'mayEstablishRecommendationEligibility: false',
            'mayEstablishRecommendationEligibility: true',
          ),
      );
    },
    (value) => {
      const provider = DORMANT_PROVIDER_INVENTORY[3];
      value.artifacts.set(
        provider.adapterPath,
        value.artifacts
          .get(provider.adapterPath)
          .replace('mayAuthorizeFinancialAction: false', 'mayAuthorizeFinancialAction: true'),
      );
    },
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`capability mutation ${index}`, mutate),
  );
});

test('missing, swapped, shallow, and detached artifacts fail closed', () => {
  const mutations = [
    (value) => value.artifacts.delete(DORMANT_PROVIDER_INVENTORY[0].adapterPath),
    (value) => value.artifacts.delete(DORMANT_PROVIDER_INVENTORY[1].specPath),
    (value) => value.artifacts.delete(DORMANT_PROVIDER_INVENTORY[2].researchPath),
    (value) => value.artifacts.set('docs/provider-research/unreviewed.md', 'dormant'),
    (value) => {
      const left = DORMANT_PROVIDER_INVENTORY[2];
      const right = DORMANT_PROVIDER_INVENTORY[3];
      value.artifacts.set(left.researchPath, value.artifacts.get(right.researchPath));
    },
    (value) => {
      const provider = DORMANT_PROVIDER_INVENTORY[4];
      value.artifacts.set(provider.specPath, "test('placeholder', () => undefined);\n");
    },
    (value) => {
      const provider = DORMANT_PROVIDER_INVENTORY[5];
      value.artifacts.set(
        provider.specPath,
        value.artifacts
          .get(provider.specPath)
          .replace('./gearbox-v3-ethereum-finalized-transcript.adapter', './different-adapter'),
      );
    },
    (value) => {
      const provider = DORMANT_PROVIDER_INVENTORY[6];
      value.artifacts.set(provider.researchPath, 'This is an active production integration.\n');
    },
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`artifact mutation ${index}`, mutate),
  );
});

test('decorators and any runtime reference to a dormant adapter fail closed', () => {
  const decorated = DORMANT_PROVIDER_INVENTORY[7];
  assertMutationRejected('registration decorator', (value) => {
    value.artifacts.set(
      decorated.adapterPath,
      `@Injectable()\n${value.artifacts.get(decorated.adapterPath)}`,
    );
  });

  for (const provider of DORMANT_PROVIDER_INVENTORY) {
    assertMutationRejected(`${provider.id} class registration`, (value) => {
      value.runtimeSources.set(
        `apps/api/src/unsafe-${provider.id}.module.ts`,
        `providers: [${provider.className}]`,
      );
    });
    assertMutationRejected(`${provider.id} path registration`, (value) => {
      const filename = provider.adapterPath.slice(provider.adapterPath.lastIndexOf('/') + 1, -3);
      value.runtimeSources.set(
        `apps/api/src/unsafe-${provider.id}.module.ts`,
        `import * as candidate from './${filename}';`,
      );
    });
  }
});

test('malformed snapshots fail closed without escaping', () => {
  for (const value of [null, undefined, true, 1, 'inventory', [], {}, { artifacts: new Map() }]) {
    assert.doesNotThrow(() => validateDormantProviderInventorySnapshot(value));
    assert.ok(validateDormantProviderInventorySnapshot(value).length > 0);
  }
});

test('the validator contains no network, provider, cloud, credential, or subprocess capability', () => {
  const source = readFileSync(
    `${REPOSITORY_ROOT}/infra/providers/validate-dormant-provider-inventory.mjs`,
    'utf8',
  );
  for (const forbidden of [
    'node:http',
    'node:https',
    'node:net',
    'node:tls',
    'node:dns',
    'node:child_process',
    'fetch(',
    'new WebSocket',
    'sendTransaction',
    'eth_call',
    '@aws-sdk',
    '@solana/web3.js',
    'ethers',
    'viem',
  ]) {
    assert.equal(source.includes(forbidden), false, `validator must not contain ${forbidden}`);
  }
});
