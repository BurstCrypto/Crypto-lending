import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  sign,
  type KeyObject,
  type KeyPairKeyObjectResult,
} from 'node:crypto';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  canonicalPublicLaunchAuthorityJson,
  closePublicLaunchAuthorityFileDescriptorForTest,
  isVerifiedPublicLaunchAuthorityDecisionSet,
  loadAndVerifyPublicLaunchAuthorityDecisionWithTestRegistry,
  MAX_PUBLIC_LAUNCH_AUTHORITY_DECISION_BYTES,
  parseAndVerifyPublicLaunchAuthorityDecisionBytes,
  PUBLIC_LAUNCH_AUTHORITY_KEY_REGISTRY,
  PUBLIC_LAUNCH_AUTHORITY_ROLES,
  PUBLIC_LAUNCH_AUTHORITY_SCOPE,
  PublicLaunchAuthorityDecisionInvalidError,
  publicLaunchAuthorityDecisionSigningBytes,
  verifyPublicLaunchAuthorityDecisionBytesWithTestRegistry,
  type PublicLaunchAuthorityDecision,
  type PublicLaunchAuthorityDecisionSet,
  type PublicLaunchAuthorityKey,
  type PublicLaunchAuthorityKeyRegistry,
  type PublicLaunchAuthorityRole,
  type PublicLaunchTargetBinding,
  type TestPublicLaunchAuthorityDecisionVerificationOptions,
  type UnsignedPublicLaunchAuthorityDecision,
} from './public-launch-authority-decision';

const BINDING = Object.freeze({
  releaseCandidateManifestSha256: 'a'.repeat(64),
  deploymentTargetId: 'aws-production-us-east-1-crypto-lending',
  deploymentTargetConfigurationSha256: 'b'.repeat(64),
  productionEvidenceBundleSha256: 'c'.repeat(64),
} satisfies PublicLaunchTargetBinding);
const EVALUATED_AT = '2026-09-04T12:00:00.000Z';
const APPROVED_AT = '2026-09-04T11:00:00.000Z';
const EXPIRES_AT = '2026-09-05T11:00:00.000Z';
const KEY_VALID_FROM = '2026-01-01T00:00:00.000Z';
const KEY_VALID_UNTIL = '2027-01-01T00:00:00.000Z';

interface TestAuthority {
  readonly role: PublicLaunchAuthorityRole;
  readonly keyId: string;
  readonly keyPair: KeyPairKeyObjectResult;
}

const TEST_AUTHORITIES: readonly TestAuthority[] = Object.freeze(
  PUBLIC_LAUNCH_AUTHORITY_ROLES.map((role, index) =>
    Object.freeze({
      role,
      keyId: `authority-${String(index + 1).padStart(2, '0')}`,
      keyPair: generateKeyPairSync('ed25519'),
    }),
  ),
);

function authorityPublicKeyBase64(key: KeyObject): string {
  return Buffer.from(key.export({ format: 'der', type: 'spki' })).toString('base64');
}

function testRegistry(): PublicLaunchAuthorityKeyRegistry {
  return {
    schemaVersion: 1,
    artifactType: 'PUBLIC_LAUNCH_AUTHORITY_KEY_REGISTRY',
    keys: TEST_AUTHORITIES.map(({ role, keyId, keyPair }): PublicLaunchAuthorityKey => ({
      keyId,
      role,
      scope: PUBLIC_LAUNCH_AUTHORITY_SCOPE,
      algorithm: 'Ed25519',
      status: 'APPROVED',
      publicKeySpkiDerBase64: authorityPublicKeyBase64(keyPair.publicKey),
      validFrom: KEY_VALID_FROM,
      validUntil: KEY_VALID_UNTIL,
      approvalReferenceId: `authority-registry/${keyId}`,
    })),
  };
}

function unsignedDecision(authority: TestAuthority): UnsignedPublicLaunchAuthorityDecision {
  return {
    role: authority.role,
    scope: PUBLIC_LAUNCH_AUTHORITY_SCOPE,
    authorityKeyId: authority.keyId,
    decision: 'APPROVED',
    approvedAt: APPROVED_AT,
    expiresAt: EXPIRES_AT,
    approvalReferenceId: `release-approval/${authority.keyId}`,
  };
}

