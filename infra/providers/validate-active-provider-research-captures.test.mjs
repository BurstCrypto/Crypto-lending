import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  CAPTURE_FILES_INVALID_ERROR,
  CAPTURE_JSON_INVALID_ERROR,
  CAPTURE_PATH,
  MAX_CAPTURE_BYTES,
  MAX_SIDECAR_BYTES,
  REPOSITORY_ROOT,
  SIDECAR_PATH,
  parseProviderResearchCaptureBytes,
  validateProviderResearchCaptureFiles,
  validateProviderResearchCaptureFilesForTest,
  validateProviderResearchCaptureRecord,
  validateProviderResearchCaptureSidecar,
} from './validate-active-provider-research-captures.mjs';

const EXPECTED_FINGERPRINT = 'db13db3ff78d6dd0641f8f61067e48d8eb45d0eab309491e2bff9a60112a97d2';
const CANONICAL_CAPTURE_BYTES = readFileSync(`${REPOSITORY_ROOT}/${CAPTURE_PATH}`);
const CANONICAL_SIDECAR_BYTES = readFileSync(`${REPOSITORY_ROOT}/${SIDECAR_PATH}`);

function loadCapture() {
  return JSON.parse(CANONICAL_CAPTURE_BYTES.toString('utf8'));
}

function assertMutationRejected(name, mutate) {
  const capture = loadCapture();
  mutate(capture);
  const errors = validateProviderResearchCaptureRecord(capture);
  assert.ok(errors.length > 0, `${name} should fail closed`);
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
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'active-provider-capture-'));
  try {
    writeFixtureFile(repositoryRoot, CAPTURE_PATH, CANONICAL_CAPTURE_BYTES);
    writeFixtureFile(repositoryRoot, SIDECAR_PATH, CANONICAL_SIDECAR_BYTES);
    assert.deepEqual(validateProviderResearchCaptureFilesForTest(repositoryRoot), {
      errors: [],
      fingerprint: EXPECTED_FINGERPRINT,
    });
    assertion(repositoryRoot);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
}

