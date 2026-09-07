import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_AUTHORITY_KEY_REGISTRY,
  PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_SCOPE,
  ProductionDeploymentTargetIdentityEnrollmentInvalidError,
  canonicalizeProductionDeploymentTargetIdentityEnrollmentValue,
  isTestVerifiedProductionDeploymentTargetIdentityEnrollment,
  isTestVerifiedProductionDeploymentTargetIdentityEnrollmentFreshAtForTest,
  isVerifiedProductionDeploymentTargetIdentityEnrollment,
  productionDeploymentTargetIdentityEnrollmentContentSha256,
  productionDeploymentTargetIdentityEnrollmentSigningBytes,
  verifyProductionDeploymentTargetIdentityEnrollmentBytes,
  verifyProductionDeploymentTargetIdentityEnrollmentBytesWithTestRegistries,
} from './production-deployment-enrollment.mjs';
import {
  productionDeploymentDestinationSha256,
  productionDeploymentTargetSha256,
  resolveProductionDeploymentDestinationWithTestRegistry,
} from './production-deployment-target.mjs';

const ACCOUNT_ID = '123456789012';
const REGION = 'us-east-1';
const STACK_NAME = 'crypto-lending-production';
const ORIGIN = 'https://app.example.com';
const OBSERVED_AT = '2026-09-07T17:58:00.000Z';
const ISSUED_AT = '2026-09-07T18:00:00.000Z';
const SIGNED_AT = '2026-09-07T18:01:00.000Z';
const EVALUATED_AT = '2026-09-07T18:02:00.000Z';
const EXPIRES_AT = '2026-09-07T18:10:00.000Z';
const SOURCE_REVISION = 'a'.repeat(40);
const RELEASE_MANIFEST_SHA256 = 'b'.repeat(64);
const OWNER_SEED = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const SECURITY_SEED = '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb';

function keyPairFromSeed(seedHex) {
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(seedHex, 'hex'),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  return Object.freeze({ privateKey, publicKey: createPublicKey(privateKey) });
}

const OWNER_KEY = keyPairFromSeed(OWNER_SEED);
const SECURITY_KEY = keyPairFromSeed(SECURITY_SEED);

function clone(value) {
  return structuredClone(value);
}

function destination(overrides = {}) {
  return {
    destinationId: 'production-provisioning-us-east-1',
    epochId: '1'.repeat(64),
    environment: 'production',
    awsAccountId: ACCOUNT_ID,
    awsRegion: REGION,
    stackName: STACK_NAME,
    publicOrigin: ORIGIN,
    ...overrides,
  };
}

function destinationRegistry(value = destination()) {
  return {
    schemaVersion: 1,
    artifactType: 'PRODUCTION_DEPLOYMENT_DESTINATION_REGISTRY',
    destinations: [value],
  };
}

function component(repository, family, imageDigest) {
  return {
    imageUri: `${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${repository}@sha256:${imageDigest}`,
    taskDefinitionArn: `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:task-definition/${family}:1`,
  };
}

function deployedTarget(overrides = {}) {
  const apiImageDigest = 'c'.repeat(64);
  return {
    targetId: 'production-primary-v1',
    environment: 'production',
    awsAccountId: ACCOUNT_ID,
    awsRegion: REGION,
    publicOrigin: ORIGIN,
    cognito: {
      userPoolId: `${REGION}_AbCdEf123`,
      appClientId: 'a'.repeat(26),
      loginHost: `crypto-lending.auth.${REGION}.amazoncognito.com`,
      issuer: `https://cognito-idp.${REGION}.amazonaws.com/${REGION}_AbCdEf123`,
    },
    rds: {
      cloudFormationStackId:
        `arn:aws:cloudformation:${REGION}:${ACCOUNT_ID}:stack/${STACK_NAME}/` +
        '11111111-1111-4111-8111-111111111111',
      databaseInstanceArn: `arn:aws:rds:${REGION}:${ACCOUNT_ID}:db:crypto-lending-production`,
      databaseResourceId: `db-${'A'.repeat(26)}`,
      databaseManagedSecretArn:
        `arn:aws:secretsmanager:${REGION}:${ACCOUNT_ID}:secret:rds!db-` +
        `${'a'.repeat(36)}-AbCdEf`,
      applicationDataKeyArn: `arn:aws:kms:${REGION}:${ACCOUNT_ID}:key/11111111-1111-4111-8111-111111111111`,
    },
    deployedComponents: {
      api: component('crypto-lending-api', 'crypto-lending-api', apiImageDigest),
      web: component('crypto-lending-web', 'crypto-lending-web', 'd'.repeat(64)),
      outboxWorker: component('crypto-lending-api', 'crypto-lending-outbox-worker', apiImageDigest),
      migration: component('crypto-lending-api', 'crypto-lending-migration', apiImageDigest),
    },
    ...overrides,
  };
}