function signedDecision(
  authority: TestAuthority,
  binding: PublicLaunchTargetBinding = BINDING,
  unsigned: UnsignedPublicLaunchAuthorityDecision = unsignedDecision(authority),
): PublicLaunchAuthorityDecision {
  return {
    ...unsigned,
    signature: {
      algorithm: 'Ed25519',
      valueBase64: sign(
        null,
        publicLaunchAuthorityDecisionSigningBytes(binding, unsigned),
        authority.keyPair.privateKey,
      ).toString('base64'),
    },
  };
}

function decisionSet(
  binding: PublicLaunchTargetBinding = BINDING,
): PublicLaunchAuthorityDecisionSet {
  return {
    schemaVersion: 2,
    artifactType: 'PUBLIC_LAUNCH_AUTHORITY_DECISION_SET',
    ...binding,
    decisions: TEST_AUTHORITIES.map((authority) => signedDecision(authority, binding)),
  };
}

function verificationOptions(
  overrides: Partial<TestPublicLaunchAuthorityDecisionVerificationOptions> = {},
): TestPublicLaunchAuthorityDecisionVerificationOptions {
  return {
    evaluatedAt: EVALUATED_AT,
    ...BINDING,
    authorityKeyRegistry: testRegistry(),
    ...overrides,
  };
}

function bytes(value: unknown = decisionSet()): Buffer {
  return Buffer.from(canonicalPublicLaunchAuthorityJson(value), 'utf8');
}

function mutableRoot(): Record<string, unknown> {
  return JSON.parse(bytes().toString('utf8')) as Record<string, unknown>;
}

function objectValue(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

function rootDecision(root: Record<string, unknown>, index: number): Record<string, unknown> {
  const candidate = arrayValue(root.decisions)[index];
  assert.notEqual(candidate, undefined);
  return objectValue(candidate);
}

function registryKey(
  registry: PublicLaunchAuthorityKeyRegistry | Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  const candidate = arrayValue(objectValue(registry).keys)[index];
  assert.notEqual(candidate, undefined);
  return objectValue(candidate);
}

function testAuthorityByKeyId(keyId: unknown): TestAuthority {
  const authority = TEST_AUTHORITIES.find((candidate) => candidate.keyId === keyId);
  assert.ok(authority);
  return authority;
}

function bindingFromRoot(root: Record<string, unknown>): PublicLaunchTargetBinding {
  const releaseCandidateManifestSha256 = root.releaseCandidateManifestSha256;
  const deploymentTargetId = root.deploymentTargetId;
  const deploymentTargetConfigurationSha256 = root.deploymentTargetConfigurationSha256;
  const productionEvidenceBundleSha256 = root.productionEvidenceBundleSha256;
  assert.ok(typeof releaseCandidateManifestSha256 === 'string');
  assert.ok(typeof deploymentTargetId === 'string');
  assert.ok(typeof deploymentTargetConfigurationSha256 === 'string');
  assert.ok(typeof productionEvidenceBundleSha256 === 'string');
  return {
    releaseCandidateManifestSha256,
    deploymentTargetId,
    deploymentTargetConfigurationSha256,
    productionEvidenceBundleSha256,
  };
}

function resignDecision(root: Record<string, unknown>, index: number): void {
  const candidate = rootDecision(root, index);
  const authority = testAuthorityByKeyId(candidate.authorityKeyId);
  const unsigned: UnsignedPublicLaunchAuthorityDecision = {
    role: candidate.role as PublicLaunchAuthorityRole,
    scope: candidate.scope as typeof PUBLIC_LAUNCH_AUTHORITY_SCOPE,
    authorityKeyId: authority.keyId,
    decision: candidate.decision as 'APPROVED',
    approvedAt: candidate.approvedAt as string,
    expiresAt: candidate.expiresAt as string,
    approvalReferenceId: candidate.approvalReferenceId as string,
  };
  candidate.signature = {
    algorithm: 'Ed25519',
    valueBase64: sign(
      null,
      publicLaunchAuthorityDecisionSigningBytes(bindingFromRoot(root), unsigned),
      authority.keyPair.privateKey,
    ).toString('base64'),
  };
}

function resignAll(root: Record<string, unknown>): void {
  for (const index of PUBLIC_LAUNCH_AUTHORITY_ROLES.keys()) resignDecision(root, index);
}

function verify(
  input: Uint8Array = bytes(),
  options: TestPublicLaunchAuthorityDecisionVerificationOptions = verificationOptions(),
) {
  return verifyPublicLaunchAuthorityDecisionBytesWithTestRegistry(input, options);
}

function assertInvalid(action: () => unknown): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof PublicLaunchAuthorityDecisionInvalidError);
    assert.equal(error.code, 'PUBLIC_LAUNCH_AUTHORITY_DECISION_INVALID');
    assert.equal(error.message, 'Public launch authority decision is invalid');
    return true;
  });
}

