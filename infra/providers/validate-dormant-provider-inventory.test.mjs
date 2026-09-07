import assert from 'node:assert/strict';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  ADDITIONAL_DORMANT_PROVIDER_ARTIFACTS,
  DORMANT_ACCOUNT_POSITION_SEMANTICS,
  DIRECTORY_PATH,
  DORMANT_PROVIDER_INVENTORY_INPUT_ERROR,
  DORMANT_PROVIDER_INVENTORY,
  loadDormantProviderInventorySnapshot,
  loadDormantProviderInventorySnapshotForTest,
  MAX_DORMANT_PROVIDER_ARTIFACT_BYTES,
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

function fixturePath(repositoryRoot, path) {
  return join(repositoryRoot, ...path.split('/'));
}

function writeFixtureFile(repositoryRoot, path, contents) {
  const absolutePath = fixturePath(repositoryRoot, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
  return absolutePath;
}

function withTemporaryRepository(assertion) {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'dormant-provider-inventory-'));
  try {
    writeFixtureFile(repositoryRoot, DIRECTORY_PATH, baseline.directorySource);
    for (const [path, source] of baseline.artifacts) {
      writeFixtureFile(repositoryRoot, path, source);
    }
    assert.deepEqual(validateDormantProviderInventoryFiles(repositoryRoot), []);
    assertion(repositoryRoot);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
}

function assertInputRejected(repositoryRoot, sensitivePath) {
  assert.throws(
    () => loadDormantProviderInventorySnapshot(repositoryRoot),
    (error) =>
      error instanceof Error &&
      error.message === DORMANT_PROVIDER_INVENTORY_INPUT_ERROR &&
      !error.message.includes(repositoryRoot) &&
      !error.message.includes(sensitivePath),
  );
  assert.deepEqual(validateDormantProviderInventoryFiles(repositoryRoot), [
    DORMANT_PROVIDER_INVENTORY_INPUT_ERROR,
  ]);
}

function skipUnsupportedLink(error, context) {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    ['EACCES', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EPERM', 'UNKNOWN'].includes(error.code)
  ) {
    context.skip(`symbolic links are unavailable: ${error.code}`);
    return true;
  }
  return false;
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
  assert.deepEqual(
    ADDITIONAL_DORMANT_PROVIDER_ARTIFACTS.map(({ id }) => id),
    ['kamino-provider-position-source'],
  );
  assert.deepEqual(
    DORMANT_ACCOUNT_POSITION_SEMANTICS.map(({ providerId }) => providerId),
    ['morpho', 'euler', 'gearbox', 'save', 'project-0'],
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

test('the additional Kamino source is byte-pinned, authority-free, and unregistered', () => {
  const [artifact] = ADDITIONAL_DORMANT_PROVIDER_ARTIFACTS;
  assert.ok(artifact);
  assert.equal(
    artifact.path,
    'apps/api/src/mainnet-platforms/infrastructure/dormant-kamino-provider-position-admission.source.ts',
  );

  const mutations = [
    (value) => value.artifacts.delete(artifact.path),
    (value) => {
      value.artifacts.set(
        artifact.path,
        value.artifacts
          .get(artifact.path)
          .replace('mayAuthorizeFinancialAction: false', 'mayAuthorizeFinancialAction: true'),
      );
    },
    (value) => {
      value.artifacts.set(
        artifact.path,
        value.artifacts
          .get(artifact.path)
          .replace(
            'kamino-lend-solana-finalized-transcript.adapter',
            'unreviewed-transcript.adapter',
          ),
      );
    },
    (value) => {
      value.runtimeSources.set(
        'apps/api/src/unsafe-kamino-provider-position.module.ts',
        `providers: [${artifact.className}]`,
      );
    },
    (value) => {
      value.runtimeSources.set(
        'apps/api/src/unsafe-kamino-provider-position.module.ts',
        `import './${artifact.path.slice(artifact.path.lastIndexOf('/') + 1, -3)}';`,
      );
    },
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`additional Kamino artifact mutation ${index}`, mutate),
  );
});

test('the five account-position semantics foundations are authority-free and unregistered', () => {
  for (const semantics of DORMANT_ACCOUNT_POSITION_SEMANTICS) {
    assertMutationRejected(`${semantics.id} missing`, (value) => {
      value.artifacts.delete(semantics.path);
    });
    assertMutationRejected(`${semantics.id} detached spec`, (value) => {
      value.artifacts.set(
        semantics.specPath,
        value.artifacts
          .get(semantics.specPath)
          .replace(`./${semantics.path.slice(semantics.path.lastIndexOf('/') + 1, -3)}`, './other'),
      );
    });
    assertMutationRejected(`${semantics.id} complete-position authority`, (value) => {
      value.artifacts.set(
        semantics.path,
        value.artifacts
          .get(semantics.path)
          .replace('mayEstablishCompletePosition: false', 'mayEstablishCompletePosition: true'),
      );
    });
    assertMutationRejected(`${semantics.id} runtime import`, (value) => {
      value.runtimeSources.set(
        `apps/api/src/unsafe-${semantics.providerId}.module.ts`,
        `import './${semantics.path.slice(semantics.path.lastIndexOf('/') + 1, -3)}';`,
      );
    });
  }
});

test('semantics decorators, adapter dependencies, and unreviewed semantics fail closed', () => {
  const [semantics] = DORMANT_ACCOUNT_POSITION_SEMANTICS;
  assertMutationRejected('semantics decorator', (value) => {
    value.artifacts.set(semantics.path, `@Injectable()\n${value.artifacts.get(semantics.path)}`);
  });
  assertMutationRejected('adapter dependency', (value) => {
    value.artifacts.set(
      semantics.path,
      `import './morpho-blue-ethereum-finalized-transcript.adapter';\n${value.artifacts.get(semantics.path)}`,
    );
  });
  assertMutationRejected('global network call', (value) => {
    value.artifacts.set(semantics.path, `${value.artifacts.get(semantics.path)}\nfetch('x');\n`);
  });
  assertMutationRejected('unreviewed semantics', (value) => {
    value.runtimeSources.set(
      'apps/api/src/smart-lending/infrastructure/unsafe/new-account-position.semantics.ts',
      'export const MAYBE_SAFE = true;',
    );
  });
});

test('malformed snapshots fail closed without escaping', () => {
  for (const value of [null, undefined, true, 1, 'inventory', [], {}, { artifacts: new Map() }]) {
    assert.doesNotThrow(() => validateDormantProviderInventorySnapshot(value));
    assert.ok(validateDormantProviderInventorySnapshot(value).length > 0);
  }
});

test('rejects malformed UTF-8, a byte-order mark, empty input, and oversized input', () => {
  const target = DORMANT_PROVIDER_INVENTORY[1].researchPath;
  const original = Buffer.from(baseline.artifacts.get(target), 'utf8');
  const mutations = [
    Buffer.concat([original, Buffer.from([0xff])]),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), original]),
    Buffer.alloc(0),
    Buffer.alloc(MAX_DORMANT_PROVIDER_ARTIFACT_BYTES + 1, 0x20),
  ];

  for (const contents of mutations) {
    withTemporaryRepository((repositoryRoot) => {
      const absolutePath = writeFixtureFile(repositoryRoot, target, contents);
      assertInputRejected(repositoryRoot, absolutePath);
    });
  }
});