function authorityKey(keyId, role, keyPair, publicKeyOverride) {
  return {
    keyId,
    role,
    scope: PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_SCOPE,
    algorithm: 'Ed25519',
    status: 'APPROVED',
    publicKeySpkiDerBase64:
      publicKeyOverride ??
      keyPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2027-01-01T00:00:00.000Z',
    approvalReferenceId: `security/enrollment/${keyId}`,
  };
}

function authorityRegistry(
  keys = [
    authorityKey('deployment-owner-1', 'DEPLOYMENT_OWNER', OWNER_KEY),
    authorityKey('independent-security-1', 'INDEPENDENT_SECURITY', SECURITY_KEY),
  ],
) {
  return {
    schemaVersion: 1,
    artifactType: 'PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_AUTHORITY_KEY_REGISTRY',
    keys,
  };
}

function enrollmentContent(
  destinationValue = destination(),
  target = deployedTarget(),
  overrides = {},
) {
  return {
    status: 'TARGET_IDENTITY_ACCEPTED',
    enrollmentId: 'enrollment.production.epoch-1',
    observedAt: OBSERVED_AT,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    destinationBinding: {
      destinationId: destinationValue.destinationId,
      destinationSha256: productionDeploymentDestinationSha256(destinationValue),
      epochId: destinationValue.epochId,
      destinationRegistrySha256: destinationRegistrySha256(destinationValue),
    },
    provisionBinding: {
      operation: 'PROVISION_INERT',
      sequence: 1,
      outcome: 'CLAIMED_INERT_DEPLOYED',
      intentSha256: '2'.repeat(64),
      reservationSha256: '3'.repeat(64),
      resultSha256: '4'.repeat(64),
      sourceRevision: SOURCE_REVISION,
      releaseCandidateManifestSha256: RELEASE_MANIFEST_SHA256,
    },
    targetBinding: {
      deploymentTargetId: target.targetId,
      deploymentTargetSha256: productionDeploymentTargetSha256(target),
      target,
    },
    ...overrides,
  };
}

function destinationRegistrySha256(destinationValue) {
  // The canonical destination API deliberately derives but does not export the
  // registry digest. Obtain it through its unbranded test resolver contract.
  const registry = destinationRegistry(destinationValue);
  return resolveProductionDeploymentDestinationWithTestRegistry(
    destinationValue.destinationId,
    productionDeploymentDestinationSha256(destinationValue),
    registry,
  ).registrySha256;
}

function signedArtifact(content = enrollmentContent()) {
  const unsigned = {
    schemaVersion: 1,
    artifactType: 'PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT',
    enrollmentSha256: productionDeploymentTargetIdentityEnrollmentContentSha256(content),
    content,
  };
  const signerInputs = [
    {
      role: 'DEPLOYMENT_OWNER',
      scope: PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_SCOPE,
      authorityKeyId: 'deployment-owner-1',
      signedAt: SIGNED_AT,
      key: OWNER_KEY.privateKey,
    },
    {
      role: 'INDEPENDENT_SECURITY',
      scope: PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_SCOPE,
      authorityKeyId: 'independent-security-1',
      signedAt: SIGNED_AT,
      key: SECURITY_KEY.privateKey,
    },
  ];
  const signatures = signerInputs.map(({ key, ...signerValue }) => ({
    ...signerValue,
    algorithm: 'Ed25519',
    valueBase64: sign(
      null,
      productionDeploymentTargetIdentityEnrollmentSigningBytes(unsigned, signerValue),
      key,
    ).toString('base64'),
  }));
  return { ...unsigned, signatures };
}

function bytes(value) {
  return Buffer.from(
    `${canonicalizeProductionDeploymentTargetIdentityEnrollmentValue(value)}\n`,
    'utf8',
  );
}