function assertFileInputsRejected(repositoryRoot, sensitivePath) {
  const result = validateProviderResearchCaptureFilesForTest(repositoryRoot);
  assert.deepEqual(result, {
    errors: [CAPTURE_FILES_INVALID_ERROR],
    fingerprint: null,
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(repositoryRoot), false);
  assert.equal(serialized.includes(sensitivePath), false);
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

test('the canonical four-provider research packet is valid and remains non-operational', () => {
  const capture = loadCapture();
  assert.deepEqual(validateProviderResearchCaptureRecord(capture), []);
  assert.deepEqual(validateProviderResearchCaptureFiles(), {
    errors: [],
    fingerprint: EXPECTED_FINGERPRINT,
  });
  assert.deepEqual(
    capture.providers.map(({ providerId }) => providerId),
    ['compound', 'euler', 'gearbox', 'jupiter'],
  );
  for (const provider of capture.providers) {
    assert.deepEqual(provider.status, {
      research: 'CATALOGED_OFFLINE_RESEARCH_ONLY',
      integration: 'DORMANT_UNREGISTERED',
      availability: 'UNAVAILABLE',
      approval: 'NOT_APPROVED',
      risk: 'NOT_ASSESSED',
      independentReview: 'NOT_PERFORMED',
      liveEvidence: 'NOT_COLLECTED',
      supportedActions: [],
      mayAuthorizeFinancialAction: false,
    });
  }
});

test('malformed, accessor-bearing, and non-JSON values fail closed without escaping', () => {
  const accessor = {};
  Object.defineProperty(accessor, 'schemaVersion', {
    enumerable: true,
    get() {
      throw new Error('must not execute');
    },
  });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const malformed = [null, undefined, true, 1, 'capture', [], {}, accessor, revoked.proxy];
  for (const value of malformed) {
    assert.doesNotThrow(() => validateProviderResearchCaptureRecord(value));
    assert.ok(validateProviderResearchCaptureRecord(value).length > 0);
  }
});

test('schema membership and all nested objects are closed against drift', () => {
  const mutations = [
    (capture) => (capture.unknown = true),
    (capture) => (capture.capturedAt = '2026-09-04T15:39:48Z'),
    (capture) => (capture.capturedOn = '2026-09-05'),
    (capture) => (capture.scope.unknown = true),
    (capture) => (capture.providers[0].unknown = true),
    (capture) => (capture.providers[0].network.unknown = true),
    (capture) => (capture.providers[0].status.unknown = true),
    (capture) => (capture.providers[0].sources[0].unknown = true),
    (capture) => (capture.providers[0].identifiers[0].unknown = true),
    (capture) => (capture.zeroCostEvidence.unknown = true),
    (capture) => capture.providers.pop(),
    (capture) => capture.providers.reverse(),
  ];
  mutations.forEach((mutate, index) => assertMutationRejected(`closed schema ${index}`, mutate));
});

test('Base, BNB Smart Chain, and testnet substitutions are rejected', () => {
  const mutations = [
    (capture) => {
      capture.providers[0].network = {
        networkId: 'eip155:8453',
        name: 'Base',
        ecosystem: 'EVM',
        environment: 'MAINNET',
      };
    },
    (capture) => {
      capture.providers[1].network = {
        networkId: 'eip155:56',
        name: 'BNB Smart Chain',
        ecosystem: 'EVM',
        environment: 'MAINNET',
      };
    },
    (capture) => (capture.providers[2].network.environment = 'TESTNET'),
    (capture) => (capture.providers[3].network.environment = 'DEVNET'),
    (capture) =>
      (capture.providers[3].network.networkId = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'),
    (capture) => (capture.providers[0].sources[0].path = 'deployments/base/usdc/roots.json'),
  ];
  mutations.forEach((mutate, index) => assertMutationRejected(`wrong chain ${index}`, mutate));
});

test('research cannot be relabeled as approval, availability, live evidence, or an action', () => {
  const mutations = [
    (capture) => (capture.scope.researchOnly = false),
    (capture) => (capture.scope.runtimeRegistration = 'PRESENT'),
    (capture) => (capture.scope.liveEvidenceStatus = 'PASSED'),
    (capture) => (capture.providers[0].status.research = 'PRODUCTION_READY'),
    (capture) => (capture.providers[0].status.integration = 'ACTIVE'),
    (capture) => (capture.providers[0].status.availability = 'AVAILABLE'),
    (capture) => (capture.providers[0].status.approval = 'APPROVED'),
    (capture) => (capture.providers[0].status.risk = 'APPROVED'),
    (capture) => (capture.providers[0].status.liveEvidence = 'COLLECTED'),
    (capture) => capture.providers[0].status.supportedActions.push('SUPPLY'),
    (capture) => (capture.providers[0].status.mayAuthorizeFinancialAction = true),
    (capture) => (capture.zeroCostEvidence.rpcRequestsSent = 1),
    (capture) => (capture.zeroCostEvidence.providerCredentialsUsed = 1),
    (capture) => (capture.zeroCostEvidence.transactionsSubmitted = 1),
  ];
  mutations.forEach((mutate, index) => assertMutationRejected(`unsafe status ${index}`, mutate));
});

test('official source origins, immutable commits, paths, hashes, and facts are exact', () => {
  const mutations = [
    (capture) =>
      (capture.providers[0].officialDocumentationUrls[0] = 'http://docs.compound.finance/'),
    (capture) =>
      (capture.providers[0].officialDocumentationUrls[0] =
        'https://docs.compound.finance.evil.example/'),
    (capture) =>
      (capture.providers[0].sources[0].repositoryUrl = 'https://github.com/example/comet'),
    (capture) => (capture.providers[0].sources[0].url += '?ref=main'),
    (capture) => (capture.providers[0].sources[0].commitSha = '0'.repeat(40)),
    (capture) => (capture.providers[0].sources[0].contentSha256 = '0'.repeat(64)),
    (capture) => (capture.providers[0].sources[0].contentByteLength += 1),
    (capture) => (capture.providers[0].sources[0].observedFacts[0] = 'Everything is approved.'),
    (capture) => capture.providers[3].sources.pop(),
  ];
  mutations.forEach((mutate, index) => assertMutationRejected(`source drift ${index}`, mutate));
});

test('deployment identifiers are closed, chain-typed, unique, and source-bound', () => {
  const mutations = [
    (capture) =>
      (capture.providers[0].identifiers[0].value = '0x0000000000000000000000000000000000000001'),
    (capture) => (capture.providers[0].identifiers[0].kind = 'SOLANA_PROGRAM'),
    (capture) => (capture.providers[0].identifiers[0].sourceId = 'UNKNOWN_SOURCE'),
    (capture) => capture.providers[1].identifiers.pop(),
    (capture) =>
      (capture.providers[3].identifiers[0].value = capture.providers[3].identifiers[1].value),
    (capture) => (capture.providers[3].identifiers[0].value = 'not-base58'),
    (capture) => capture.providers[3].identifiers.reverse(),
  ];
  mutations.forEach((mutate, index) => assertMutationRejected(`identifier drift ${index}`, mutate));
});

test('explicit unresolved production fields cannot be removed or softened', () => {
  const mutations = [
    (capture) => capture.providers[0].unresolvedFields.pop(),
    (capture) => (capture.providers[1].unresolvedFields[0] = 'RESOLVED'),
    (capture) => capture.providers[2].unresolvedFields.reverse(),
    (capture) => capture.programWideUnresolvedFields.pop(),
    (capture) => (capture.programWideUnresolvedFields[0] = 'APPROVED'),
  ];
  mutations.forEach((mutate, index) => assertMutationRejected(`unresolved field ${index}`, mutate));
});

test('the lowercase sidecar binds the exact capture bytes', () => {
  const bytes = readFileSync(`${REPOSITORY_ROOT}/${CAPTURE_PATH}`);
  const sidecar = readFileSync(`${REPOSITORY_ROOT}/${SIDECAR_PATH}`, 'utf8');
  assert.deepEqual(validateProviderResearchCaptureSidecar(bytes, sidecar), []);
  assert.ok(
    validateProviderResearchCaptureSidecar(Buffer.concat([bytes, Buffer.from(' ')]), sidecar)
      .length > 0,
  );
  assert.ok(validateProviderResearchCaptureSidecar(bytes, sidecar.toUpperCase()).length > 0);
  assert.ok(
    validateProviderResearchCaptureSidecar(bytes, `${sidecar.trim()}  capture.json\n`).length > 0,
  );
  assert.doesNotThrow(() => validateProviderResearchCaptureSidecar(null, null));
  assert.ok(validateProviderResearchCaptureSidecar(null, null).length > 0);
});

test('strict capture parsing rejects matching-sidecar duplicate keys and a byte-order mark', () => {
  const canonicalBytes = CANONICAL_CAPTURE_BYTES;
  const canonicalText = canonicalBytes.toString('utf8');
  const ambiguousCaptures = [
    Buffer.from(canonicalText.replace('{\n', '{\n  "schemaVersion": 999,\n'), 'utf8'),
    Buffer.from(
      canonicalText.replace('  "scope": {\n', '  "scope": {\n    "researchOnly": false,\n'),
      'utf8',
    ),
  ];

  for (const bytes of ambiguousCaptures) {
    const digest = createHash('sha256').update(bytes).digest('hex');
    assert.deepEqual(validateProviderResearchCaptureSidecar(bytes, `${digest}\n`), []);
    assert.deepEqual(validateProviderResearchCaptureRecord(JSON.parse(bytes.toString('utf8'))), []);
    assert.notEqual(digest, EXPECTED_FINGERPRINT);
    assert.throws(
      () => parseProviderResearchCaptureBytes(bytes),
      (error) => error instanceof Error && error.message === CAPTURE_JSON_INVALID_ERROR,
    );
  }

  const byteOrderMarked = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), canonicalBytes]);
  const byteOrderMarkedDigest = createHash('sha256').update(byteOrderMarked).digest('hex');
  assert.deepEqual(
    validateProviderResearchCaptureSidecar(byteOrderMarked, `${byteOrderMarkedDigest}\n`),
    [],
  );
  assert.notEqual(byteOrderMarkedDigest, EXPECTED_FINGERPRINT);
  assert.throws(
    () => parseProviderResearchCaptureBytes(byteOrderMarked),
    (error) => error instanceof Error && error.message === CAPTURE_JSON_INVALID_ERROR,
  );
});

