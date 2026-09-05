import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  canonicalProductionEvidenceJson,
  closeProductionEvidenceFileDescriptorForTest,
  isVerifiedProductionEvidenceBundle,
  loadAndVerifyProductionEvidenceBundle,
  loadAndVerifyProductionEvidenceBundleWithTestRegistries,
  MAX_PRODUCTION_EVIDENCE_BUNDLE_BYTES,
  parseAndVerifyProductionEvidenceBundleBytes,
  PRODUCTION_EVIDENCE_AUTHORITY_KEY_REGISTRY,
  ProductionEvidenceBundleInvalidError,
  productionEvidenceBundleSigningBytes,
  revalidateProductionEvidenceBundleForApplicationWithTestRegistries,
  verifyProductionEvidenceBundleBytesWithTestRegistries,
  type ProductionEvidenceAuthorityKey,
  type ProductionEvidenceAuthorityKeyRegistry,
  type ProductionEvidenceBundle,
  type ProductionEvidenceBundleContent,
  type ProductionEvidenceSignature,
  type ProductionEvidenceSignerRole,
  type ProductionLiveReadEvidenceIndex,
  type TestProductionEvidenceBundleVerificationOptions,
  type UnsignedProductionEvidenceBundle,
} from './production-evidence-bundle';
import {
  PRODUCTION_DEPLOYMENT_TARGET_REGISTRY,
  ProductionDeploymentTargetInvalidError,
  isVerifiedProductionDeploymentTarget,
  productionDeploymentTargetSha256,
  resolveProductionDeploymentTarget,
  resolveProductionDeploymentTargetWithTestRegistry,
  type ProductionDeploymentTarget,
  type ProductionDeploymentTargetRegistry,
} from './production-deployment-target';
import {
  applyVerifiedProductionEvidenceBundle,
  productionPreflightCliErrorCode,
  type ProductionPreflightInput,
} from './production-go-live-preflight';

const SOURCE_REVISION = 'a'.repeat(40);
const MANIFEST_SHA256 = '1'.repeat(64);
const DIRECTORY_SHA256 = 'b'.repeat(64);
const EVALUATED_AT = '2026-09-04T12:00:00.000Z';
const PROVIDER_IDS = Object.freeze(Array.from({ length: 10 }, (_, index) => `provider-${index}`));
const ISSUER_KEY = generateKeyPairSync('ed25519');
const VERIFIER_KEY = generateKeyPairSync('ed25519');
const OPTIONAL_KEY = generateKeyPairSync('ed25519');
const OTHER_KEY = generateKeyPairSync('ed25519');

function validReleaseManifest(
  sourceRevision: string = SOURCE_REVISION,
  payloadSha256: string = MANIFEST_SHA256,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: 1,
    artifactType: 'CRYPTO_LENDING_RELEASE_CANDIDATE_MANIFEST',
    source: Object.freeze({ revision: sourceRevision, tree: '9'.repeat(40) }),
    builder: Object.freeze({ architecture: 'x64', nodeVersion: 'v24.0.0', platform: 'win32' }),
    components: Object.freeze([]),
    payloadSha256,
  });
}

function componentIdentity(
  repository: 'crypto-lending-api' | 'crypto-lending-web',
  family: string,
  revision: number,
  imageDigest: string,
): Readonly<{ imageUri: string; taskDefinitionArn: string }> {
  return Object.freeze({
    imageUri: `123456789012.dkr.ecr.us-east-1.amazonaws.com/${repository}@sha256:${imageDigest}`,
    taskDefinitionArn: `arn:aws:ecs:us-east-1:123456789012:task-definition/crypto-${family}:${revision}`,
  });
}