function options(destinationValue = destination(), registry = authorityRegistry()) {
  return {
    clockReadings: [
      { wallTime: EVALUATED_AT, monotonicMilliseconds: 1_000 },
      { wallTime: EVALUATED_AT, monotonicMilliseconds: 1_001 },
    ],
    destinationRegistry: destinationRegistry(destinationValue),
    authorityKeyRegistry: registry,
  };
}

function expectInvalid(callback) {
  assert.throws(callback, ProductionDeploymentTargetIdentityEnrollmentInvalidError);
}

test('accepts exact dual-role enrollment evidence but grants no production or execution authority', () => {
  const artifact = signedArtifact();
  const report = verifyProductionDeploymentTargetIdentityEnrollmentBytesWithTestRegistries(
    bytes(artifact),
    options(),
  );
  assert.equal(report.targetIdentityEvidenceAccepted, true);
  assert.equal(report.provisionStateClaim, 'INERT_DEPLOYED_UNVERIFIED');
  assert.equal(report.consumerRequirements.liveStateBrandRequired, true);
  assert.equal(report.consumerRequirements.atomicChainHeadCasBrandRequired, true);
  assert.equal(report.destination.epochId, '1'.repeat(64));
  assert.equal(report.provisionBinding.sourceRevision, SOURCE_REVISION);
  assert.equal(report.deployedTarget.targetId, 'production-primary-v1');
  assert.equal(report.replayProtection, 'EXTERNAL_CHAIN_REQUIRED');
  assert.equal(report.atomicChainHeadConsumed, false);
  assert.equal(report.externalStateVerified, false);
  assert.equal(report.executionAllowed, false);
  assert.equal(report.networkCallsMade, 0);
  assert.equal(isTestVerifiedProductionDeploymentTargetIdentityEnrollment(report), true);
  assert.equal(isVerifiedProductionDeploymentTargetIdentityEnrollment(report), false);
  assert.equal(isTestVerifiedProductionDeploymentTargetIdentityEnrollment({ ...report }), false);
  assert.equal(Object.isFrozen(report), true);

  const replayed = verifyProductionDeploymentTargetIdentityEnrollmentBytesWithTestRegistries(
    bytes(artifact),
    options(),
  );
  assert.notEqual(replayed, report);
  assert.equal(replayed.atomicChainHeadConsumed, false);
});

test('production trust starts empty and the test seam cannot mint its WeakSet brand', () => {
  assert.equal(
    PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_AUTHORITY_KEY_REGISTRY.keys.length,
    0,
  );
  assert.equal(
    Object.isFrozen(PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_AUTHORITY_KEY_REGISTRY),
    true,
  );
  assert.equal(
    Object.isFrozen(PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_AUTHORITY_KEY_REGISTRY.keys),
    true,
  );
  expectInvalid(() =>
    verifyProductionDeploymentTargetIdentityEnrollmentBytes(bytes(signedArtifact())),
  );
  assert.equal(isVerifiedProductionDeploymentTargetIdentityEnrollment(Object.freeze({})), false);
});

test('rejects tampering, unknown fields, noncanonical bytes, and signature changes', () => {
  const artifact = signedArtifact();
  const tampered = clone(artifact);
  tampered.content.provisionBinding.resultSha256 = '9'.repeat(64);
  expectInvalid(() =>
    verifyProductionDeploymentTargetIdentityEnrollmentBytesWithTestRegistries(
      bytes(tampered),
      options(),
    ),
  );

  const unknown = clone(artifact);
  unknown.content.undocumentedAuthority = true;
  expectInvalid(() =>
    verifyProductionDeploymentTargetIdentityEnrollmentBytesWithTestRegistries(
      bytes(unknown),
      options(),
    ),
  );

  const signatureTamper = clone(artifact);
  signatureTamper.signatures[0].valueBase64 = Buffer.alloc(64, 7).toString('base64');
  expectInvalid(() =>
    verifyProductionDeploymentTargetIdentityEnrollmentBytesWithTestRegistries(
      bytes(signatureTamper),
      options(),
    ),
  );

  expectInvalid(() =>
    verifyProductionDeploymentTargetIdentityEnrollmentBytesWithTestRegistries(
      Buffer.from(JSON.stringify(artifact, null, 2), 'utf8'),
      options(),
    ),
  );
});

