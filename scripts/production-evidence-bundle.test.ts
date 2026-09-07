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
  type ProductionRdsMasterLifecycleEvidence,
  type TestProductionEvidenceBundleVerificationOptions,
  type UnsignedProductionEvidenceBundle,
} from './production-evidence-bundle';
import {
  PRODUCTION_DEPLOYMENT_DESTINATION_REGISTRY,
  PRODUCTION_DEPLOYMENT_TARGET_REGISTRY,
  ProductionDeploymentDestinationInvalidError,
  ProductionDeploymentTargetInvalidError,
  isVerifiedProductionDeploymentDestination,
  isVerifiedProductionDeploymentTarget,
  productionDeploymentDestinationSha256,
  productionDeploymentTargetSha256,
  resolveProductionDeploymentDestination,
  resolveProductionDeploymentDestinationWithTestRegistry,
  resolveProductionDeploymentTarget,
  resolveProductionDeploymentTargetWithTestRegistry,
  type ProductionDeploymentDestination,
  type ProductionDeploymentDestinationRegistry,
  type ProductionDeploymentTarget,
  type ProductionDeploymentTargetRegistry,
  type ResolvedProductionDeploymentDestination,
  type ResolvedProductionDeploymentTarget,
  type VerifiedProductionDeploymentDestination,
  type VerifiedProductionDeploymentTarget,
} from './production-deployment-target.mjs';
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
const AWS_ACCOUNT_ID = '123456789012';
const AWS_REGION = 'us-east-1';
const APPLICATION_DATA_KEY_ARN = `arn:aws:kms:${AWS_REGION}:${AWS_ACCOUNT_ID}:key/11111111-1111-4111-8111-111111111111`;
const APPLICATION_STACK_ID = `arn:aws:cloudformation:${AWS_REGION}:${AWS_ACCOUNT_ID}:stack/crypto-lending-production/11111111-1111-4111-8111-111111111111`;
const DATABASE_INSTANCE_ARN = `arn:aws:rds:${AWS_REGION}:${AWS_ACCOUNT_ID}:db:crypto-lending-production`;
const RESTORED_DATABASE_INSTANCE_ARN = `arn:aws:rds:${AWS_REGION}:${AWS_ACCOUNT_ID}:db:crypto-lending-production-restore`;
const DATABASE_RESOURCE_ID = `db-${'A'.repeat(26)}`;
const RESTORED_DATABASE_RESOURCE_ID = `db-${'B'.repeat(26)}`;
const DATABASE_MANAGED_SECRET_ARN = `arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:rds!db-${'a'.repeat(36)}-AbCdEf`;
const REBOUND_MANAGED_SECRET_ARN = `arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:rds!db-${'b'.repeat(36)}-GhIjKl`;
const PREVIOUS_SECRET_VERSION_ID = 'p'.repeat(32);
const CURRENT_SECRET_VERSION_ID = 'c'.repeat(32);
const REBOUND_SECRET_VERSION_ID = 'r'.repeat(32);
const RDS_LIFECYCLE_CAPTURE_SHA256 = 'e'.repeat(64);
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
    awsAccountId: AWS_ACCOUNT_ID,
    awsRegion: AWS_REGION,
    publicOrigin: 'https://app.example.com',
    cognito: {
      userPoolId: 'us-east-1_AbCdEf123',
      appClientId: 'a'.repeat(26),
      loginHost: 'crypto-lending.auth.us-east-1.amazoncognito.com',
      issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AbCdEf123',
    },
    rds: {
      cloudFormationStackId: APPLICATION_STACK_ID,
      databaseInstanceArn: DATABASE_INSTANCE_ARN,
      databaseResourceId: DATABASE_RESOURCE_ID,
      databaseManagedSecretArn: DATABASE_MANAGED_SECRET_ARN,
      applicationDataKeyArn: APPLICATION_DATA_KEY_ARN,
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
    schemaVersion: 2,
    artifactType: 'PRODUCTION_DEPLOYMENT_TARGET_REGISTRY',
    targets: Object.freeze(targets),
  });
}

function validDeploymentDestination(
  overrides: Partial<ProductionDeploymentDestination> = {},
): ProductionDeploymentDestination {
  return {
    destinationId: 'production-provisioning-us-east-1',
    epochId: '1'.repeat(64),
    environment: 'production',
    awsAccountId: AWS_ACCOUNT_ID,
    awsRegion: AWS_REGION,
    stackName: 'crypto-lending-production',
    publicOrigin: 'https://app.example.com',
    ...overrides,
  };
}