function mutableRegistry(): Record<string, unknown> {
  return structuredClone(testRegistry()) as unknown as Record<string, unknown>;
}

function optionsWithRegistry(
  registry: Record<string, unknown>,
): TestPublicLaunchAuthorityDecisionVerificationOptions {
  return verificationOptions({
    authorityKeyRegistry: registry as unknown as PublicLaunchAuthorityKeyRegistry,
  });
}

function withTemporaryDirectory(run: (directory: string) => void): void {
  const created = mkdtempSync(join(tmpdir(), 'public-launch-authority-'));
  const directory = realpathSync.native(created);
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function skipUnsupportedLink(error: unknown, context: TestContext): void {
  const code = objectValue(error).code;
  if (
    typeof code === 'string' &&
    ['EACCES', 'EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(code)
  ) {
    context.skip(`filesystem link operation is unavailable (${code})`);
    return;
  }
  throw error;
}

test('accepts exactly seven independently signed, bound and current approvals with a test registry', () => {
  const verified = verify();

  assert.equal(verified.signatureValidated, true);
  assert.equal(verified.releaseCandidateManifestSha256, BINDING.releaseCandidateManifestSha256);
  assert.equal(verified.deploymentTargetId, BINDING.deploymentTargetId);
  assert.equal(
    verified.deploymentTargetConfigurationSha256,
    BINDING.deploymentTargetConfigurationSha256,
  );
  assert.equal(verified.productionEvidenceBundleSha256, BINDING.productionEvidenceBundleSha256);
  assert.deepEqual(
    verified.decisions.map(({ role }) => role),
    PUBLIC_LAUNCH_AUTHORITY_ROLES,
  );
  assert.equal(verified.validUntil, EXPIRES_AT);
  assert.match(verified.authorityRegistrySha256, /^[a-f0-9]{64}$/u);
  assert.match(verified.decisionSetSha256, /^[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(verified), true);
  assert.equal(Object.isFrozen(verified.decisions), true);
  assert.equal(Object.isFrozen(verified.decisions[0]), true);
  assert.equal(isVerifiedPublicLaunchAuthorityDecisionSet(verified), false);
});

test('keeps the checked-in production trust registry empty, deeply frozen, and fail-closed', () => {
  assert.equal(PUBLIC_LAUNCH_AUTHORITY_KEY_REGISTRY.keys.length, 0);
  assert.equal(Object.isFrozen(PUBLIC_LAUNCH_AUTHORITY_KEY_REGISTRY), true);
  assert.equal(Object.isFrozen(PUBLIC_LAUNCH_AUTHORITY_KEY_REGISTRY.keys), true);
  assertInvalid(() => parseAndVerifyPublicLaunchAuthorityDecisionBytes(bytes(), BINDING));
  assert.equal(
    isVerifiedPublicLaunchAuthorityDecisionSet({
      ...decisionSet(),
      signatureValidated: true,
      authorityRegistrySha256: 'c'.repeat(64),
      decisionSetSha256: 'd'.repeat(64),
      validUntil: EXPIRES_AT,
    }),
    false,
  );
});

test('rejects missing, duplicated, reordered, and wrong-role decisions', () => {
  const missing = mutableRoot();
  arrayValue(missing.decisions).pop();
  assertInvalid(() => verify(bytes(missing)));

  const duplicated = mutableRoot();
  const duplicatedDecisions = arrayValue(duplicated.decisions);
  duplicatedDecisions[1] = structuredClone(duplicatedDecisions[0]);
  assertInvalid(() => verify(bytes(duplicated)));

  const reordered = mutableRoot();
  const reorderedDecisions = arrayValue(reordered.decisions);
  [reorderedDecisions[0], reorderedDecisions[1]] = [reorderedDecisions[1], reorderedDecisions[0]];
  assertInvalid(() => verify(bytes(reordered)));

  const wrongRole = mutableRoot();
  rootDecision(wrongRole, 0).role = PUBLIC_LAUNCH_AUTHORITY_ROLES[1];
  resignDecision(wrongRole, 0);
  assertInvalid(() => verify(bytes(wrongRole)));
});

test('rejects reuse of an authority ID or identical authority key material across roles', () => {
  const reusedDecisionKey = mutableRoot();
  const second = rootDecision(reusedDecisionKey, 1);
  second.authorityKeyId = TEST_AUTHORITIES[0]?.keyId;
  second.role = PUBLIC_LAUNCH_AUTHORITY_ROLES[1];
  assertInvalid(() => verify(bytes(reusedDecisionKey)));

  const reusedMaterial = mutableRegistry();
  registryKey(reusedMaterial, 1).publicKeySpkiDerBase64 = registryKey(
    reusedMaterial,
    0,
  ).publicKeySpkiDerBase64;
  assertInvalid(() => verify(bytes(), optionsWithRegistry(reusedMaterial)));

  const duplicateRegistryId = mutableRegistry();
  registryKey(duplicateRegistryId, 1).keyId = registryKey(duplicateRegistryId, 0).keyId;
  assertInvalid(() => verify(bytes(), optionsWithRegistry(duplicateRegistryId)));
});

test('rejects wrong registry role, status, validity, ordering, and missing authority', () => {
  const wrongRole = mutableRegistry();
  registryKey(wrongRole, 0).role = PUBLIC_LAUNCH_AUTHORITY_ROLES[1];
  assertInvalid(() => verify(bytes(), optionsWithRegistry(wrongRole)));

  const wrongScope = mutableRegistry();
  registryKey(wrongScope, 0).scope = 'READ_ONLY';
  assertInvalid(() => verify(bytes(), optionsWithRegistry(wrongScope)));

  const wrongStatus = mutableRegistry();
  registryKey(wrongStatus, 0).status = 'REVOKED';
  assertInvalid(() => verify(bytes(), optionsWithRegistry(wrongStatus)));

  const futureKey = mutableRegistry();
  registryKey(futureKey, 0).validFrom = '2026-09-04T11:30:00.000Z';
  assertInvalid(() => verify(bytes(), optionsWithRegistry(futureKey)));

  const prematurelyExpiringKey = mutableRegistry();
  registryKey(prematurelyExpiringKey, 0).validUntil = '2026-09-05T10:59:59.999Z';
  assertInvalid(() => verify(bytes(), optionsWithRegistry(prematurelyExpiringKey)));

  const overlongKey = mutableRegistry();
  registryKey(overlongKey, 0).validUntil = '2027-02-06T00:00:00.001Z';
  assertInvalid(() => verify(bytes(), optionsWithRegistry(overlongKey)));

  const unordered = mutableRegistry();
  arrayValue(unordered.keys).reverse();
  assertInvalid(() => verify(bytes(), optionsWithRegistry(unordered)));

  const missing = mutableRegistry();
  arrayValue(missing.keys).shift();
  assertInvalid(() => verify(bytes(), optionsWithRegistry(missing)));
});

test('binds every signature to the exact release candidate and deployment target scope', () => {
  const expectedMutations: ReadonlyArray<readonly [keyof PublicLaunchTargetBinding, string]> = [
    ['releaseCandidateManifestSha256', 'd'.repeat(64)],
    ['deploymentTargetId', 'aws-production-us-west-2-crypto-lending'],
    ['deploymentTargetConfigurationSha256', 'e'.repeat(64)],
    ['productionEvidenceBundleSha256', 'f'.repeat(64)],
  ];
  for (const [field, replacement] of expectedMutations) {
    assertInvalid(() => verify(bytes(), verificationOptions({ [field]: replacement })));

    const unsignedMutation = mutableRoot();
    unsignedMutation[field] = replacement;
    assertInvalid(() =>
      verify(bytes(unsignedMutation), verificationOptions({ [field]: replacement })),
    );

    resignAll(unsignedMutation);
    const rebound = verify(bytes(unsignedMutation), verificationOptions({ [field]: replacement }));
    assert.equal(rebound[field], replacement);
  }
});

test('rejects legacy, omitted, mutated, and replayed technical-evidence bundle bindings', () => {
  const legacy = mutableRoot();
  legacy.schemaVersion = 1;
  assertInvalid(() => verify(bytes(legacy)));

  const omitted = mutableRoot();
  delete omitted.productionEvidenceBundleSha256;
  assertInvalid(() => verify(bytes(omitted)));

  const replacementBundleSha256 = 'f'.repeat(64);
  const mutated = mutableRoot();
  mutated.productionEvidenceBundleSha256 = replacementBundleSha256;
  assertInvalid(() =>
    verify(
      bytes(mutated),
      verificationOptions({ productionEvidenceBundleSha256: replacementBundleSha256 }),
    ),
  );

  assertInvalid(() =>
    verify(
      bytes(),
      verificationOptions({ productionEvidenceBundleSha256: replacementBundleSha256 }),
    ),
  );
});

test('rejects altered decision fields and invalid Ed25519 signatures', () => {
  const wrongScope = mutableRoot();
  rootDecision(wrongScope, 0).scope = 'READ_ONLY';
  assertInvalid(() => verify(bytes(wrongScope)));

  const alteredApprovalReference = mutableRoot();
  rootDecision(alteredApprovalReference, 0).approvalReferenceId = 'release-approval/attacker';
  assertInvalid(() => verify(bytes(alteredApprovalReference)));

  const nonApproval = mutableRoot();
  rootDecision(nonApproval, 0).decision = 'REJECTED';
  assertInvalid(() => verify(bytes(nonApproval)));

  const wrongAlgorithm = mutableRoot();
  objectValue(rootDecision(wrongAlgorithm, 0).signature).algorithm = 'ECDSA';
  assertInvalid(() => verify(bytes(wrongAlgorithm)));

  const malformedSignature = mutableRoot();
  objectValue(rootDecision(malformedSignature, 0).signature).valueBase64 = 'AAAA';
  assertInvalid(() => verify(bytes(malformedSignature)));

  const wrongSignature = mutableRoot();
  objectValue(rootDecision(wrongSignature, 0).signature).valueBase64 = objectValue(
    rootDecision(wrongSignature, 1).signature,
  ).valueBase64;
  assertInvalid(() => verify(bytes(wrongSignature)));
});

test('enforces current, canonical, positive, and bounded decision validity', () => {
  const future = mutableRoot();
  rootDecision(future, 0).approvedAt = '2026-09-04T12:00:00.001Z';
  rootDecision(future, 0).expiresAt = '2026-09-05T12:00:00.001Z';
  resignDecision(future, 0);
  assertInvalid(() => verify(bytes(future)));

  const expired = mutableRoot();
  rootDecision(expired, 0).approvedAt = '2026-09-03T12:00:00.000Z';
  rootDecision(expired, 0).expiresAt = EVALUATED_AT;
  resignDecision(expired, 0);
  assertInvalid(() => verify(bytes(expired)));

  const overlong = mutableRoot();
  rootDecision(overlong, 0).expiresAt = '2026-09-11T11:00:00.001Z';
  assertInvalid(() => verify(bytes(overlong)));

  const reversed = mutableRoot();
  rootDecision(reversed, 0).expiresAt = APPROVED_AT;
  assertInvalid(() => verify(bytes(reversed)));

  const noncanonical = mutableRoot();
  rootDecision(noncanonical, 0).approvedAt = '2026-09-04T11:00:00Z';
  assertInvalid(() => verify(bytes(noncanonical)));

  assertInvalid(() =>
    verify(bytes(), verificationOptions({ evaluatedAt: '2026-09-04T12:00:00Z' })),
  );
});

test('rejects unknown and missing fields at every signed or trusted object boundary', () => {
  const unknownRoot = mutableRoot();
  unknownRoot.unexpected = true;
  assertInvalid(() => verify(bytes(unknownRoot)));

  const unknownDecision = mutableRoot();
  rootDecision(unknownDecision, 0).unexpected = true;
  assertInvalid(() => verify(bytes(unknownDecision)));

  const unknownSignature = mutableRoot();
  objectValue(rootDecision(unknownSignature, 0).signature).unexpected = true;
  assertInvalid(() => verify(bytes(unknownSignature)));

  const missingDecisionField = mutableRoot();
  delete rootDecision(missingDecisionField, 0).approvalReferenceId;
  assertInvalid(() => verify(bytes(missingDecisionField)));

  const unknownRegistry = mutableRegistry();
  unknownRegistry.unexpected = true;
  assertInvalid(() => verify(bytes(), optionsWithRegistry(unknownRegistry)));

  const unknownRegistryKey = mutableRegistry();
  registryKey(unknownRegistryKey, 0).unexpected = true;
  assertInvalid(() => verify(bytes(), optionsWithRegistry(unknownRegistryKey)));

  const missingRegistryRole = mutableRegistry();
  delete registryKey(missingRegistryRole, 0).role;
  assertInvalid(() => verify(bytes(), optionsWithRegistry(missingRegistryRole)));

  const options = verificationOptions() as unknown as Record<string, unknown>;
  options.unexpected = true;
  assertInvalid(() =>
    verify(bytes(), options as unknown as TestPublicLaunchAuthorityDecisionVerificationOptions),
  );
});

test('requires byte-for-byte canonical JSON and rejects duplicate keys and malformed text', () => {
  const canonical = bytes();
  const parsed = JSON.parse(canonical.toString('utf8')) as unknown;
  assertInvalid(() => verify(Buffer.from(JSON.stringify(parsed, null, 2), 'utf8')));
  assertInvalid(() => verify(Buffer.concat([canonical, Buffer.from('\n')])));
  assertInvalid(() => verify(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), canonical])));
  assertInvalid(() => verify(Buffer.concat([canonical, Buffer.from([0])])));
  assertInvalid(() => verify(Buffer.from([0xc3, 0x28])));

  const duplicateKey = canonical
    .toString('utf8')
    .replace(
      '"artifactType":"PUBLIC_LAUNCH_AUTHORITY_DECISION_SET"',
      '"artifactType":"PUBLIC_LAUNCH_AUTHORITY_DECISION_SET","artifactType":"PUBLIC_LAUNCH_AUTHORITY_DECISION_SET"',
    );
  assertInvalid(() => verify(Buffer.from(duplicateKey, 'utf8')));
  assertInvalid(() => verify(Buffer.alloc(MAX_PUBLIC_LAUNCH_AUTHORITY_DECISION_BYTES + 1, 0x20)));
  assertInvalid(() => verify(Buffer.alloc(0)));
});

