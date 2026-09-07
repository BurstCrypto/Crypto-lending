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
  DORMANT_ACCOUNT_POSITION_TRANSCRIPTS,
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
    [
      'kamino-provider-position-source',
      'morpho-provider-position-source',
      'euler-provider-position-source',
    ],
  );
  assert.deepEqual(
    DORMANT_ACCOUNT_POSITION_TRANSCRIPTS.map(({ id }) => id),
    ['gearbox-account-position-transcript'],
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

test('the Morpho and Euler provider-position source/spec pairs are exact and authority-free', () => {
  const artifacts = ADDITIONAL_DORMANT_PROVIDER_ARTIFACTS.filter(({ specPath }) => specPath);
  assert.deepEqual(
    artifacts.map(({ providerId }) => providerId),
    ['morpho', 'euler'],
  );

  for (const artifact of artifacts) {
    assert.match(artifact.sha256, /^[0-9a-f]{64}$/u);
    assert.match(artifact.specSha256, /^[0-9a-f]{64}$/u);
    assert.ok(artifact.specPath);

    assertMutationRejected(`${artifact.id} missing source`, (value) => {
      value.artifacts.delete(artifact.path);
    });
    assertMutationRejected(`${artifact.id} missing spec`, (value) => {
      value.artifacts.delete(artifact.specPath);
    });
    assertMutationRejected(`${artifact.id} source byte drift`, (value) => {
      value.artifacts.set(artifact.path, `${value.artifacts.get(artifact.path)}\n// drift`);
    });
    assertMutationRejected(`${artifact.id} spec byte drift`, (value) => {
      value.artifacts.set(artifact.specPath, `${value.artifacts.get(artifact.specPath)}\n// drift`);
    });
    assertMutationRejected(`${artifact.id} detached spec`, (value) => {
      value.artifacts.set(
        artifact.specPath,
        value.artifacts
          .get(artifact.specPath)
          .replace(`./${artifact.path.slice(artifact.path.lastIndexOf('/') + 1, -3)}`, './other'),
      );
    });
    for (const marker of artifact.capabilityMarkers) {
      assertMutationRejected(`${artifact.id} authority flip: ${marker}`, (value) => {
        value.artifacts.set(
          artifact.path,
          value.artifacts.get(artifact.path).replace(marker, marker.replace(': false', ': true')),
        );
      });
    }
    assertMutationRejected(`${artifact.id} transport import`, (value) => {
      value.artifacts.set(
        artifact.path,
        `import { request } from 'node:https';\n${value.artifacts.get(artifact.path)}`,
      );
    });
    assertMutationRejected(`${artifact.id} direct network call`, (value) => {
      value.artifacts.set(
        artifact.path,
        `${value.artifacts.get(artifact.path)}\nfetch('https://rpc.invalid');`,
      );
    });
    assertMutationRejected(`${artifact.id} runtime class reference`, (value) => {
      value.runtimeSources.set(
        `apps/api/src/unsafe-${artifact.providerId}.module.ts`,
        `providers: [${artifact.className}]`,
      );
    });
    assertMutationRejected(`${artifact.id} runtime path reference`, (value) => {
      value.runtimeSources.set(
        `apps/api/src/unsafe-${artifact.providerId}.module.ts`,
        `import './${artifact.path.slice(artifact.path.lastIndexOf('/') + 1, -3)}';`,
      );
    });
    assertMutationRejected(`${artifact.id} included in runtime inventory`, (value) => {
      value.runtimeSources.set(artifact.path, value.artifacts.get(artifact.path));
    });
  }
});

test('the dedicated Gearbox transcript is exact, dormant, incomplete, and not source seven', () => {
  const [transcript] = DORMANT_ACCOUNT_POSITION_TRANSCRIPTS;
  assert.ok(transcript);
  assert.equal(
    transcript.path,
    'apps/api/src/smart-lending/infrastructure/gearbox/gearbox-v3-account-position.transcript.ts',
  );
  assert.equal(
    transcript.specPath,
    'apps/api/src/smart-lending/infrastructure/gearbox/gearbox-v3-account-position.transcript.spec.ts',
  );
  assert.equal(
    transcript.sha256,
    '653e5915302b82566b6acfd44a4ee7db6d860a0c1dde883d678a7d107ddf7ad9',
  );
  assert.equal(
    transcript.specSha256,
    '2ea638ca814e0d586b59077438def6ac2250e00646cadb045618657286bff74f',
  );
  assert.deepEqual(transcript.imports, [
    'node:buffer',
    'node:crypto',
    'node:util/types',
    './gearbox-v3-ethereum-usdc.manifest',
    './gearbox-v3-account-position.semantics',
  ]);
  assert.equal(transcript.minimumTests, 17);
  assert.equal(ADDITIONAL_DORMANT_PROVIDER_ARTIFACTS.length, 3);
  assert.equal(
    ADDITIONAL_DORMANT_PROVIDER_ARTIFACTS.some(({ path }) => path === transcript.path),
    false,
  );

  const source = baseline.artifacts.get(transcript.path);
  const spec = baseline.artifacts.get(transcript.specPath);
  assert.equal(typeof source, 'string');
  assert.equal(typeof spec, 'string');
  assert.match(source, /DORMANT_GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_VALIDATION_ONLY/u);
  assert.match(source, /mayEstablishCompletePosition: false/u);
  assert.ok([...spec.matchAll(/\b(?:it|test)\s*\(/gu)].length >= 17);

  const mutations = [
    (value) => value.artifacts.delete(transcript.path),
    (value) => value.artifacts.delete(transcript.specPath),
    (value) => value.artifacts.set(transcript.path, `${source}\n// byte drift`),
    (value) => value.artifacts.set(transcript.specPath, `${spec}\n// byte drift`),
    (value) => {
      value.artifacts.set(
        transcript.specPath,
        spec.replace('./gearbox-v3-account-position.transcript', './detached-transcript'),
      );
    },
    (value) => {
      value.artifacts.set(
        transcript.path,
        source.replace(
          'DORMANT_GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_VALIDATION_ONLY',
          'ACTIVE_GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT',
        ),
      );
    },
    (value) => {
      value.artifacts.set(
        transcript.path,
        source.replace(
          './gearbox-v3-account-position.semantics',
          './unreviewed-account-position.semantics',
        ),
      );
    },
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`Gearbox transcript identity mutation ${index}`, mutate),
  );

  for (const marker of transcript.capabilityMarkers) {
    assertMutationRejected(`Gearbox transcript authority flip: ${marker}`, (value) => {
      value.artifacts.set(transcript.path, source.replace(marker, marker.replace('false', 'true')));
    });
  }
});

test('the Gearbox transcript rejects network, dynamic, Nest, and runtime wiring', () => {
  const [transcript] = DORMANT_ACCOUNT_POSITION_TRANSCRIPTS;
  assert.ok(transcript);
  const source = baseline.artifacts.get(transcript.path);
  assert.equal(typeof source, 'string');

  const sourceMutations = [
    (value) => {
      value.artifacts.set(transcript.path, `import { request } from 'node:https';\n${source}`);
    },
    (value) => {
      value.artifacts.set(transcript.path, `${source}\nvoid import('./dynamic-transcript');`);
    },
    (value) => {
      value.artifacts.set(transcript.path, `@Injectable()\n${source}`);
    },
  ];
  sourceMutations.forEach((mutate, index) =>
    assertMutationRejected(`Gearbox transcript capability mutation ${index}`, mutate),
  );

  for (const reference of [
    transcript.className,
    transcript.useSymbol,
    './gearbox-v3-account-position.transcript',
  ]) {
    assertMutationRejected(`Gearbox transcript runtime reference: ${reference}`, (value) => {
      value.runtimeSources.set(
        'apps/api/src/unsafe-gearbox-transcript.module.ts',
        `export const unsafeReference = '${reference}';`,
      );
    });
  }
  assertMutationRejected('reviewed Gearbox transcript included in runtime inventory', (value) => {
    value.runtimeSources.set(transcript.path, source);
  });
  assertMutationRejected('runtime imports Gearbox account-position semantics', (value) => {
    value.runtimeSources.set(
      'apps/api/src/unsafe-gearbox-semantics.module.ts',
      "import './smart-lending/infrastructure/gearbox/gearbox-v3-account-position.semantics';",
    );
  });
  assertMutationRejected('another dormant artifact imports Gearbox semantics', (value) => {
    const provider = DORMANT_PROVIDER_INVENTORY[0];
    value.artifacts.set(
      provider.adapterPath,
      `import '../gearbox/gearbox-v3-account-position.semantics';\n${value.artifacts.get(provider.adapterPath)}`,
    );
  });
  assertMutationRejected('unknown Gearbox transcript artifact', (value) => {
    value.runtimeSources.set(
      'apps/api/src/smart-lending/infrastructure/gearbox/unreviewed-account-position.transcript.ts',
      'export const UNREVIEWED = true;',
    );
  });
});

test('repository loading rejects missing, BOM-prefixed, oversized, and unknown Gearbox transcripts', () => {
  const [transcript] = DORMANT_ACCOUNT_POSITION_TRANSCRIPTS;
  assert.ok(transcript);

  for (const target of [transcript.path, transcript.specPath]) {
    withTemporaryRepository((repositoryRoot) => {
      const absolutePath = fixturePath(repositoryRoot, target);
      rmSync(absolutePath);
      assertInputRejected(repositoryRoot, absolutePath);
    });
  }

  const source = Buffer.from(baseline.artifacts.get(transcript.path), 'utf8');
  const invalidInputs = [
    [transcript.path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), source])],
    [transcript.specPath, Buffer.alloc(MAX_DORMANT_PROVIDER_ARTIFACT_BYTES + 1, 0x20)],
  ];
  for (const [target, contents] of invalidInputs) {
    withTemporaryRepository((repositoryRoot) => {
      const absolutePath = writeFixtureFile(repositoryRoot, target, contents);
      assertInputRejected(repositoryRoot, absolutePath);
    });
  }

  const unknownPath =
    'apps/api/src/smart-lending/infrastructure/gearbox/unreviewed-account-position.transcript.ts';
  withTemporaryRepository((repositoryRoot) => {
    writeFixtureFile(repositoryRoot, unknownPath, 'export const UNREVIEWED = true;\n');
    assert.deepEqual(validateDormantProviderInventoryFiles(repositoryRoot), [
      `unreviewed Gearbox account-position transcript artifact: ${unknownPath}`,
    ]);
  });
});