function validDeploymentTarget(
  overrides: Partial<ProductionDeploymentTarget> = {},
): ProductionDeploymentTarget {
  const sharedApiImage = 'c'.repeat(64);
  const api = componentIdentity('crypto-lending-api', 'api', 41, sharedApiImage);
  const workerTask = componentIdentity('crypto-lending-api', 'worker', 43, sharedApiImage);
  const migrationTask = componentIdentity('crypto-lending-api', 'migration', 44, sharedApiImage);
  return {
    targetId: 'production-us-east-1-primary',
    environment: 'production',
    awsAccountId: '123456789012',
    awsRegion: 'us-east-1',
    publicOrigin: 'https://app.example.com',
    cognito: {
      userPoolId: 'us-east-1_AbCdEf123',
      appClientId: 'a'.repeat(26),
      loginHost: 'crypto-lending.auth.us-east-1.amazoncognito.com',
      issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AbCdEf123',
    },
    deployedComponents: {
      api,
      web: componentIdentity('crypto-lending-web', 'web', 42, 'd'.repeat(64)),
      outboxWorker: workerTask,
      migration: migrationTask,
    },
    ...overrides,
  };
}

function targetRegistry(
  targets: readonly ProductionDeploymentTarget[] = [validDeploymentTarget()],
): ProductionDeploymentTargetRegistry {
  return Object.freeze({
    schemaVersion: 1,
    artifactType: 'PRODUCTION_DEPLOYMENT_TARGET_REGISTRY',
    targets: Object.freeze(targets),
  });
}

function authorityKey(
  role: ProductionEvidenceSignerRole,
  keyId: string,
  publicKey: KeyObject,
  overrides: Partial<ProductionEvidenceAuthorityKey> = {},
): ProductionEvidenceAuthorityKey {
  return Object.freeze({
    keyId,
    algorithm: 'Ed25519',
    status: 'APPROVED',
    role,
    scope: 'READ_ONLY',
    publicKeySpkiDerBase64: Buffer.from(publicKey.export({ format: 'der', type: 'spki' })).toString(
      'base64',
    ),
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2027-01-01T00:00:00.000Z',
    approvalReferenceId: `security/${keyId}`,
    ...overrides,
  });
}

function authorityRegistry(
  keys: readonly ProductionEvidenceAuthorityKey[] = [
    authorityKey('DEPLOYMENT_EVIDENCE_ISSUER', 'deployment-evidence-issuer', ISSUER_KEY.publicKey),
    authorityKey(
      'INDEPENDENT_RELEASE_VERIFIER',
      'independent-release-verifier',
      VERIFIER_KEY.publicKey,
    ),
  ],
): ProductionEvidenceAuthorityKeyRegistry {
  return Object.freeze({
    schemaVersion: 1,
    artifactType: 'PRODUCTION_EVIDENCE_AUTHORITY_KEY_REGISTRY',
    keys: Object.freeze(keys),
  });
}

function liveReadEvidenceIndex(
  sourceRevision: string = SOURCE_REVISION,
): ProductionLiveReadEvidenceIndex {
  return Object.freeze({
    schemaVersion: 1,
    artifactType: 'PRODUCTION_LIVE_READ_EVIDENCE_INDEX',
    status: 'ACCEPTED',
    sourceRevision,
    directoryConfigurationSha256: DIRECTORY_SHA256,
    providerIds: PROVIDER_IDS,
    adapterBindings: 'COMPLETE',
    compositionEvidence: 'PASS',
  });
}

function validContent(
  overrides: Partial<ProductionEvidenceBundleContent> = {},
): ProductionEvidenceBundleContent {
  const target = validDeploymentTarget();
  return {
    scope: 'READ_ONLY',
    issuedAt: '2026-09-04T11:30:00.000Z',
    expiresAt: '2026-09-04T13:30:00.000Z',
    sourceRevision: SOURCE_REVISION,
    releaseCandidateManifestSha256: MANIFEST_SHA256,
    deploymentTargetId: target.targetId,
    deploymentTargetSha256: productionDeploymentTargetSha256(target),
    directoryConfigurationSha256: DIRECTORY_SHA256,
    authenticationDeploymentEvidence: {
      artifactType: 'AUTHENTICATION_DEPLOYMENT_EVIDENCE',
      status: 'ACCEPTED',
      observedAt: '2026-09-04T11:20:00.000Z',
    },
    externalEgressLiveEvidence: {
      artifactType: 'EXTERNAL_EGRESS_LIVE_EVIDENCE',
      status: 'ACCEPTED',
      observedAt: '2026-09-04T11:21:00.000Z',
    },
    rpcProviderLiveEvidence: {
      artifactType: 'RPC_PROVIDER_LIVE_EVIDENCE',
      status: 'ACCEPTED',
      observedAt: '2026-09-04T11:22:00.000Z',
    },
    liveReadEvidenceIndex: liveReadEvidenceIndex(),
    mainnetWriteEvidenceIndex: null,
    ...overrides,
  };
}