test('file loading rejects malformed UTF-8, empty input, and bounded-file overflow', () => {
  const mutations = [
    [CAPTURE_PATH, Buffer.concat([CANONICAL_CAPTURE_BYTES, Buffer.from([0xff])])],
    [CAPTURE_PATH, Buffer.alloc(0)],
    [CAPTURE_PATH, Buffer.alloc(MAX_CAPTURE_BYTES + 1, 0x20)],
    [SIDECAR_PATH, Buffer.alloc(MAX_SIDECAR_BYTES + 1, 0x30)],
  ];

  for (const [path, contents] of mutations) {
    withTemporaryRepository((repositoryRoot) => {
      const absolutePath = writeFixtureFile(repositoryRoot, path, contents);
      assertFileInputsRejected(repositoryRoot, absolutePath);
    });
  }
});

test('file loading rejects hard-linked capture input', () => {
  withTemporaryRepository((repositoryRoot) => {
    const absolutePath = fixturePath(repositoryRoot, CAPTURE_PATH);
    const hardLinkSource = join(repositoryRoot, 'unreviewed-hard-link-capture.json');
    writeFileSync(hardLinkSource, CANONICAL_CAPTURE_BYTES);
    rmSync(absolutePath);
    linkSync(hardLinkSource, absolutePath);
    assertFileInputsRejected(repositoryRoot, hardLinkSource);
  });
});