test('unreviewed provider-position source artifacts fail closed', () => {
  const path =
    'apps/api/src/mainnet-platforms/infrastructure/dormant-unreviewed-provider-position.source.ts';
  assertMutationRejected('unreviewed provider-position source snapshot', (value) => {
    value.runtimeSources.set(path, 'export class DormantUnreviewedProviderPositionSource {}');
  });
  assertMutationRejected('unreviewed provider-position source runtime reference', (value) => {
    value.runtimeSources.set(
      'apps/api/src/unsafe-provider-position-consumer.ts',
      "export * from './mainnet-platforms/infrastructure/dormant-unreviewed-provider-position.source';",
    );
  });

  withTemporaryRepository((repositoryRoot) => {
    writeFixtureFile(
      repositoryRoot,
      path,
      'export class DormantUnreviewedProviderPositionSource {}',
    );
    assert.deepEqual(validateDormantProviderInventoryFiles(repositoryRoot), [
      `unreviewed provider-position source artifact: ${path}`,
    ]);
  });
});

test('repository loading requires both pinned provider-position sources and specs', () => {
  const [artifact] = ADDITIONAL_DORMANT_PROVIDER_ARTIFACTS.filter(({ specPath }) => specPath);
  assert.ok(artifact);

  for (const target of [artifact.path, artifact.specPath]) {
    withTemporaryRepository((repositoryRoot) => {
      const absolutePath = fixturePath(repositoryRoot, target);
      rmSync(absolutePath);
      assertInputRejected(repositoryRoot, absolutePath);
    });
  }
});