test('rejects cross-destination and epoch replay while explicitly leaving same-context consumption external', () => {
  const artifact = signedArtifact();
  const replacementEpoch = destination({ epochId: '8'.repeat(64) });
  expectInvalid(() =>
    verifyProductionDeploymentTargetIdentityEnrollmentBytesWithTestRegistries(
      bytes(artifact),
      options(replacementEpoch),
    ),
  );
  const replacementDestination = destination({
    destinationId: 'production-provisioning-us-west-2',
    epochId: '7'.repeat(64),
    awsRegion: 'us-west-2',
    stackName: 'crypto-lending-production-west',
    publicOrigin: 'https://west.example.com',
  });
  expectInvalid(() =>
    verifyProductionDeploymentTargetIdentityEnrollmentBytesWithTestRegistries(
      bytes(artifact),
      options(replacementDestination),
    ),
  );
});

test('rejects signed target continuity mismatches for account, Region, stack, and public origin', () => {
  const mismatchedDestinations = [
    destination({ awsAccountId: '210987654321' }),
    destination({ awsRegion: 'us-west-2' }),
    destination({ stackName: 'different-production-stack' }),
    destination({ publicOrigin: 'https://other.example.com' }),
  ];
  for (const destinationValue of mismatchedDestinations) {
    const artifact = signedArtifact(enrollmentContent(destinationValue));
    expectInvalid(() =>
      verifyProductionDeploymentTargetIdentityEnrollmentBytesWithTestRegistries(
        bytes(artifact),
        options(destinationValue),
      ),
    );
  }
});

test('rejects duplicate signer roles, authority IDs, and physical Ed25519 keys', () => {
  const duplicateRole = clone(signedArtifact());
  duplicateRole.signatures[1] = clone(duplicateRole.signatures[0]);
  expectInvalid(() =>
    verifyProductionDeploymentTargetIdentityEnrollmentBytesWithTestRegistries(
      bytes(duplicateRole),
      options(),
    ),
  );

  const duplicateIdRegistry = authorityRegistry([
    authorityKey('deployment-owner-1', 'DEPLOYMENT_OWNER', OWNER_KEY),
    authorityKey('deployment-owner-1', 'INDEPENDENT_SECURITY', SECURITY_KEY),
  ]);
  expectInvalid(() =>
    verifyProductionDeploymentTargetIdentityEnrollmentBytesWithTestRegistries(
      bytes(signedArtifact()),
      options(destination(), duplicateIdRegistry),
    ),
  );

  const ownerDer = OWNER_KEY.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const duplicatePhysicalKeyRegistry = authorityRegistry([
    authorityKey('deployment-owner-1', 'DEPLOYMENT_OWNER', OWNER_KEY),
    authorityKey('independent-security-1', 'INDEPENDENT_SECURITY', SECURITY_KEY, ownerDer),
  ]);
  expectInvalid(() =>
    verifyProductionDeploymentTargetIdentityEnrollmentBytesWithTestRegistries(
      bytes(signedArtifact()),
      options(destination(), duplicatePhysicalKeyRegistry),
    ),
  );
});

test('rejects an identity public key and its forged identity signature before OpenSSL trust', () => {
  const identityRaw = Buffer.alloc(32);
  identityRaw[0] = 1;
  const identitySpki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), identityRaw]);
  // Node accepts the SPKI structure as Ed25519; the enrollment registry must
  // independently reject the point before treating it as an authority key.
  assert.equal(
    createPublicKey({ key: identitySpki, format: 'der', type: 'spki' }).asymmetricKeyType,
    'ed25519',
  );
  const forgedArtifact = clone(signedArtifact());
  forgedArtifact.signatures[0].valueBase64 = Buffer.concat([
    identityRaw,
    Buffer.alloc(32),
  ]).toString('base64');
  const forgedRegistry = authorityRegistry([
    authorityKey(
      'deployment-owner-1',
      'DEPLOYMENT_OWNER',
      OWNER_KEY,
      identitySpki.toString('base64'),
    ),
    authorityKey('independent-security-1', 'INDEPENDENT_SECURITY', SECURITY_KEY),
  ]);
  expectInvalid(() =>
    verifyProductionDeploymentTargetIdentityEnrollmentBytesWithTestRegistries(
      bytes(forgedArtifact),
      options(destination(), forgedRegistry),
    ),
  );
});