test('canonicalization and signing helpers reject accessors, sparse arrays, and non-plain input', () => {
  const accessor = Object.defineProperty({}, 'secret', {
    enumerable: true,
    get: () => 'must-not-run',
  });
  assertInvalid(() => canonicalPublicLaunchAuthorityJson(accessor));

  const sparse = new Array<unknown>(1);
  assertInvalid(() => canonicalPublicLaunchAuthorityJson(sparse));
  assertInvalid(() => canonicalPublicLaunchAuthorityJson(new Date(0)));

  const unsafeBinding = Object.create(BINDING) as PublicLaunchTargetBinding;
  assertInvalid(() =>
    publicLaunchAuthorityDecisionSigningBytes(
      unsafeBinding,
      unsignedDecision(TEST_AUTHORITIES[0]!),
    ),
  );
});

test('loads a stable regular file through the unbranded test seam', () => {
  withTemporaryDirectory((directory) => {
    const path = join(directory, 'authority-decision.json');
    writeFileSync(path, bytes(), { flag: 'wx' });
    const verified = loadAndVerifyPublicLaunchAuthorityDecisionWithTestRegistry(
      path,
      verificationOptions(),
    );
    assert.equal(verified.signatureValidated, true);
    assert.equal(isVerifiedPublicLaunchAuthorityDecisionSet(verified), false);
  });
});