function destinationRegistry(
  destinations: readonly ProductionDeploymentDestination[] = [validDeploymentDestination()],
): ProductionDeploymentDestinationRegistry {
  return Object.freeze({
    schemaVersion: 1,
    artifactType: 'PRODUCTION_DEPLOYMENT_DESTINATION_REGISTRY',
    destinations: Object.freeze(destinations),
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

function validRdsMasterLifecycleEvidence(): ProductionRdsMasterLifecycleEvidence {
  return {
    schemaVersion: 1,
    artifactType: 'RDS_MASTER_LIFECYCLE_EVIDENCE',
    status: 'ACCEPTED',
    observedAt: '2026-09-04T11:23:00.000Z',
    supportingCapture: {
      schemaVersion: 1,
      artifactType: 'RDS_MASTER_LIFECYCLE_CAPTURE',
      format: 'SANITIZED_CANONICAL_JSON_V1',
      captureSha256: RDS_LIFECYCLE_CAPTURE_SHA256,
      collectionStartedAt: '2026-09-04T10:30:00.000Z',
      collectionCompletedAt: '2026-09-04T11:23:00.000Z',
    },
    binding: {
      applicationDataKeyArn: APPLICATION_DATA_KEY_ARN,
      compatibilityOutputSecretArn: DATABASE_MANAGED_SECRET_ARN,
      databaseInstanceArn: DATABASE_INSTANCE_ARN,
      databaseManagedSecretArn: DATABASE_MANAGED_SECRET_ARN,
      databaseResourceId: DATABASE_RESOURCE_ID,
      managedSecretKmsKeyArn: APPLICATION_DATA_KEY_ARN,
      managedSecretStatus: 'active',
      masterUsername: 'crypto_admin',
    },
    access: {
      applicationTaskCredentialIsolation: 'PASS',
      bootstrapIamAndKmsAccess: 'PASS',
      migrationTaskCredentialIsolation: 'PASS',
      observedAt: '2026-09-04T10:35:00.000Z',
    },
    rotation: {
      automaticRotationEnabled: 'PASS',
      completedAt: '2026-09-04T10:50:00.000Z',
      currentSecretVersionId: CURRENT_SECRET_VERSION_ID,
      currentSecretVersionStage: 'AWSCURRENT',
      managedSecretStatus: 'active',
      masterSessionDrain: 'PASS',
      newMasterAuthentication: 'PASS',
      oldMasterAuthenticationDenied: 'PASS',
      previousSecretVersionId: PREVIOUS_SECRET_VERSION_ID,
      previousSecretVersionStage: 'AWSPREVIOUS',
      rotationCompleted: 'PASS',
      rotationScheduleDays: 7,
      runtimeCredentialContinuity: 'PASS',
      startedAt: '2026-09-04T10:40:00.000Z',
    },
    restore: {
      completedAt: '2026-09-04T11:23:00.000Z',
      databaseInstanceArn: RESTORED_DATABASE_INSTANCE_ARN,
      databaseResourceId: RESTORED_DATABASE_RESOURCE_ID,
      originalMasterAuthenticationDenied: 'PASS',
      reboundManagedSecretArn: REBOUND_MANAGED_SECRET_ARN,
      reboundManagedSecretKmsKeyArn: APPLICATION_DATA_KEY_ARN,
      reboundManagedSecretStatus: 'active',
      reboundManagedSecretVersionId: REBOUND_SECRET_VERSION_ID,
      reboundManagedSecretVersionStage: 'AWSCURRENT',
      rebindingStatus: 'PASS',
      restoredMasterAuthentication: 'PASS',
      runtimeCredentialContinuity: 'PASS',
      startedAt: '2026-09-04T10:55:00.000Z',
    },
  };
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
    rdsMasterLifecycleEvidence: validRdsMasterLifecycleEvidence(),
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
    schemaVersion: 2,
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

function mutableRecord(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function expectInvalidRdsMasterLifecycleMutation(
  mutate: (evidence: Record<string, unknown>) => void,
  options: TestProductionEvidenceBundleVerificationOptions = testOptions(),
  label?: string,
): void {
  const candidate = structuredClone(validContent()) as unknown as Record<string, unknown>;
  mutate(mutableRecord(candidate.rdsMasterLifecycleEvidence));
  assert.throws(
    () =>
      verifyProductionEvidenceBundleBytesWithTestRegistries(
        signedBundleBytes(candidate as unknown as ProductionEvidenceBundleContent),
        options,
      ),
    ProductionEvidenceBundleInvalidError,
    label,
  );
}

test('dual-role Ed25519 quorum verifies one manifest, target, and read-only payload', () => {
  const options = testOptions();
  const verified = verifyProductionEvidenceBundleBytesWithTestRegistries(
    signedBundleBytes(),
    options,
  );

  assert.equal(verified.signatureValidated, true);
  assert.equal(verified.schemaVersion, 2);
  assert.deepEqual(verified.verifiedSignerRoles, [
    'DEPLOYMENT_EVIDENCE_ISSUER',
    'INDEPENDENT_RELEASE_VERIFIER',
  ]);
  assert.equal(verified.content.scope, 'READ_ONLY');
  assert.equal(verified.content.mainnetWriteEvidenceIndex, null);
  assert.equal(
    verified.content.rdsMasterLifecycleEvidence.artifactType,
    'RDS_MASTER_LIFECYCLE_EVIDENCE',
  );
  assert.equal(verified.content.rdsMasterLifecycleEvidence.rotation.rotationScheduleDays, 7);
  assert.equal(Object.isFrozen(verified.content.rdsMasterLifecycleEvidence), true);
  assert.equal(
    Object.isFrozen(verified.content.rdsMasterLifecycleEvidence.supportingCapture),
    true,
  );
  assert.equal(Object.isFrozen(verified.content.rdsMasterLifecycleEvidence.binding), true);
  assert.equal(Object.isFrozen(verified.content.rdsMasterLifecycleEvidence.access), true);
  assert.equal(Object.isFrozen(verified.content.rdsMasterLifecycleEvidence.rotation), true);
  assert.equal(Object.isFrozen(verified.content.rdsMasterLifecycleEvidence.restore), true);
  assert.match(
    productionEvidenceBundleSigningBytes(unsignedBundle()).toString('utf8'),
    /^crypto-lending:production-controlled-evidence-bundle:v2\n/u,
  );
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

test('RDS master lifecycle evidence is mandatory, exact-shaped, canonical, and fresh', () => {
  const missingEvidence = structuredClone(validContent()) as unknown as Record<string, unknown>;
  delete missingEvidence.rdsMasterLifecycleEvidence;
  expectInvalid(() =>
    signedBundleBytes(missingEvidence as unknown as ProductionEvidenceBundleContent),
  );
  for (const invalidEvidence of [null, [], 'caller-asserted-evidence']) {
    const invalidContent = structuredClone(validContent()) as unknown as Record<string, unknown>;
    invalidContent.rdsMasterLifecycleEvidence = invalidEvidence;
    expectInvalid(() =>
      signedBundleBytes(invalidContent as unknown as ProductionEvidenceBundleContent),
    );
  }

  const mutations: readonly (readonly [string, (evidence: Record<string, unknown>) => void])[] = [
    ['null binding', (evidence) => Object.assign(evidence, { binding: null })],
    ['null supporting capture', (evidence) => Object.assign(evidence, { supportingCapture: null })],
    ['wrong schema', (evidence) => Object.assign(evidence, { schemaVersion: 2 })],
    ['wrong artifact type', (evidence) => Object.assign(evidence, { artifactType: 'OTHER' })],
    ['wrong artifact status', (evidence) => Object.assign(evidence, { status: 'PASS' })],
    [
      'noncanonical observedAt',
      (evidence) => Object.assign(evidence, { observedAt: '2026-09-04T11:23:00Z' }),
    ],
    [
      'future observedAt',
      (evidence) => Object.assign(evidence, { observedAt: '2026-09-04T11:30:00.001Z' }),
    ],
    [
      'stale observedAt',
      (evidence) => Object.assign(evidence, { observedAt: '2026-09-04T10:29:59.999Z' }),
    ],
    ['extra root password', (evidence) => Object.assign(evidence, { password: 'do-not-accept' })],
    [
      'missing supporting capture digest',
      (evidence) => delete mutableRecord(evidence.supportingCapture).captureSha256,
    ],
    [
      'extra supporting capture location',
      (evidence) =>
        Object.assign(mutableRecord(evidence.supportingCapture), {
          storageLocation: 'caller/asserted/file',
        }),
    ],
    [
      'missing binding field',
      (evidence) => delete mutableRecord(evidence.binding).databaseResourceId,
    ],
    [
      'extra binding secret field',
      (evidence) =>
        Object.assign(mutableRecord(evidence.binding), { masterPassword: 'do-not-accept' }),
    ],
    [
      'missing access field',
      (evidence) => delete mutableRecord(evidence.access).bootstrapIamAndKmsAccess,
    ],
    [
      'extra access freeform field',
      (evidence) => Object.assign(mutableRecord(evidence.access), { notes: 'caller assertion' }),
    ],
    [
      'missing rotation field',
      (evidence) => delete mutableRecord(evidence.rotation).rotationCompleted,
    ],
    [
      'extra rotation reference field',
      (evidence) =>
        Object.assign(mutableRecord(evidence.rotation), {
          evidenceReferenceId: 'caller/asserted/file',
        }),
    ],
    ['missing restore field', (evidence) => delete mutableRecord(evidence.restore).rebindingStatus],
    [
      'extra restore connection string',
      (evidence) =>
        Object.assign(mutableRecord(evidence.restore), {
          connectionString: 'postgres://do-not-accept',
        }),
    ],
  ];

  for (const [label, mutate] of mutations) {
    expectInvalidRdsMasterLifecycleMutation(mutate, testOptions(), label);
  }
});

test('RDS lifecycle capture provenance is exact, immutable, and chronologically bounded', () => {
  const mutations: readonly (readonly [string, (evidence: Record<string, unknown>) => void])[] = [
    [
      'wrong capture schema',
      (evidence) => {
        mutableRecord(evidence.supportingCapture).schemaVersion = 2;
      },
    ],
    [
      'wrong capture type',
      (evidence) => {
        mutableRecord(evidence.supportingCapture).artifactType = 'OTHER';
      },
    ],
    [
      'wrong capture format',
      (evidence) => {
        mutableRecord(evidence.supportingCapture).format = 'FREEFORM_TEXT';
      },
    ],
    [
      'malformed capture digest',
      (evidence) => {
        mutableRecord(evidence.supportingCapture).captureSha256 = 'E'.repeat(64);
      },
    ],
    [
      'noncanonical collection start',
      (evidence) => {
        mutableRecord(evidence.supportingCapture).collectionStartedAt = '2026-09-04T10:30:00Z';
      },
    ],
    [
      'capture completion differs from observation',
      (evidence) => {
        mutableRecord(evidence.supportingCapture).collectionCompletedAt =
          '2026-09-04T11:22:59.999Z';
      },
    ],
    [
      'capture exceeds one day',
      (evidence) => {
        mutableRecord(evidence.supportingCapture).collectionStartedAt = '2026-09-03T11:22:59.999Z';
      },
    ],
    [
      'access predates capture',
      (evidence) => {
        mutableRecord(evidence.access).observedAt = '2026-09-04T10:29:59.999Z';
      },
    ],
    [
      'access follows rotation start',
      (evidence) => {
        mutableRecord(evidence.access).observedAt = '2026-09-04T10:40:00.001Z';
      },
    ],
    [
      'rotation has no duration',
      (evidence) => {
        mutableRecord(evidence.rotation).startedAt = '2026-09-04T10:50:00.000Z';
      },
    ],
    [
      'rotation overlaps restore',
      (evidence) => {
        mutableRecord(evidence.rotation).completedAt = '2026-09-04T10:55:00.001Z';
      },
    ],
    [
      'restore has no duration',
      (evidence) => {
        mutableRecord(evidence.restore).startedAt = '2026-09-04T11:23:00.000Z';
      },
    ],
    [
      'restore completion differs from capture',
      (evidence) => {
        mutableRecord(evidence.restore).completedAt = '2026-09-04T11:22:59.999Z';
      },
    ],
  ];

  for (const [label, mutate] of mutations) {
    expectInvalidRdsMasterLifecycleMutation(mutate, testOptions(), label);
  }
});

test('RDS master lifecycle evidence requires exact access, rotation, and restore outcomes', () => {
  const passFields: readonly (readonly ['access' | 'rotation' | 'restore', string])[] = [
    ['access', 'applicationTaskCredentialIsolation'],
    ['access', 'bootstrapIamAndKmsAccess'],
    ['access', 'migrationTaskCredentialIsolation'],
    ['rotation', 'automaticRotationEnabled'],
    ['rotation', 'masterSessionDrain'],
    ['rotation', 'newMasterAuthentication'],
    ['rotation', 'oldMasterAuthenticationDenied'],
    ['rotation', 'rotationCompleted'],
    ['rotation', 'runtimeCredentialContinuity'],
    ['restore', 'originalMasterAuthenticationDenied'],
    ['restore', 'rebindingStatus'],
    ['restore', 'restoredMasterAuthentication'],
    ['restore', 'runtimeCredentialContinuity'],
  ];

  for (const [group, field] of passFields) {
    expectInvalidRdsMasterLifecycleMutation(
      (evidence) => {
        mutableRecord(evidence[group])[field] = 'FAIL';
      },
      testOptions(),
      `${group}.${field}`,
    );
  }

  const scalarMutations: readonly (readonly [
    string,
    (evidence: Record<string, unknown>) => void,
  ])[] = [
    [
      'master username',
      (evidence) => {
        mutableRecord(evidence.binding).masterUsername = 'postgres';
      },
    ],
    [
      'initial managed secret is not active',
      (evidence) => {
        mutableRecord(evidence.binding).managedSecretStatus = 'impaired';
      },
    ],
    [
      'numeric rotation schedule',
      (evidence) => {
        mutableRecord(evidence.rotation).rotationScheduleDays = 6;
      },
    ],
    [
      'string rotation schedule',
      (evidence) => {
        mutableRecord(evidence.rotation).rotationScheduleDays = '7';
      },
    ],
    [
      'same previous and current version',
      (evidence) => {
        mutableRecord(evidence.rotation).previousSecretVersionId = CURRENT_SECRET_VERSION_ID;
      },
    ],
    [
      'current version lacks AWSCURRENT',
      (evidence) => {
        mutableRecord(evidence.rotation).currentSecretVersionStage = 'AWSPENDING';
      },
    ],
    [
      'previous version lacks AWSPREVIOUS',
      (evidence) => {
        mutableRecord(evidence.rotation).previousSecretVersionStage = 'AWSCURRENT';
      },
    ],
    [
      'rotated managed secret is not active',
      (evidence) => {
        mutableRecord(evidence.rotation).managedSecretStatus = 'rotating';
      },
    ],
    [
      'short current version',
      (evidence) => {
        mutableRecord(evidence.rotation).currentSecretVersionId = 'short';
      },
    ],
    [
      'invalid rebound version',
      (evidence) => {
        mutableRecord(evidence.restore).reboundManagedSecretVersionId = 'invalid';
      },
    ],
    [
      'rebound managed secret is not active',
      (evidence) => {
        mutableRecord(evidence.restore).reboundManagedSecretStatus = 'impaired';
      },
    ],
    [
      'rebound version lacks AWSCURRENT',
      (evidence) => {
        mutableRecord(evidence.restore).reboundManagedSecretVersionStage = 'AWSPREVIOUS';
      },
    ],
    [
      'invalid primary database resource ID',
      (evidence) => {
        mutableRecord(evidence.binding).databaseResourceId = '';
      },
    ],
    [
      'invalid restored database resource ID',
      (evidence) => {
        mutableRecord(evidence.restore).databaseResourceId = 'x'.repeat(257);
      },
    ],
  ];

  for (const [label, mutate] of scalarMutations) {
    expectInvalidRdsMasterLifecycleMutation(mutate, testOptions(), label);
  }
});

test('RDS and Secrets Manager opaque identifiers are bounded without invented alphabets', () => {
  const target = validDeploymentTarget({
    rds: {
      ...validDeploymentTarget().rds,
      databaseResourceId: 'opaque/resource.id:v2_01',
    },
  });
  const content = structuredClone(validContent()) as unknown as Record<string, unknown>;
  content.deploymentTargetSha256 = productionDeploymentTargetSha256(target);
  const lifecycle = mutableRecord(content.rdsMasterLifecycleEvidence);
  mutableRecord(lifecycle.binding).databaseResourceId = target.rds.databaseResourceId;
  mutableRecord(lifecycle.rotation).previousSecretVersionId = '.'.repeat(32);

  assert.doesNotThrow(() =>
    verifyProductionEvidenceBundleBytesWithTestRegistries(
      signedBundleBytes(content as unknown as ProductionEvidenceBundleContent),
      testOptions({ deploymentTargetRegistry: targetRegistry([target]) }),
    ),
  );
});

test('RDS master lifecycle identities and restore rebinding fail closed', () => {
  const otherSecretArn = DATABASE_MANAGED_SECRET_ARN.replace('a'.repeat(36), 'd'.repeat(36));
  const otherKeyArn = APPLICATION_DATA_KEY_ARN.replace(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  );
  const mutations: readonly (readonly [string, (evidence: Record<string, unknown>) => void])[] = [
    [
      'compatibility output does not identify the managed secret',
      (evidence) => {
        mutableRecord(evidence.binding).compatibilityOutputSecretArn = otherSecretArn;
      },
    ],
    [
      'managed secret uses another KMS key',
      (evidence) => {
        mutableRecord(evidence.binding).managedSecretKmsKeyArn = otherKeyArn;
      },
    ],
    [
      'rebound secret uses another KMS key',
      (evidence) => {
        mutableRecord(evidence.restore).reboundManagedSecretKmsKeyArn = otherKeyArn;
      },
    ],
    [
      'restored database reuses original ARN',
      (evidence) => {
        mutableRecord(evidence.restore).databaseInstanceArn = DATABASE_INSTANCE_ARN;
      },
    ],
    [
      'restored database reuses original resource ID',
      (evidence) => {
        mutableRecord(evidence.restore).databaseResourceId = DATABASE_RESOURCE_ID;
      },
    ],
    [
      'restored database reuses original managed secret',
      (evidence) => {
        mutableRecord(evidence.restore).reboundManagedSecretArn = DATABASE_MANAGED_SECRET_ARN;
      },
    ],
    [
      'custom current secret namespace',
      (evidence) => {
        const customSecretArn = DATABASE_MANAGED_SECRET_ARN.replace(
          'secret:rds!db-',
          'secret:application-',
        );
        mutableRecord(evidence.binding).compatibilityOutputSecretArn = customSecretArn;
        mutableRecord(evidence.binding).databaseManagedSecretArn = customSecretArn;
      },
    ],
    [
      'custom rebound secret namespace',
      (evidence) => {
        mutableRecord(evidence.restore).reboundManagedSecretArn =
          REBOUND_MANAGED_SECRET_ARN.replace('secret:rds!db-', 'secret:application-');
      },
    ],
    [
      'malformed database ARN',
      (evidence) => {
        mutableRecord(evidence.binding).databaseInstanceArn = DATABASE_INSTANCE_ARN.replace(
          ':db:crypto-',
          ':cluster:crypto-',
        );
      },
    ],
    [
      'non-AWS partition',
      (evidence) => {
        mutableRecord(evidence.restore).databaseInstanceArn =
          RESTORED_DATABASE_INSTANCE_ARN.replace('arn:aws:', 'arn:aws-cn:');
      },
    ],
  ];

  for (const [label, mutate] of mutations) {
    expectInvalidRdsMasterLifecycleMutation(mutate, testOptions(), label);
  }
});

test('RDS master lifecycle identities must match the resolved AWS account and Region', () => {
  expectInvalidRdsMasterLifecycleMutation(
    (evidence) => {
      const crossAccountKeyArn = APPLICATION_DATA_KEY_ARN.replace(AWS_ACCOUNT_ID, '210987654321');
      mutableRecord(evidence.binding).applicationDataKeyArn = crossAccountKeyArn;
      mutableRecord(evidence.binding).managedSecretKmsKeyArn = crossAccountKeyArn;
      mutableRecord(evidence.restore).reboundManagedSecretKmsKeyArn = crossAccountKeyArn;
    },
    testOptions(),
    'cross-account KMS identities',
  );
  expectInvalidRdsMasterLifecycleMutation(
    (evidence) => {
      const crossAccountSecretArn = DATABASE_MANAGED_SECRET_ARN.replace(
        AWS_ACCOUNT_ID,
        '210987654321',
      );
      mutableRecord(evidence.binding).compatibilityOutputSecretArn = crossAccountSecretArn;
      mutableRecord(evidence.binding).databaseManagedSecretArn = crossAccountSecretArn;
    },
    testOptions(),
    'cross-account current managed secret identity',
  );
  expectInvalidRdsMasterLifecycleMutation(
    (evidence) => {
      mutableRecord(evidence.binding).databaseInstanceArn = DATABASE_INSTANCE_ARN.replace(
        AWS_REGION,
        'us-west-2',
      );
    },
    testOptions(),
    'cross-Region primary database identity',
  );
  expectInvalidRdsMasterLifecycleMutation(
    (evidence) => {
      mutableRecord(evidence.restore).reboundManagedSecretArn = REBOUND_MANAGED_SECRET_ARN.replace(
        AWS_REGION,
        'us-west-2',
      );
    },
    testOptions(),
    'cross-Region rebound secret identity',
  );
  expectInvalidRdsMasterLifecycleMutation(
    (evidence) => {
      mutableRecord(evidence.restore).databaseInstanceArn = RESTORED_DATABASE_INSTANCE_ARN.replace(
        AWS_REGION,
        'us-west-2',
      );
    },
    testOptions(),
    'cross-Region restored database identity',
  );
});

test('RDS lifecycle evidence must match the exact database and KMS identities in the target', () => {
  expectInvalidRdsMasterLifecycleMutation(
    (evidence) => {
      const alternateSecretArn = DATABASE_MANAGED_SECRET_ARN.replace(
        'a'.repeat(36),
        'd'.repeat(36),
      );
      mutableRecord(evidence.binding).databaseInstanceArn =
        `${DATABASE_INSTANCE_ARN}-same-account-shadow`;
      mutableRecord(evidence.binding).databaseResourceId = 'same-account-shadow-resource';
      mutableRecord(evidence.binding).compatibilityOutputSecretArn = alternateSecretArn;
      mutableRecord(evidence.binding).databaseManagedSecretArn = alternateSecretArn;
    },
    testOptions(),
    'same-account database substitution',
  );
  expectInvalidRdsMasterLifecycleMutation(
    (evidence) => {
      const alternateKeyArn = APPLICATION_DATA_KEY_ARN.replace(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      );
      mutableRecord(evidence.binding).applicationDataKeyArn = alternateKeyArn;
      mutableRecord(evidence.binding).managedSecretKmsKeyArn = alternateKeyArn;
      mutableRecord(evidence.restore).reboundManagedSecretKmsKeyArn = alternateKeyArn;
    },
    testOptions(),
    'same-account KMS substitution',
  );
});

test('RDS lifecycle evidence is covered by the bundle signatures', () => {
  const tampered = jsonRecord(signedBundleBytes());
  const lifecycle = mutableRecord(mutableRecord(tampered.content).rdsMasterLifecycleEvidence);
  mutableRecord(lifecycle.supportingCapture).captureSha256 = 'f'.repeat(64);

  expectInvalid(() =>
    verifyProductionEvidenceBundleBytesWithTestRegistries(canonicalBytes(tampered), testOptions()),
  );
});

test('deployment targets close Cognito, RDS/KMS, origin, account/region, image, and task identities', () => {
  const target = validDeploymentTarget();
  assert.equal(
    productionDeploymentTargetSha256(target),
    'c3d6ec5c2d965f4a9845e76d24b45e7f730921e860fef518926c2631478fcde4',
  );
  assert.equal(PRODUCTION_DEPLOYMENT_TARGET_REGISTRY.schemaVersion, 2);
  assert.equal(PRODUCTION_DEPLOYMENT_TARGET_REGISTRY.targets.length, 0);
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
  const resolvedTarget: ResolvedProductionDeploymentTarget = testResolved;
  // @ts-expect-error Test-registry resolution cannot confer the nominal production brand.
  const productionBrandedTarget: VerifiedProductionDeploymentTarget = testResolved;
  void productionBrandedTarget;
  assert.equal(isVerifiedProductionDeploymentTarget(testResolved), false);
  assert.equal(Object.isFrozen(resolvedTarget.rds), true);
  assert.equal(resolvedTarget.rds.cloudFormationStackId, APPLICATION_STACK_ID);
  assert.equal(resolvedTarget.rds.databaseInstanceArn, DATABASE_INSTANCE_ARN);
  assert.equal(resolvedTarget.rds.databaseResourceId, DATABASE_RESOURCE_ID);
  assert.equal(resolvedTarget.rds.databaseManagedSecretArn, DATABASE_MANAGED_SECRET_ARN);
  assert.equal(resolvedTarget.rds.applicationDataKeyArn, APPLICATION_DATA_KEY_ARN);
  assert.throws(
    () =>
      resolveProductionDeploymentTarget(target.targetId, productionDeploymentTargetSha256(target)),
    ProductionDeploymentTargetInvalidError,
  );

  const opaqueResourceTarget = validDeploymentTarget({
    rds: { ...target.rds, databaseResourceId: 'opaque/resource.id:v2_01' },
  });
  assert.match(productionDeploymentTargetSha256(opaqueResourceTarget), /^[a-f0-9]{64}$/u);
  assert.notEqual(
    productionDeploymentTargetSha256(opaqueResourceTarget),
    productionDeploymentTargetSha256(target),
  );
  const alternateRdsIdentities: readonly ProductionDeploymentTarget['rds'][] = [
    {
      ...target.rds,
      cloudFormationStackId: APPLICATION_STACK_ID.replace(
        'crypto-lending-production/',
        'crypto-lending-production-blue/',
      ),
    },
    { ...target.rds, databaseInstanceArn: `${DATABASE_INSTANCE_ARN}-blue` },
    { ...target.rds, databaseResourceId: 'opaque-resource-blue' },
    {
      ...target.rds,
      databaseManagedSecretArn: DATABASE_MANAGED_SECRET_ARN.replace('a'.repeat(36), 'd'.repeat(36)),
    },
    {
      ...target.rds,
      applicationDataKeyArn: APPLICATION_DATA_KEY_ARN.replace(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ),
    },
  ];
  for (const rds of alternateRdsIdentities) {
    assert.notEqual(
      productionDeploymentTargetSha256(validDeploymentTarget({ rds })),
      productionDeploymentTargetSha256(target),
    );
  }

  const accessorRds = { ...target.rds };
  Object.defineProperty(accessorRds, 'databaseResourceId', {
    enumerable: true,
    get: () => DATABASE_RESOURCE_ID,
  });
  const { applicationDataKeyArn: omittedApplicationDataKeyArn, ...missingRdsField } = target.rds;
  assert.equal(omittedApplicationDataKeyArn, APPLICATION_DATA_KEY_ARN);
  const { rds: omittedRds, ...legacyTarget } = target;
  assert.equal(omittedRds, target.rds);

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
      rds: {
        ...target.rds,
        cloudFormationStackId: APPLICATION_STACK_ID.replace(AWS_ACCOUNT_ID, '210987654321'),
      },
    }),
    validDeploymentTarget({
      rds: {
        ...target.rds,
        cloudFormationStackId: APPLICATION_STACK_ID.replace(AWS_REGION, 'us-west-2'),
      },
    }),
    validDeploymentTarget({
      rds: {
        ...target.rds,
        cloudFormationStackId: APPLICATION_STACK_ID.replace('arn:aws:', 'arn:aws-cn:'),
      },
    }),
    validDeploymentTarget({
      rds: {
        ...target.rds,
        databaseInstanceArn: DATABASE_INSTANCE_ARN.replace(AWS_ACCOUNT_ID, '210987654321'),
      },
    }),
    validDeploymentTarget({
      rds: {
        ...target.rds,
        databaseInstanceArn: DATABASE_INSTANCE_ARN.replace(AWS_REGION, 'us-west-2'),
      },
    }),
    validDeploymentTarget({
      rds: {
        ...target.rds,
        databaseInstanceArn: DATABASE_INSTANCE_ARN.replace('crypto-lending', 'crypto--lending'),
      },
    }),
    validDeploymentTarget({ rds: { ...target.rds, databaseResourceId: '' } }),
    validDeploymentTarget({ rds: { ...target.rds, databaseResourceId: 'x'.repeat(257) } }),
    validDeploymentTarget({ rds: { ...target.rds, databaseResourceId: ' resource-id' } }),
    validDeploymentTarget({ rds: { ...target.rds, databaseResourceId: 'resource\nidentifier' } }),
    validDeploymentTarget({
      rds: {
        ...target.rds,
        databaseManagedSecretArn: DATABASE_MANAGED_SECRET_ARN.replace(
          'secret:rds!db-',
          'secret:application-',
        ),
      },
    }),
    validDeploymentTarget({
      rds: {
        ...target.rds,
        databaseManagedSecretArn: DATABASE_MANAGED_SECRET_ARN.replace(
          AWS_ACCOUNT_ID,
          '210987654321',
        ),
      },
    }),
    validDeploymentTarget({
      rds: {
        ...target.rds,
        databaseManagedSecretArn: DATABASE_MANAGED_SECRET_ARN.replace(AWS_REGION, 'us-west-2'),
      },
    }),
    validDeploymentTarget({
      rds: {
        ...target.rds,
        applicationDataKeyArn: APPLICATION_DATA_KEY_ARN.replace(AWS_ACCOUNT_ID, '210987654321'),
      },
    }),
    validDeploymentTarget({
      rds: {
        ...target.rds,
        applicationDataKeyArn: APPLICATION_DATA_KEY_ARN.replace(AWS_REGION, 'us-west-2'),
      },
    }),
    validDeploymentTarget({
      rds: {
        ...target.rds,
        applicationDataKeyArn: APPLICATION_DATA_KEY_ARN.replace(':key/', ':alias/'),
      },
    }),
    validDeploymentTarget({ rds: missingRdsField as ProductionDeploymentTarget['rds'] }),
    validDeploymentTarget({
      rds: {
        ...target.rds,
        undocumentedIdentity: true,
      } as unknown as ProductionDeploymentTarget['rds'],
    }),
    validDeploymentTarget({ rds: accessorRds }),
    validDeploymentTarget({
      rds: Object.assign(
        Object.create({ inherited: true }) as object,
        target.rds,
      ) as ProductionDeploymentTarget['rds'],
    }),
    legacyTarget,
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

  assert.throws(
    () =>
      resolveProductionDeploymentTargetWithTestRegistry(
        target.targetId,
        productionDeploymentTargetSha256(target),
        {
          ...targetRegistry([target]),
          schemaVersion: 1,
        } as unknown as ProductionDeploymentTargetRegistry,
      ),
    ProductionDeploymentTargetInvalidError,
  );
});

test('deployment destinations bind prospective coordinates and epochs without minting production trust', () => {
  const destination = validDeploymentDestination();
  assert.notEqual(destination.destinationId, validDeploymentTarget().targetId);
  const destinationSha256 = productionDeploymentDestinationSha256(destination);
  assert.equal(
    destinationSha256,
    'ae02b29526b0f61d7b0da26009e23f3914b8bd410516af4da9dfd1f972cc6700',
  );
  assert.equal(PRODUCTION_DEPLOYMENT_DESTINATION_REGISTRY.schemaVersion, 1);
  assert.equal(PRODUCTION_DEPLOYMENT_DESTINATION_REGISTRY.destinations.length, 0);
  assert.equal(Object.isFrozen(PRODUCTION_DEPLOYMENT_DESTINATION_REGISTRY), true);
  assert.equal(Object.isFrozen(PRODUCTION_DEPLOYMENT_DESTINATION_REGISTRY.destinations), true);

  const testResolved = resolveProductionDeploymentDestinationWithTestRegistry(
    destination.destinationId,
    destinationSha256,
    destinationRegistry([destination]),
  );
  const resolvedDestination: ResolvedProductionDeploymentDestination = testResolved;
  // @ts-expect-error Test-registry resolution cannot confer the nominal production brand.
  const productionBrandedDestination: VerifiedProductionDeploymentDestination = testResolved;
  void productionBrandedDestination;
  assert.equal(isVerifiedProductionDeploymentDestination(testResolved), false);
  assert.equal(isVerifiedProductionDeploymentDestination({ ...testResolved }), false);
  assert.equal(Object.isFrozen(testResolved), true);
  assert.equal(testResolved.epochId, destination.epochId);
  assert.equal(
    resolvedDestination.registrySha256,
    '3cda62e6a7c6e38ea24d399a8bc99753889c643ffb7a15be9929cdee4721dd48',
  );
  assert.throws(
    () => resolveProductionDeploymentDestination(destination.destinationId, destinationSha256),
    ProductionDeploymentDestinationInvalidError,
  );

  const replacementEpoch = validDeploymentDestination({ epochId: '2'.repeat(64) });
  assert.notEqual(productionDeploymentDestinationSha256(replacementEpoch), destinationSha256);

  const { epochId: omittedEpochId, ...missingEpoch } = destination;
  assert.equal(omittedEpochId, destination.epochId);
  const hostileDestinations: unknown[] = [
    validDeploymentDestination({ destinationId: 'Production' }),
    validDeploymentDestination({ epochId: '0'.repeat(64) }),
    validDeploymentDestination({ epochId: 'A'.repeat(64) }),
    validDeploymentDestination({ epochId: '1'.repeat(63) }),
    validDeploymentDestination({ environment: 'staging' as 'production' }),
    validDeploymentDestination({ awsAccountId: '000000000000' }),
    validDeploymentDestination({ awsAccountId: '123' }),
    validDeploymentDestination({ awsRegion: 'us-gov-west-1' }),
    validDeploymentDestination({ stackName: '_invalid' }),
    validDeploymentDestination({ publicOrigin: 'http://app.example.com' }),
    validDeploymentDestination({ publicOrigin: 'https://app.example.com/path' }),
    validDeploymentDestination({ publicOrigin: 'https://127.0.0.1' }),
    missingEpoch,
    { ...destination, undocumentedAuthority: true },
  ];
  for (const hostile of hostileDestinations) {
    assert.throws(
      () => productionDeploymentDestinationSha256(hostile),
      ProductionDeploymentDestinationInvalidError,
    );
  }

  assert.throws(
    () =>
      resolveProductionDeploymentDestinationWithTestRegistry(
        destination.destinationId,
        'f'.repeat(64),
        destinationRegistry([destination]),
      ),
    ProductionDeploymentDestinationInvalidError,
  );
  assert.throws(
    () =>
      resolveProductionDeploymentDestinationWithTestRegistry(
        destination.destinationId,
        destinationSha256,
        destinationRegistry([
          destination,
          validDeploymentDestination({
            epochId: '2'.repeat(64),
            awsRegion: 'us-west-2',
            stackName: 'crypto-lending-production-secondary',
            publicOrigin: 'https://secondary.example.com',
          }),
        ]),
      ),
    ProductionDeploymentDestinationInvalidError,
  );
  assert.throws(
    () =>
      resolveProductionDeploymentDestinationWithTestRegistry(
        destination.destinationId,
        destinationSha256,
        destinationRegistry([
          destination,
          validDeploymentDestination({
            destinationId: 'production-us-west-2-secondary',
            awsRegion: 'us-west-2',
            stackName: 'crypto-lending-production-secondary',
            publicOrigin: 'https://secondary.example.com',
          }),
        ]),
      ),
    ProductionDeploymentDestinationInvalidError,
  );
  assert.throws(
    () =>
      resolveProductionDeploymentDestinationWithTestRegistry(
        destination.destinationId,
        destinationSha256,
        destinationRegistry([
          destination,
          validDeploymentDestination({
            destinationId: 'production-us-east-1-secondary',
            epochId: '2'.repeat(64),
            publicOrigin: 'https://secondary.example.com',
          }),
        ]),
      ),
    ProductionDeploymentDestinationInvalidError,
  );
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

test('rejects an identity Ed25519 authority key and forged identity signature', () => {
  const identityPoint = Buffer.alloc(32);
  identityPoint[0] = 1;
  const identitySpki = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    identityPoint,
  ]);
  const forgedBundle = jsonRecord(signedBundleBytes());
  const forgedSignatures = forgedBundle.signatures as unknown[];
  const forgedIssuerSignature = mutableRecord(forgedSignatures[0]);
  forgedIssuerSignature.valueBase64 = Buffer.concat([identityPoint, Buffer.alloc(32)]).toString(
    'base64',
  );
  const forgedRegistry = authorityRegistry([
    authorityKey('DEPLOYMENT_EVIDENCE_ISSUER', 'deployment-evidence-issuer', ISSUER_KEY.publicKey, {
      publicKeySpkiDerBase64: identitySpki.toString('base64'),
    }),
    authorityKey(
      'INDEPENDENT_RELEASE_VERIFIER',
      'independent-release-verifier',
      VERIFIER_KEY.publicKey,
    ),
  ]);

  expectInvalid(() =>
    verifyProductionEvidenceBundleBytesWithTestRegistries(
      canonicalBytes(forgedBundle),
      testOptions({ authorityKeyRegistry: forgedRegistry }),
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

test('schema v2 rejects v1 bundles and every write-authority assertion', () => {
  const base = jsonRecord(signedBundleBytes());
  const oldSchema = structuredClone(base);
  oldSchema.schemaVersion = 1;
  expectInvalid(() =>
    productionEvidenceBundleSigningBytes({
      ...unsignedBundle(),
      schemaVersion: 1,
    } as unknown as UnsignedProductionEvidenceBundle),
  );
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

  for (const claim of [oldSchema, writeScope, writeIndex, writeAuthority, unverifiedReference]) {
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
    rdsMasterLifecycleEvidenceAccepted: false,
    egress: {
      localValidationPassed: true,
      status: 'NOT_APPROVED',
      currentMode: 'NO_EXTERNAL_EGRESS',
      liveEvidenceComplete: false,
    },
    rpcProviders: {
      localValidationPassed: true,
      dormantInventoryValidationPassed: true,
      activeScopeResearchCaptureValidationPassed: true,
      externalStatus: 'PENDING_EXTERNAL_REGISTRATION',
      runtimeStatus: 'NOT_APPROVED',
      approvalBoundaryApproved: false,
      liveEvidenceAccepted: false,
    },
    platforms: {
      directory: {},
      dormantActionBoundaryValidationPassed: false,
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
  assert.equal(input.rdsMasterLifecycleEvidenceAccepted, false);
  assert.equal(input.platforms.mainnetWriteEvidenceIndex, null);
});