function unsignedBundle(
  content: ProductionEvidenceBundleContent = validContent(),
): UnsignedProductionEvidenceBundle {
  return Object.freeze({
    schemaVersion: 1,
    artifactType: 'PRODUCTION_CONTROLLED_EVIDENCE_BUNDLE',
    content,
  });
}

interface TestSigner {
  readonly role: ProductionEvidenceSignerRole;
  readonly keyId: string;
  readonly privateKey: KeyObject;
}

const REQUIRED_SIGNERS: readonly TestSigner[] = Object.freeze([
  Object.freeze({
    role: 'DEPLOYMENT_EVIDENCE_ISSUER',
    keyId: 'deployment-evidence-issuer',
    privateKey: ISSUER_KEY.privateKey,
  }),
  Object.freeze({
    role: 'INDEPENDENT_RELEASE_VERIFIER',
    keyId: 'independent-release-verifier',
    privateKey: VERIFIER_KEY.privateKey,
  }),
]);

function signedBundleBytes(
  content: ProductionEvidenceBundleContent = validContent(),
  signers: readonly TestSigner[] = REQUIRED_SIGNERS,
): Buffer {
  const unsigned = unsignedBundle(content);
  const signingBytes = productionEvidenceBundleSigningBytes(unsigned);
  const signatures: ProductionEvidenceSignature[] = signers
    .map(({ role, keyId, privateKey }) => ({
      role,
      scope: 'READ_ONLY' as const,
      authorityKeyId: keyId,
      algorithm: 'Ed25519' as const,
      valueBase64: sign(null, signingBytes, privateKey).toString('base64'),
    }))
    .sort((left, right) => left.role.localeCompare(right.role, 'en-US'));
  const bundle: ProductionEvidenceBundle = { ...unsigned, signatures };
  return Buffer.from(canonicalProductionEvidenceJson(bundle), 'utf8');
}

function testOptions(
  overrides: Partial<TestProductionEvidenceBundleVerificationOptions> = {},
): TestProductionEvidenceBundleVerificationOptions {
  const releaseManifest = validReleaseManifest();
  return {
    evaluatedAt: EVALUATED_AT,
    releaseManifest,
    authorityKeyRegistry: authorityRegistry(),
    deploymentTargetRegistry: targetRegistry(),
    isReleaseManifestVerified: (candidate) => candidate === releaseManifest,
    ...overrides,
  };
}

function expectInvalid(operation: () => unknown): void {
  assert.throws(operation, ProductionEvidenceBundleInvalidError);
}

function jsonRecord(bytes: Uint8Array): Record<string, unknown> {
  return JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalProductionEvidenceJson(value), 'utf8');
}