test('descriptor close failures retain the fixed launch-authority error contract', () => {
  assertInvalid(() => closePublicLaunchAuthorityFileDescriptorForTest(-1));
});

test('rejects empty, oversized, directory, and unstable file inputs', () => {
  withTemporaryDirectory((directory) => {
    const empty = join(directory, 'empty.json');
    writeFileSync(empty, Buffer.alloc(0), { flag: 'wx' });
    assertInvalid(() =>
      loadAndVerifyPublicLaunchAuthorityDecisionWithTestRegistry(empty, verificationOptions()),
    );

    const oversized = join(directory, 'oversized.json');
    writeFileSync(oversized, Buffer.alloc(MAX_PUBLIC_LAUNCH_AUTHORITY_DECISION_BYTES + 1, 0x20), {
      flag: 'wx',
    });
    assertInvalid(() =>
      loadAndVerifyPublicLaunchAuthorityDecisionWithTestRegistry(oversized, verificationOptions()),
    );

    const childDirectory = join(directory, 'not-a-file');
    mkdirSync(childDirectory);
    assertInvalid(() =>
      loadAndVerifyPublicLaunchAuthorityDecisionWithTestRegistry(
        childDirectory,
        verificationOptions(),
      ),
    );

    const unstable = join(directory, 'unstable.json');
    const original = bytes();
    const changed = Buffer.from(
      original.toString('utf8').replace('"APPROVED"', '"REJECTED"'),
      'utf8',
    );
    assert.equal(changed.length, original.length);
    writeFileSync(unstable, original, { flag: 'wx' });
    assertInvalid(() =>
      loadAndVerifyPublicLaunchAuthorityDecisionWithTestRegistry(
        unstable,
        verificationOptions(),
        () => writeFileSync(unstable, changed),
      ),
    );
  });
});