test('rejects directory and hard-linked inventory artifacts', () => {
  const target = DORMANT_PROVIDER_INVENTORY[2].researchPath;
  withTemporaryRepository((repositoryRoot) => {
    const absolutePath = fixturePath(repositoryRoot, target);
    rmSync(absolutePath);
    mkdirSync(absolutePath);
    assertInputRejected(repositoryRoot, absolutePath);
  });

  withTemporaryRepository((repositoryRoot) => {
    const absolutePath = fixturePath(repositoryRoot, target);
    const hardLinkSource = join(repositoryRoot, 'sensitive-unreviewed-hard-link-source.md');
    writeFileSync(hardLinkSource, baseline.artifacts.get(target));
    rmSync(absolutePath);
    linkSync(hardLinkSource, absolutePath);
    assertInputRejected(repositoryRoot, absolutePath);
  });
});

test('rejects a symbolic-link inventory artifact when supported', (context) => {
  const target = DORMANT_PROVIDER_INVENTORY[3].researchPath;
  withTemporaryRepository((repositoryRoot) => {
    const absolutePath = fixturePath(repositoryRoot, target);
    const symbolicLinkTarget = join(repositoryRoot, 'sensitive-unreviewed-symbolic-target.md');
    writeFileSync(symbolicLinkTarget, baseline.artifacts.get(target));
    rmSync(absolutePath);
    try {
      symlinkSync(symbolicLinkTarget, absolutePath, 'file');
    } catch (error) {
      if (skipUnsupportedLink(error, context)) return;
      throw error;
    }
    assertInputRejected(repositoryRoot, absolutePath);
  });
});

test('rejects a same-size rewrite during the stable descriptor read', () => {
  const target = DORMANT_PROVIDER_INVENTORY[4].researchPath;
  const original = Buffer.from(baseline.artifacts.get(target), 'utf8');
  const replacement = Buffer.from(original);
  replacement[replacement.length - 1] ^= 0x01;
  assert.equal(replacement.length, original.length);
  assert.notDeepEqual(replacement, original);

  withTemporaryRepository((repositoryRoot) => {
    const absolutePath = fixturePath(repositoryRoot, target);
    assert.throws(
      () =>
        loadDormantProviderInventorySnapshotForTest(repositoryRoot, (path) => {
          if (path === target) writeFileSync(absolutePath, replacement);
        }),
      (error) => error instanceof Error && error.message === DORMANT_PROVIDER_INVENTORY_INPUT_ERROR,
    );
  });
});

test('loader and validation errors are fixed and do not disclose hostile paths', () => {
  withTemporaryRepository((repositoryRoot) => {
    const target = DORMANT_PROVIDER_INVENTORY[5].researchPath;
    const absolutePath = fixturePath(repositoryRoot, target);
    rmSync(absolutePath);
    assertInputRejected(repositoryRoot, absolutePath);
  });
});

test('the validator contains no network, provider, cloud, credential, or subprocess capability', () => {
  const source = readFileSync(
    `${REPOSITORY_ROOT}/infra/providers/validate-dormant-provider-inventory.mjs`,
    'utf8',
  );
  assert.deepEqual(
    [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)].map((match) => match[1]),
    [
      'node:crypto',
      'node:fs',
      'node:path',
      'node:url',
      'node:util',
      '../shared/read-secure-local-file.mjs',
    ],
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
    'sendRawTransaction',
  ]) {
    assert.equal(source.includes(forbidden), false, `validator must not contain ${forbidden}`);
  }
});