test('dual-role Ed25519 quorum verifies one manifest, target, and read-only payload', () => {
  const options = testOptions();
  const verified = verifyProductionEvidenceBundleBytesWithTestRegistries(
    signedBundleBytes(),
    options,
  );

  assert.equal(verified.signatureValidated, true);
  assert.deepEqual(verified.verifiedSignerRoles, [
    'DEPLOYMENT_EVIDENCE_ISSUER',
    'INDEPENDENT_RELEASE_VERIFIER',
  ]);
  assert.equal(verified.content.scope, 'READ_ONLY');
  assert.equal(verified.content.mainnetWriteEvidenceIndex, null);
  assert.match(verified.bundleSha256, /^[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(verified), true);
  assert.equal(isVerifiedProductionEvidenceBundle(verified), false);
  assert.equal(PRODUCTION_EVIDENCE_AUTHORITY_KEY_REGISTRY.keys.length, 0);
  assert.equal(PRODUCTION_DEPLOYMENT_TARGET_REGISTRY.targets.length, 0);

  // Test registries never cross the production brand/registry boundary.
  expectInvalid(() =>
    parseAndVerifyProductionEvidenceBundleBytes(signedBundleBytes(), {
      releaseManifest: options.releaseManifest,
    }),
  );
});

test('manifest brand, payload hash, and current source revision are all mandatory', () => {
  const manifest = validReleaseManifest();
  expectInvalid(() =>
    verifyProductionEvidenceBundleBytesWithTestRegistries(signedBundleBytes(), {
      ...testOptions({ releaseManifest: manifest }),
      isReleaseManifestVerified: () => false,
    }),
  );

  const differentManifest = validReleaseManifest(SOURCE_REVISION, '2'.repeat(64));
  expectInvalid(() =>
    verifyProductionEvidenceBundleBytesWithTestRegistries(
      signedBundleBytes(),
      testOptions({
        releaseManifest: differentManifest,
        isReleaseManifestVerified: (candidate) => candidate === differentManifest,
      }),
    ),
  );

  const oldRevision = 'f'.repeat(40);
  expectInvalid(() =>
    verifyProductionEvidenceBundleBytesWithTestRegistries(
      signedBundleBytes(
        validContent({
          sourceRevision: oldRevision,
          liveReadEvidenceIndex: liveReadEvidenceIndex(oldRevision),
        }),
      ),
      testOptions(),
    ),
  );

  const manifestClone = { ...manifest };
  expectInvalid(() =>
    verifyProductionEvidenceBundleBytesWithTestRegistries(
      signedBundleBytes(),
      testOptions({
        releaseManifest: manifestClone,
        isReleaseManifestVerified: (candidate) => candidate === manifest,
      }),
    ),
  );
});

test('deployment target binding prevents cross-environment and cross-target replay', () => {
  const primary = validDeploymentTarget();
  const secondary = validDeploymentTarget({
    targetId: 'production-us-east-1-secondary',
    publicOrigin: 'https://secondary.example.com',
  });
  assert.notEqual(
    productionDeploymentTargetSha256(primary),
    productionDeploymentTargetSha256(secondary),
  );

  expectInvalid(() =>
    verifyProductionEvidenceBundleBytesWithTestRegistries(
      signedBundleBytes(),
      testOptions({ deploymentTargetRegistry: targetRegistry([secondary]) }),
    ),
  );

  const replay = jsonRecord(signedBundleBytes());
  const replayContent = replay.content as Record<string, unknown>;
  replayContent.deploymentTargetId = secondary.targetId;
  replayContent.deploymentTargetSha256 = productionDeploymentTargetSha256(secondary);
  expectInvalid(() =>
    verifyProductionEvidenceBundleBytesWithTestRegistries(
      canonicalBytes(replay),
      testOptions({ deploymentTargetRegistry: targetRegistry([primary, secondary]) }),
    ),
  );
});

test('deployment targets close Cognito, origin, account/region, image, and task identities', () => {
  const target = validDeploymentTarget();
  assert.match(productionDeploymentTargetSha256(target), /^[a-f0-9]{64}$/u);
  assert.equal(
    target.deployedComponents.api.imageUri,
    target.deployedComponents.outboxWorker.imageUri,
  );
  assert.equal(
    target.deployedComponents.api.imageUri,
    target.deployedComponents.migration.imageUri,
  );
  const testResolved = resolveProductionDeploymentTargetWithTestRegistry(
    target.targetId,
    productionDeploymentTargetSha256(target),
    targetRegistry([target]),
  );
  assert.equal(isVerifiedProductionDeploymentTarget(testResolved), false);
  assert.throws(
    () =>
      resolveProductionDeploymentTarget(target.targetId, productionDeploymentTargetSha256(target)),
    ProductionDeploymentTargetInvalidError,
  );

  const hostileTargets: unknown[] = [
    validDeploymentTarget({ publicOrigin: 'http://app.example.com' }),
    validDeploymentTarget({ publicOrigin: 'https://app.example.com/callback' }),
    validDeploymentTarget({
      cognito: { ...target.cognito, loginHost: 'attacker.invalid' },
    }),
    validDeploymentTarget({
      cognito: {
        ...target.cognito,
        issuer: 'https://cognito-idp.us-west-2.amazonaws.com/us-east-1_AbCdEf123',
      },
    }),
    validDeploymentTarget({
      cognito: { ...target.cognito, userPoolId: 'us-west-2_AbCdEf123' },
    }),
    validDeploymentTarget({
      deployedComponents: {
        ...target.deployedComponents,
        api: {
          ...target.deployedComponents.api,
          imageUri: `999999999999.dkr.ecr.us-east-1.amazonaws.com/crypto-lending-api@sha256:${'c'.repeat(64)}`,
        },
      },
    }),
    validDeploymentTarget({
      deployedComponents: {
        ...target.deployedComponents,
        api: {
          ...target.deployedComponents.api,
          imageUri: target.deployedComponents.api.imageUri.replace(
            '/crypto-lending-api@',
            '/crypto-lending-other@',
          ),
        },
      },
    }),
    validDeploymentTarget({
      deployedComponents: {
        ...target.deployedComponents,
        web: {
          ...target.deployedComponents.web,
          imageUri: target.deployedComponents.web.imageUri.replace(
            '/crypto-lending-web@',
            '/crypto-lending-api@',
          ),
        },
      },
    }),
    validDeploymentTarget({
      deployedComponents: {
        ...target.deployedComponents,
        outboxWorker: {
          ...target.deployedComponents.outboxWorker,
          imageUri: target.deployedComponents.outboxWorker.imageUri.replace(
            'c'.repeat(64),
            'e'.repeat(64),
          ),
        },
      },
    }),
    validDeploymentTarget({
      deployedComponents: {
        ...target.deployedComponents,
        outboxWorker: {
          ...target.deployedComponents.outboxWorker,
          imageUri: target.deployedComponents.outboxWorker.imageUri.replace(
            '/crypto-lending-api@',
            '/crypto-lending-worker@',
          ),
        },
      },
    }),
    validDeploymentTarget({
      deployedComponents: {
        ...target.deployedComponents,
        migration: {
          ...target.deployedComponents.migration,
          imageUri: target.deployedComponents.migration.imageUri.replace(
            'c'.repeat(64),
            'f'.repeat(64),
          ),
        },
      },
    }),
    validDeploymentTarget({
      deployedComponents: {
        ...target.deployedComponents,
        migration: {
          ...target.deployedComponents.migration,
          taskDefinitionArn: target.deployedComponents.api.taskDefinitionArn,
        },
      },
    }),
    { ...target, undocumentedAuthority: true },
  ];

  for (const hostile of hostileTargets) {
    assert.throws(
      () => productionDeploymentTargetSha256(hostile),
      ProductionDeploymentTargetInvalidError,
    );
  }
});

test('one signer, one physical key in two roles, or a missing technical role cannot form quorum', () => {
  expectInvalid(() =>
    verifyProductionEvidenceBundleBytesWithTestRegistries(
      signedBundleBytes(validContent(), [REQUIRED_SIGNERS[0] as TestSigner]),
      testOptions(),
    ),
  );

  const sharedKeySigners: readonly TestSigner[] = [
    {
      role: 'DEPLOYMENT_EVIDENCE_ISSUER',
      keyId: 'issuer-shared',
      privateKey: ISSUER_KEY.privateKey,
    },
    {
      role: 'INDEPENDENT_RELEASE_VERIFIER',
      keyId: 'verifier-shared',
      privateKey: ISSUER_KEY.privateKey,
    },
  ];
  expectInvalid(() =>
    verifyProductionEvidenceBundleBytesWithTestRegistries(
      signedBundleBytes(validContent(), sharedKeySigners),
      testOptions({
        authorityKeyRegistry: authorityRegistry([
          authorityKey('DEPLOYMENT_EVIDENCE_ISSUER', 'issuer-shared', ISSUER_KEY.publicKey),
          authorityKey('INDEPENDENT_RELEASE_VERIFIER', 'verifier-shared', ISSUER_KEY.publicKey),
        ]),
      }),
    ),
  );

  const missingVerifier: readonly TestSigner[] = [
    REQUIRED_SIGNERS[0] as TestSigner,
    { role: 'LEGAL_RELEASE_APPROVER', keyId: 'legal', privateKey: OPTIONAL_KEY.privateKey },
  ];
  expectInvalid(() =>
    verifyProductionEvidenceBundleBytesWithTestRegistries(
      signedBundleBytes(validContent(), missingVerifier),
      testOptions({
        authorityKeyRegistry: authorityRegistry([
          authorityKey(
            'DEPLOYMENT_EVIDENCE_ISSUER',
            'deployment-evidence-issuer',
            ISSUER_KEY.publicKey,
          ),
          authorityKey('LEGAL_RELEASE_APPROVER', 'legal', OPTIONAL_KEY.publicKey),
        ]),
      }),
    ),
  );
});

test('additional scoped signatures are verified but do not replace the technical quorum', () => {
  const optionalSigner: TestSigner = {
    role: 'LEGAL_RELEASE_APPROVER',
    keyId: 'legal-release-approver',
    privateKey: OPTIONAL_KEY.privateKey,
  };
  const verified = verifyProductionEvidenceBundleBytesWithTestRegistries(
    signedBundleBytes(validContent(), [...REQUIRED_SIGNERS, optionalSigner]),
    testOptions({
      authorityKeyRegistry: authorityRegistry([
        ...authorityRegistry().keys,
        authorityKey('LEGAL_RELEASE_APPROVER', 'legal-release-approver', OPTIONAL_KEY.publicKey),
      ]),
    }),
  );

  assert.deepEqual(verified.verifiedSignerRoles, [
    'DEPLOYMENT_EVIDENCE_ISSUER',
    'INDEPENDENT_RELEASE_VERIFIER',
    'LEGAL_RELEASE_APPROVER',
  ]);
});

test('schema v1 rejects every write scope, write index, and write-authority assertion', () => {
  const base = jsonRecord(signedBundleBytes());
  const writeScope = structuredClone(base);
  (writeScope.content as Record<string, unknown>).scope = 'MAINNET_WRITE';
  const writeIndex = structuredClone(base);
  (writeIndex.content as Record<string, unknown>).mainnetWriteEvidenceIndex = {
    status: 'ACCEPTED',
    actionBindings: 'COMPLETE',
    simulationEvidence: 'PASS',
    reconciliationEvidence: 'PASS',
  };
  const writeAuthority = structuredClone(base);
  (writeAuthority.content as Record<string, unknown>).mayAuthorizeFinancialAction = true;
  const unverifiedReference = structuredClone(base);
  (
    (unverifiedReference.content as Record<string, unknown>)
      .authenticationDeploymentEvidence as Record<string, unknown>
  ).evidenceReferenceId = 'caller/asserted/file';

  for (const claim of [writeScope, writeIndex, writeAuthority, unverifiedReference]) {
    expectInvalid(() =>
      verifyProductionEvidenceBundleBytesWithTestRegistries(canonicalBytes(claim), testOptions()),
    );
  }
});

test('freshness is checked again when evidence is applied, including exclusive expiry', () => {
  const options = testOptions();
  const verified = verifyProductionEvidenceBundleBytesWithTestRegistries(
    signedBundleBytes(),
    options,
  );

  assert.doesNotThrow(() =>
    revalidateProductionEvidenceBundleForApplicationWithTestRegistries(verified, {
      ...options,
      evaluatedAt: '2026-09-04T13:29:59.999Z',
    }),
  );
  expectInvalid(() =>
    revalidateProductionEvidenceBundleForApplicationWithTestRegistries(verified, {
      ...options,
      evaluatedAt: '2026-09-04T13:30:00.000Z',
    }),
  );
  const replacementManifest = validReleaseManifest(SOURCE_REVISION, '2'.repeat(64));
  expectInvalid(() =>
    revalidateProductionEvidenceBundleForApplicationWithTestRegistries(verified, {
      ...options,
      evaluatedAt: '2026-09-04T12:30:00.000Z',
      releaseManifest: replacementManifest,
      isReleaseManifestVerified: (candidate) => candidate === replacementManifest,
    }),
  );
});

test('strict UTF-8, canonical JSON, exact shapes, signatures, and bounded bytes fail closed', () => {
  const bytes = signedBundleBytes();
  const root = jsonRecord(bytes);
  const unsigned = unsignedBundle();
  const malformedSignature = structuredClone(root);
  ((malformedSignature.signatures as unknown[])[0] as Record<string, unknown>).valueBase64 =
    'not/base64';
  const wrongSignature = structuredClone(root);
  ((wrongSignature.signatures as unknown[])[0] as Record<string, unknown>).valueBase64 = sign(
    null,
    Buffer.from('wrong-payload'),
    OTHER_KEY.privateKey,
  ).toString('base64');
  const text = bytes.toString('utf8');
  const duplicateRootKey = Buffer.from(
    `{"artifactType":"PRODUCTION_CONTROLLED_EVIDENCE_BUNDLE",${text.slice(1)}`,
    'utf8',
  );
  const invalidInputs = [
    Buffer.concat([bytes, Buffer.from('\n')]),
    Buffer.from(JSON.stringify(root, null, 2), 'utf8'),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
    Buffer.from([0xc3, 0x28]),
    duplicateRootKey,
    canonicalBytes(unsigned),
    canonicalBytes({ ...root, repositoryApprovalStatus: 'APPROVED' }),
    canonicalBytes(malformedSignature),
    canonicalBytes(wrongSignature),
    Buffer.alloc(MAX_PRODUCTION_EVIDENCE_BUNDLE_BYTES + 1, 0x61),
  ];

  for (const invalidInput of invalidInputs) {
    expectInvalid(() =>
      verifyProductionEvidenceBundleBytesWithTestRegistries(invalidInput, testOptions()),
    );
  }
});

test('bounded file loading rejects unstable, empty, linked, and oversized inputs', (t) => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'production-evidence-test-'));
  const validPath = join(temporaryDirectory, 'valid.json');
  const emptyPath = join(temporaryDirectory, 'empty.json');
  const unstablePath = join(temporaryDirectory, 'unstable.json');
  const hardlinkPath = join(temporaryDirectory, 'hardlink.json');
  const oversizedPath = join(temporaryDirectory, 'oversized.json');
  const directoryPath = join(temporaryDirectory, 'directory.json');
  const directLinkPath = join(temporaryDirectory, 'direct-link.json');
  const realDirectory = join(temporaryDirectory, 'real-directory');
  const realNestedPath = join(realDirectory, 'nested.json');
  const junctionPath = join(temporaryDirectory, 'linked-directory');
  let directLinkCreated = false;
  let junctionCreated = false;
  let hardlinkCreated = false;

  try {
    writeFileSync(validPath, signedBundleBytes());
    writeFileSync(emptyPath, Buffer.alloc(0));
    const stableBytes = signedBundleBytes();
    const changedBytes = Buffer.from(
      stableBytes
        .toString('utf8')
        .replace('"AUTHENTICATION_DEPLOYMENT_EVIDENCE"', '"AUTHENTICATION_DEPLOYMENT_EVIDENCF"'),
      'utf8',
    );
    assert.equal(changedBytes.length, stableBytes.length);
    writeFileSync(unstablePath, stableBytes);
    writeFileSync(oversizedPath, Buffer.alloc(MAX_PRODUCTION_EVIDENCE_BUNDLE_BYTES + 1, 0x61));
    mkdirSync(directoryPath);
    mkdirSync(realDirectory);
    writeFileSync(realNestedPath, signedBundleBytes());

    assert.equal(
      loadAndVerifyProductionEvidenceBundleWithTestRegistries(validPath, testOptions())
        .signatureValidated,
      true,
    );
    expectInvalid(() =>
      loadAndVerifyProductionEvidenceBundle(validPath, {
        releaseManifest: validReleaseManifest(),
      }),
    );
    expectInvalid(() =>
      loadAndVerifyProductionEvidenceBundleWithTestRegistries(directoryPath, testOptions()),
    );
    expectInvalid(() =>
      loadAndVerifyProductionEvidenceBundleWithTestRegistries(oversizedPath, testOptions()),
    );
    expectInvalid(() =>
      loadAndVerifyProductionEvidenceBundleWithTestRegistries(emptyPath, testOptions()),
    );
    expectInvalid(() =>
      loadAndVerifyProductionEvidenceBundleWithTestRegistries(unstablePath, testOptions(), () =>
        writeFileSync(unstablePath, changedBytes),
      ),
    );

    linkSync(validPath, hardlinkPath);
    hardlinkCreated = true;
    expectInvalid(() =>
      loadAndVerifyProductionEvidenceBundleWithTestRegistries(hardlinkPath, testOptions()),
    );
    expectInvalid(() =>
      loadAndVerifyProductionEvidenceBundleWithTestRegistries(validPath, testOptions()),
    );

    try {
      symlinkSync(realNestedPath, directLinkPath, 'file');
      directLinkCreated = true;
      expectInvalid(() =>
        loadAndVerifyProductionEvidenceBundleWithTestRegistries(directLinkPath, testOptions()),
      );
    } catch (error) {
      if (!permissionDenied(error)) throw error;
      t.diagnostic('file symlink creation is not permitted on this host');
    }

    try {
      symlinkSync(realDirectory, junctionPath, process.platform === 'win32' ? 'junction' : 'dir');
      junctionCreated = true;
      expectInvalid(() =>
        loadAndVerifyProductionEvidenceBundleWithTestRegistries(
          join(junctionPath, 'nested.json'),
          testOptions(),
        ),
      );
    } catch (error) {
      if (!permissionDenied(error)) throw error;
      t.diagnostic('directory link/junction creation is not permitted on this host');
    }

    let captured: unknown;
    try {
      loadAndVerifyProductionEvidenceBundle(join(temporaryDirectory, 'private-path-canary.json'), {
        releaseManifest: validReleaseManifest(),
      });
    } catch (error) {
      captured = error;
    }
    assert.ok(captured instanceof ProductionEvidenceBundleInvalidError);
    assert.equal(captured.message.includes(temporaryDirectory), false);
    assert.equal(
      productionPreflightCliErrorCode(captured),
      'PRODUCTION_PREFLIGHT_EVIDENCE_BUNDLE_INVALID',
    );
  } finally {
    if (junctionCreated) rmdirSync(junctionPath);
    if (directLinkCreated) unlinkSync(directLinkPath);
    if (hardlinkCreated) unlinkSync(hardlinkPath);
    unlinkSync(validPath);
    unlinkSync(emptyPath);
    unlinkSync(unstablePath);
    unlinkSync(oversizedPath);
    unlinkSync(realNestedPath);
    rmdirSync(realDirectory);
    rmdirSync(directoryPath);
    rmdirSync(temporaryDirectory);
  }
});