test('rejects a final symbolic link when the platform permits creating one', (context) => {
  withTemporaryDirectory((directory) => {
    const target = join(directory, 'target.json');
    const linked = join(directory, 'linked.json');
    writeFileSync(target, bytes(), { flag: 'wx' });
    try {
      symlinkSync(target, linked, 'file');
    } catch (error) {
      skipUnsupportedLink(error, context);
      return;
    }
    assertInvalid(() =>
      loadAndVerifyPublicLaunchAuthorityDecisionWithTestRegistry(linked, verificationOptions()),
    );
  });
});

test('rejects every linked intermediate path, including a Windows directory junction', (context) => {
  withTemporaryDirectory((directory) => {
    const targetDirectory = join(directory, 'target-directory');
    const linkedDirectory = join(directory, 'linked-directory');
    mkdirSync(targetDirectory);
    writeFileSync(join(targetDirectory, 'decision.json'), bytes(), { flag: 'wx' });
    try {
      symlinkSync(
        targetDirectory,
        linkedDirectory,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      skipUnsupportedLink(error, context);
      return;
    }
    assertInvalid(() =>
      loadAndVerifyPublicLaunchAuthorityDecisionWithTestRegistry(
        join(linkedDirectory, 'decision.json'),
        verificationOptions(),
      ),
    );
  });
});

test('rejects multi-link final files when the filesystem reports link counts', (context) => {
  withTemporaryDirectory((directory) => {
    const original = join(directory, 'original.json');
    const linked = join(directory, 'hard-linked.json');
    writeFileSync(original, bytes(), { flag: 'wx' });
    try {
      linkSync(original, linked);
    } catch (error) {
      skipUnsupportedLink(error, context);
      return;
    }
    assertInvalid(() =>
      loadAndVerifyPublicLaunchAuthorityDecisionWithTestRegistry(linked, verificationOptions()),
    );
  });
});