test('file loading rejects symbolic-link sidecar input when supported', (context) => {
  withTemporaryRepository((repositoryRoot) => {
    const absolutePath = fixturePath(repositoryRoot, SIDECAR_PATH);
    const symbolicLinkTarget = join(repositoryRoot, 'unreviewed-symbolic-sidecar.sha256');
    writeFileSync(symbolicLinkTarget, CANONICAL_SIDECAR_BYTES);
    rmSync(absolutePath);
    try {
      symlinkSync(symbolicLinkTarget, absolutePath, 'file');
    } catch (error) {
      if (skipUnsupportedLink(error, context)) return;
      throw error;
    }
    assertFileInputsRejected(repositoryRoot, symbolicLinkTarget);
  });
});

test('file loading rejects a same-size rewrite between exact descriptor snapshots', () => {
  const replacement = Buffer.from(CANONICAL_SIDECAR_BYTES);
  replacement[0] = replacement[0] === 0x30 ? 0x31 : 0x30;
  assert.equal(replacement.length, CANONICAL_SIDECAR_BYTES.length);
  assert.notDeepEqual(replacement, CANONICAL_SIDECAR_BYTES);

  withTemporaryRepository((repositoryRoot) => {
    const absolutePath = fixturePath(repositoryRoot, SIDECAR_PATH);
    const result = validateProviderResearchCaptureFilesForTest(repositoryRoot, (path) => {
      if (path === SIDECAR_PATH) writeFileSync(absolutePath, replacement);
    });
    assert.deepEqual(result, {
      errors: [CAPTURE_FILES_INVALID_ERROR],
      fingerprint: null,
    });
  });
});

test('file loading returns fixed errors without disclosing hostile paths', () => {
  withTemporaryRepository((repositoryRoot) => {
    const absolutePath = fixturePath(repositoryRoot, CAPTURE_PATH);
    rmSync(absolutePath);
    assert.doesNotThrow(() => validateProviderResearchCaptureFilesForTest(repositoryRoot));
    assertFileInputsRejected(repositoryRoot, absolutePath);
  });
});

test('the validator has no network, provider client, cloud, credential, or subprocess path', () => {
  const source = readFileSync(
    `${REPOSITORY_ROOT}/infra/providers/validate-active-provider-research-captures.mjs`,
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