test('descriptor close failures retain the fixed bundle error contract', () => {
  expectInvalid(() => closeProductionEvidenceFileDescriptorForTest(-1));
});

function permissionDenied(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 'EPERM' || error.code === 'EACCES')
  );
}

test('unbranded bundles cannot alter repository approvals or supply write evidence', () => {
  const input: ProductionPreflightInput = {
    authentication: {
      inspected: true,
      syntaxValid: true,
      apiEnvironmentNames: new Set<string>(),
      apiSecretNames: new Set<string>(),
      webEnvironmentNames: new Set<string>(),
      deployedEvidenceAccepted: false,
    },
    egress: {
      localValidationPassed: true,
      status: 'NOT_APPROVED',
      currentMode: 'NO_EXTERNAL_EGRESS',
      liveEvidenceComplete: false,
    },
    rpcProviders: {
      localValidationPassed: true,
      externalStatus: 'PENDING_EXTERNAL_REGISTRATION',
      runtimeStatus: 'NOT_APPROVED',
      approvalBoundaryApproved: false,
      liveEvidenceAccepted: false,
    },
    platforms: {
      directory: {},
      sourceRevision: null,
      liveReadEvidenceIndex: null,
      mainnetWriteEvidenceIndex: null,
    },
  };
  const options = testOptions();
  const testVerified = verifyProductionEvidenceBundleBytesWithTestRegistries(
    signedBundleBytes(),
    options,
  );

  expectInvalid(() =>
    applyVerifiedProductionEvidenceBundle(input, testVerified, {
      releaseManifest: options.releaseManifest,
      repositoryRoot: '.',
      sourceRevision: SOURCE_REVISION,
    }),
  );
  assert.equal(input.egress.status, 'NOT_APPROVED');
  assert.equal(input.egress.currentMode, 'NO_EXTERNAL_EGRESS');
  assert.equal(input.rpcProviders.externalStatus, 'PENDING_EXTERNAL_REGISTRATION');
  assert.equal(input.rpcProviders.runtimeStatus, 'NOT_APPROVED');
  assert.equal(input.rpcProviders.approvalBoundaryApproved, false);
  assert.equal(input.authentication.deployedEvidenceAccepted, false);
  assert.equal(input.platforms.mainnetWriteEvidenceIndex, null);
});