test('the five account-position semantics foundations are authority-free and unregistered', () => {
  for (const semantics of DORMANT_ACCOUNT_POSITION_SEMANTICS) {
    assert.match(semantics.sha256, /^[0-9a-f]{64}$/u);
    assert.match(semantics.specSha256, /^[0-9a-f]{64}$/u);
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
    assertMutationRejected(`${semantics.id} compiled test import`, (value) => {
      value.runtimeSources.set(
        `apps/api/src/unsafe-${semantics.providerId}.test.ts`,
        `export * from './${semantics.path.slice(semantics.path.lastIndexOf('/') + 1, -3)}';`,
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
  assertMutationRejected('viem RPC construction', (value) => {
    value.artifacts.set(
      semantics.path,
      value.artifacts
        .get(semantics.path)
        .replace(
          "import { isAddress } from 'viem';",
          "import { createPublicClient, http, isAddress } from 'viem';\nvoid createPublicClient({ transport: http('x') });",
        ),
    );
  });
  assertMutationRejected('unreviewed semantics', (value) => {
    value.runtimeSources.set(
      'apps/api/src/smart-lending/infrastructure/unsafe/new-account-position.semantics.ts',
      'export const MAYBE_SAFE = true;',
    );
  });
  assertMutationRejected('split dynamic semantics path', (value) => {
    value.runtimeSources.set(
      'apps/api/src/unsafe-dynamic-runtime.ts',
      "void import('./morpho-blue-account-' + 'position.semantics');",
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