test('content, signing bytes, and deterministic authority registry have fixed hashes', () => {
  const artifact = signedArtifact();
  const { signatures, ...unsigned } = artifact;
  const signerValue = {
    role: signatures[0].role,
    scope: signatures[0].scope,
    authorityKeyId: signatures[0].authorityKeyId,
    signedAt: signatures[0].signedAt,
  };
  const report = verifyProductionDeploymentTargetIdentityEnrollmentBytesWithTestRegistries(
    bytes(artifact),
    options(),
  );
  assert.equal(
    artifact.enrollmentSha256,
    'd04326068221c23bf3a76869ac27ab155a3079696e50d2dbe7d36b62c24ccf96',
  );
  assert.equal(
    createHash('sha256')
      .update(productionDeploymentTargetIdentityEnrollmentSigningBytes(unsigned, signerValue))
      .digest('hex'),
    'c78674cf32e7d6727f104e0323b63c3250f8991da56f32e7311a047f9f85f7a7',
  );
  assert.equal(
    report.authorityRegistrySha256,
    '49de05aa4356997ed93ea6bb00602bdcbac900741a31a118d2836d2f5f83adaa',
  );
});

test('rejects expired, premature, and overlong enrollment evidence', () => {
  expectInvalid(() =>
    verifyProductionDeploymentTargetIdentityEnrollmentBytesWithTestRegistries(
      bytes(signedArtifact()),
      {
        ...options(),
        clockReadings: [
          { wallTime: EXPIRES_AT, monotonicMilliseconds: 1_000 },
          { wallTime: EXPIRES_AT, monotonicMilliseconds: 1_001 },
        ],
      },
    ),
  );
  expectInvalid(() =>
    verifyProductionDeploymentTargetIdentityEnrollmentBytesWithTestRegistries(
      bytes(signedArtifact()),
      {
        ...options(),
        clockReadings: [
          { wallTime: '2026-09-07T17:59:59.000Z', monotonicMilliseconds: 1_000 },
          { wallTime: '2026-09-07T17:59:59.000Z', monotonicMilliseconds: 1_001 },
        ],
      },
    ),
  );
  expectInvalid(() =>
    productionDeploymentTargetIdentityEnrollmentContentSha256(
      enrollmentContent(destination(), deployedTarget(), {
        expiresAt: '2026-09-07T18:15:00.001Z',
      }),
    ),
  );
});

test('application-time freshness fails closed at expiry and sticks after wall or monotonic rollback', () => {
  function freshReport() {
    return verifyProductionDeploymentTargetIdentityEnrollmentBytesWithTestRegistries(
      bytes(signedArtifact()),
      options(),
    );
  }

  const atExpiry = freshReport();
  assert.equal(
    isTestVerifiedProductionDeploymentTargetIdentityEnrollmentFreshAtForTest(atExpiry, {
      wallTime: EXPIRES_AT,
      monotonicMilliseconds: 1_002,
    }),
    false,
  );

  const wallRollback = freshReport();
  assert.equal(
    isTestVerifiedProductionDeploymentTargetIdentityEnrollmentFreshAtForTest(wallRollback, {
      wallTime: '2026-09-07T18:01:59.999Z',
      monotonicMilliseconds: 1_002,
    }),
    false,
  );
  assert.equal(
    isTestVerifiedProductionDeploymentTargetIdentityEnrollmentFreshAtForTest(wallRollback, {
      wallTime: '2026-09-07T18:03:00.000Z',
      monotonicMilliseconds: 1_003,
    }),
    false,
  );

  const monotonicRollback = freshReport();
  assert.equal(
    isTestVerifiedProductionDeploymentTargetIdentityEnrollmentFreshAtForTest(monotonicRollback, {
      wallTime: '2026-09-07T18:03:00.000Z',
      monotonicMilliseconds: 1_000,
    }),
    false,
  );
  assert.equal(
    isTestVerifiedProductionDeploymentTargetIdentityEnrollmentFreshAtForTest(
      { ...monotonicRollback },
      {
        wallTime: '2026-09-07T18:03:00.000Z',
        monotonicMilliseconds: 1_002,
      },
    ),
    false,
  );
});

test('verifier source has no I/O, cloud, network, subprocess, environment, or write capability', () => {
  const source = readFileSync(
    new URL('./production-deployment-enrollment.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /node:(?:fs|http|https|net|dns|child_process)/u);
  assert.doesNotMatch(source, /\b(?:fetch|process\.env|spawn|exec|writeFile|cloudFormation)\b/u);
});
