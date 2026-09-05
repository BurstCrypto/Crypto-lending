import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from 'node:crypto';
import {
  closeSync,
  constants as fileConstants,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  readSync,
  type BigIntStats,
} from 'node:fs';
import { join, normalize, parse, resolve } from 'node:path';
import { TextDecoder } from 'node:util';

export const PUBLIC_LAUNCH_AUTHORITY_DECISION_SCHEMA_VERSION = 1 as const;
export const MAX_PUBLIC_LAUNCH_AUTHORITY_DECISION_BYTES = 131_072 as const;
export const MAX_PUBLIC_LAUNCH_DECISION_VALIDITY_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_PUBLIC_LAUNCH_AUTHORITY_KEY_VALIDITY_MILLISECONDS = 400 * 24 * 60 * 60 * 1_000;
export const PUBLIC_LAUNCH_AUTHORITY_SCOPE = 'PUBLIC_MAINNET_LAUNCH' as const;

export const PUBLIC_LAUNCH_AUTHORITY_ROLES = Object.freeze([
  'LEGAL_PUBLIC_LAUNCH_APPROVER',
  'REGULATORY_COMPLIANCE_APPROVER',
  'PRIVACY_APPROVER',
  'OPERATIONS_ACCEPTANCE_APPROVER',
  'INDEPENDENT_SECURITY_APPROVER',
  'DEPENDENCY_RISK_APPROVER',
  'DEPLOYMENT_OWNER',
] as const);

export type PublicLaunchAuthorityRole = (typeof PUBLIC_LAUNCH_AUTHORITY_ROLES)[number];
export type PublicLaunchAuthorityScope = typeof PUBLIC_LAUNCH_AUTHORITY_SCOPE;

const SIGNING_DOMAIN = 'crypto-lending:public-launch-authority-decision:v1' as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const KEY_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const TARGET_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const SAFE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,191}$/u;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const MAX_AUTHORITY_KEYS = 64;

const ROOT_KEYS = Object.freeze([
  'schemaVersion',
  'artifactType',
  'releaseCandidateManifestSha256',
  'deploymentTargetId',
  'deploymentTargetConfigurationSha256',
  'decisions',
]);
const BINDING_KEYS = Object.freeze([
  'releaseCandidateManifestSha256',
  'deploymentTargetId',
  'deploymentTargetConfigurationSha256',
]);
const DECISION_KEYS = Object.freeze([
  'role',
  'scope',
  'authorityKeyId',
  'decision',
  'approvedAt',
  'expiresAt',
  'approvalReferenceId',
  'signature',
]);
const UNSIGNED_DECISION_KEYS = Object.freeze([
  'role',
  'scope',
  'authorityKeyId',
  'decision',
  'approvedAt',
  'expiresAt',
  'approvalReferenceId',
]);
const SIGNATURE_KEYS = Object.freeze(['algorithm', 'valueBase64']);
const REGISTRY_KEYS = Object.freeze(['schemaVersion', 'artifactType', 'keys']);
const AUTHORITY_KEY_KEYS = Object.freeze([
  'keyId',
  'role',
  'scope',
  'algorithm',
  'status',
  'publicKeySpkiDerBase64',
  'validFrom',
  'validUntil',
  'approvalReferenceId',
]);
const VERIFY_OPTION_KEYS = Object.freeze([
  'evaluatedAt',
  'releaseCandidateManifestSha256',
  'deploymentTargetId',
  'deploymentTargetConfigurationSha256',
]);
const VERIFIED_DECISION_SETS = new WeakMap<object, Readonly<{ verifiedAtMilliseconds: number }>>();

export interface PublicLaunchAuthorityKey {
  readonly keyId: string;
  readonly role: PublicLaunchAuthorityRole;
  readonly scope: PublicLaunchAuthorityScope;
  readonly algorithm: 'Ed25519';
  readonly status: 'APPROVED';
  readonly publicKeySpkiDerBase64: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly approvalReferenceId: string;
}

export interface PublicLaunchAuthorityKeyRegistry {
  readonly schemaVersion: 1;
  readonly artifactType: 'PUBLIC_LAUNCH_AUTHORITY_KEY_REGISTRY';
  readonly keys: readonly PublicLaunchAuthorityKey[];
}

/**
 * Production trust is intentionally empty. Adding any role key requires a
 * separately reviewed source change; a decision artifact cannot carry or
 * select its own trust anchor.
 */
export const PUBLIC_LAUNCH_AUTHORITY_KEY_REGISTRY = Object.freeze({
  schemaVersion: 1,
  artifactType: 'PUBLIC_LAUNCH_AUTHORITY_KEY_REGISTRY',
  keys: Object.freeze([]),
} as const satisfies PublicLaunchAuthorityKeyRegistry);

export interface PublicLaunchTargetBinding {
  readonly releaseCandidateManifestSha256: string;
  readonly deploymentTargetId: string;
  readonly deploymentTargetConfigurationSha256: string;
}

export interface UnsignedPublicLaunchAuthorityDecision {
  readonly role: PublicLaunchAuthorityRole;
  readonly scope: PublicLaunchAuthorityScope;
  readonly authorityKeyId: string;
  readonly decision: 'APPROVED';
  readonly approvedAt: string;
  readonly expiresAt: string;
  readonly approvalReferenceId: string;
}

export interface PublicLaunchAuthorityDecision extends UnsignedPublicLaunchAuthorityDecision {
  readonly signature: Readonly<{
    algorithm: 'Ed25519';
    valueBase64: string;
  }>;
}

export interface PublicLaunchAuthorityDecisionSet extends PublicLaunchTargetBinding {
  readonly schemaVersion: 1;
  readonly artifactType: 'PUBLIC_LAUNCH_AUTHORITY_DECISION_SET';
  readonly decisions: readonly PublicLaunchAuthorityDecision[];
}

export interface VerifiedPublicLaunchAuthorityDecisionSet extends PublicLaunchAuthorityDecisionSet {
  readonly signatureValidated: true;
  readonly authorityRegistrySha256: string;
  readonly decisionSetSha256: string;
  /** Earliest exclusive decision expiry across all seven roles. */
  readonly validUntil: string;
}

export type VerifyPublicLaunchAuthorityDecisionOptions = PublicLaunchTargetBinding;

export interface TestPublicLaunchAuthorityDecisionVerificationOptions extends VerifyPublicLaunchAuthorityDecisionOptions {
  readonly evaluatedAt: string;
  readonly authorityKeyRegistry: PublicLaunchAuthorityKeyRegistry;
}

interface TimedPublicLaunchAuthorityDecisionVerificationOptions extends VerifyPublicLaunchAuthorityDecisionOptions {
  readonly evaluatedAt: string;
}

export class PublicLaunchAuthorityDecisionInvalidError extends Error {
  readonly code = 'PUBLIC_LAUNCH_AUTHORITY_DECISION_INVALID' as const;

  constructor() {
    super('Public launch authority decision is invalid');
    this.name = 'PublicLaunchAuthorityDecisionInvalidError';
  }
}

function invalid(): never {
  throw new PublicLaunchAuthorityDecisionInvalidError();
}

function deepFreeze<const Value>(value: Value): Readonly<Value> {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function record(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return invalid();
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return invalid();
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return invalid();
  }
}

function strictArray(value: unknown, maximumLength = Number.MAX_SAFE_INTEGER): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    !lengthDescriptor ||
    !('value' in lengthDescriptor) ||
    lengthDescriptor.enumerable ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return invalid();
  }
  const length = lengthDescriptor.value as number;
  const keys = Reflect.ownKeys(descriptors);
  if (length > maximumLength || keys.length !== length + 1) return invalid();
  const elements: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !('value' in descriptor)) return invalid();
    elements.push(descriptor.value);
  }
  return elements;
}

function canonicalArray(value: unknown[], seen: Set<object>): string {
  return `[${strictArray(value)
    .map((element) => canonicalJson(element, seen))
    .join(',')}]`;
}

function canonicalObject(value: object, seen: Set<object>): string {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string')) return invalid();
  const stringKeys = (keys as string[]).sort();
  return `{${stringKeys
    .map((key) => {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return invalid();
      return `${JSON.stringify(key)}:${canonicalJson(descriptor.value, seen)}`;
    })
    .join(',')}}`;
}

function canonicalJson(value: unknown, seen: Set<object>): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return invalid();
    return JSON.stringify(value);
  }
  if (typeof value !== 'object' || seen.has(value)) return invalid();
  seen.add(value);
  try {
    return Array.isArray(value) ? canonicalArray(value, seen) : canonicalObject(value, seen);
  } finally {
    seen.delete(value);
  }
}

export function canonicalPublicLaunchAuthorityJson(value: unknown): string {
  try {
    return canonicalJson(value, new Set<object>());
  } catch {
    return invalid();
  }
}

interface ParsedTimestamp {
  readonly text: string;
  readonly milliseconds: number;
}

function timestamp(value: unknown): ParsedTimestamp {
  if (typeof value !== 'string') return invalid();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return invalid();
  }
  return Object.freeze({ text: value, milliseconds });
}

function sha256(value: unknown): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) return invalid();
  return value;
}

function targetId(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || !TARGET_ID_PATTERN.test(value)) {
    return invalid();
  }
  return value;
}

function keyId(value: unknown): string {
  if (typeof value !== 'string' || value.length > 96 || !KEY_ID_PATTERN.test(value)) {
    return invalid();
  }
  return value;
}

function safeReference(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE_PATTERN.test(value)) return invalid();
  return value;
}

function role(value: unknown): PublicLaunchAuthorityRole {
  if (!PUBLIC_LAUNCH_AUTHORITY_ROLES.some((candidate) => candidate === value)) return invalid();
  return value as PublicLaunchAuthorityRole;
}

function canonicalBase64(value: unknown, expectedBytes?: number): Buffer {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    value.length % 4 !== 0 ||
    !BASE64_PATTERN.test(value)
  ) {
    return invalid();
  }
  const bytes = Buffer.from(value, 'base64');
  if (
    bytes.toString('base64') !== value ||
    (expectedBytes !== undefined && bytes.length !== expectedBytes)
  ) {
    return invalid();
  }
  return bytes;
}

function publicKey(value: unknown): Readonly<{ key: KeyObject; canonicalDerBase64: string }> {
  const der = canonicalBase64(value);
  let key: KeyObject;
  try {
    key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    return invalid();
  }
  if (key.asymmetricKeyType !== 'ed25519') return invalid();
  const exported = key.export({ format: 'der', type: 'spki' });
  if (!Buffer.isBuffer(exported) || !exported.equals(der)) return invalid();
  return Object.freeze({ key, canonicalDerBase64: der.toString('base64') });
}

function binding(value: unknown): PublicLaunchTargetBinding {
  const parsed = record(value, BINDING_KEYS);
  return Object.freeze({
    releaseCandidateManifestSha256: sha256(parsed.releaseCandidateManifestSha256),
    deploymentTargetId: targetId(parsed.deploymentTargetId),
    deploymentTargetConfigurationSha256: sha256(parsed.deploymentTargetConfigurationSha256),
  });
}

interface ParsedUnsignedDecision extends UnsignedPublicLaunchAuthorityDecision {
  readonly approvedAtTimestamp: ParsedTimestamp;
  readonly expiresAtTimestamp: ParsedTimestamp;
}

function unsignedDecision(value: unknown): ParsedUnsignedDecision {
  const parsed = record(value, UNSIGNED_DECISION_KEYS);
  if (parsed.decision !== 'APPROVED') return invalid();
  const approvedAt = timestamp(parsed.approvedAt);
  const expiresAt = timestamp(parsed.expiresAt);
  if (
    expiresAt.milliseconds <= approvedAt.milliseconds ||
    expiresAt.milliseconds - approvedAt.milliseconds >
      MAX_PUBLIC_LAUNCH_DECISION_VALIDITY_MILLISECONDS
  ) {
    return invalid();
  }
  return Object.freeze({
    role: role(parsed.role),
    scope:
      parsed.scope === PUBLIC_LAUNCH_AUTHORITY_SCOPE ? PUBLIC_LAUNCH_AUTHORITY_SCOPE : invalid(),
    authorityKeyId: keyId(parsed.authorityKeyId),
    decision: 'APPROVED',
    approvedAt: approvedAt.text,
    expiresAt: expiresAt.text,
    approvalReferenceId: safeReference(parsed.approvalReferenceId),
    approvedAtTimestamp: approvedAt,
    expiresAtTimestamp: expiresAt,
  });
}

function unsignedDecisionValue(
  parsed: ParsedUnsignedDecision,
): UnsignedPublicLaunchAuthorityDecision {
  return Object.freeze({
    role: parsed.role,
    scope: parsed.scope,
    authorityKeyId: parsed.authorityKeyId,
    decision: 'APPROVED',
    approvedAt: parsed.approvedAt,
    expiresAt: parsed.expiresAt,
    approvalReferenceId: parsed.approvalReferenceId,
  });
}

export function publicLaunchAuthorityDecisionSigningBytes(
  targetBinding: PublicLaunchTargetBinding,
  decision: UnsignedPublicLaunchAuthorityDecision,
): Buffer {
  try {
    const validatedBinding = binding(targetBinding);
    const validatedDecision = unsignedDecision(decision);
    return Buffer.from(
      `${SIGNING_DOMAIN}\n${canonicalPublicLaunchAuthorityJson({
        schemaVersion: PUBLIC_LAUNCH_AUTHORITY_DECISION_SCHEMA_VERSION,
        artifactType: 'PUBLIC_LAUNCH_AUTHORITY_DECISION',
        ...validatedBinding,
        ...unsignedDecisionValue(validatedDecision),
      })}`,
      'utf8',
    );
  } catch {
    return invalid();
  }
}

interface ParsedAuthorityKey {
  readonly keyId: string;
  readonly role: PublicLaunchAuthorityRole;
  readonly scope: PublicLaunchAuthorityScope;
  readonly publicKey: KeyObject;
  readonly validFrom: ParsedTimestamp;
  readonly validUntil: ParsedTimestamp;
}

function authorityRegistry(value: unknown): Readonly<{
  registrySha256: string;
  keys: readonly ParsedAuthorityKey[];
}> {
  const parsed = record(value, REGISTRY_KEYS);
  if (
    parsed.schemaVersion !== 1 ||
    parsed.artifactType !== 'PUBLIC_LAUNCH_AUTHORITY_KEY_REGISTRY' ||
    !Array.isArray(parsed.keys)
  ) {
    return invalid();
  }
  const registryKeys = strictArray(parsed.keys, MAX_AUTHORITY_KEYS);
  const ids = new Set<string>();
  const publicKeys = new Set<string>();
  let previousKeyId: string | null = null;
  const keys = registryKeys.map((candidate) => {
    const parsedKey = record(candidate, AUTHORITY_KEY_KEYS);
    const parsedKeyId = keyId(parsedKey.keyId);
    if (
      ids.has(parsedKeyId) ||
      (previousKeyId !== null && previousKeyId >= parsedKeyId) ||
      parsedKey.algorithm !== 'Ed25519' ||
      parsedKey.status !== 'APPROVED' ||
      parsedKey.scope !== PUBLIC_LAUNCH_AUTHORITY_SCOPE
    ) {
      return invalid();
    }
    const validFrom = timestamp(parsedKey.validFrom);
    const validUntil = timestamp(parsedKey.validUntil);
    if (
      validUntil.milliseconds <= validFrom.milliseconds ||
      validUntil.milliseconds - validFrom.milliseconds >
        MAX_PUBLIC_LAUNCH_AUTHORITY_KEY_VALIDITY_MILLISECONDS
    ) {
      return invalid();
    }
    safeReference(parsedKey.approvalReferenceId);
    const parsedPublicKey = publicKey(parsedKey.publicKeySpkiDerBase64);
    if (publicKeys.has(parsedPublicKey.canonicalDerBase64)) return invalid();
    ids.add(parsedKeyId);
    publicKeys.add(parsedPublicKey.canonicalDerBase64);
    previousKeyId = parsedKeyId;
    return Object.freeze({
      keyId: parsedKeyId,
      role: role(parsedKey.role),
      scope: PUBLIC_LAUNCH_AUTHORITY_SCOPE,
      publicKey: parsedPublicKey.key,
      validFrom,
      validUntil,
    });
  });
  return Object.freeze({
    registrySha256: createHash('sha256')
      .update(canonicalPublicLaunchAuthorityJson(value), 'utf8')
      .digest('hex'),
    keys: Object.freeze(keys),
  });
}

function verificationOptions(value: unknown): Readonly<{
  evaluatedAt: ParsedTimestamp;
  binding: PublicLaunchTargetBinding;
}> {
  const parsed = record(value, VERIFY_OPTION_KEYS);
  return Object.freeze({
    evaluatedAt: timestamp(parsed.evaluatedAt),
    binding: binding({
      releaseCandidateManifestSha256: parsed.releaseCandidateManifestSha256,
      deploymentTargetId: parsed.deploymentTargetId,
      deploymentTargetConfigurationSha256: parsed.deploymentTargetConfigurationSha256,
    }),
  });
}

function parsedDecision(
  value: unknown,
  expectedRole: PublicLaunchAuthorityRole,
  targetBinding: PublicLaunchTargetBinding,
  evaluatedAt: ParsedTimestamp,
  registry: readonly ParsedAuthorityKey[],
  usedKeyIds: Set<string>,
): PublicLaunchAuthorityDecision {
  const parsed = record(value, DECISION_KEYS);
  const unsigned = unsignedDecision({
    role: parsed.role,
    scope: parsed.scope,
    authorityKeyId: parsed.authorityKeyId,
    decision: parsed.decision,
    approvedAt: parsed.approvedAt,
    expiresAt: parsed.expiresAt,
    approvalReferenceId: parsed.approvalReferenceId,
  });
  if (
    unsigned.role !== expectedRole ||
    usedKeyIds.has(unsigned.authorityKeyId) ||
    unsigned.approvedAtTimestamp.milliseconds > evaluatedAt.milliseconds ||
    evaluatedAt.milliseconds >= unsigned.expiresAtTimestamp.milliseconds
  ) {
    return invalid();
  }
  const authority = registry.find(({ keyId: candidate }) => candidate === unsigned.authorityKeyId);
  if (
    authority === undefined ||
    authority.role !== expectedRole ||
    authority.scope !== PUBLIC_LAUNCH_AUTHORITY_SCOPE ||
    unsigned.approvedAtTimestamp.milliseconds < authority.validFrom.milliseconds ||
    unsigned.expiresAtTimestamp.milliseconds > authority.validUntil.milliseconds
  ) {
    return invalid();
  }
  const signature = record(parsed.signature, SIGNATURE_KEYS);
  if (signature.algorithm !== 'Ed25519') return invalid();
  const signatureBytes = canonicalBase64(signature.valueBase64, 64);
  if (
    !verifySignature(
      null,
      publicLaunchAuthorityDecisionSigningBytes(targetBinding, unsignedDecisionValue(unsigned)),
      authority.publicKey,
      signatureBytes,
    )
  ) {
    return invalid();
  }
  usedKeyIds.add(unsigned.authorityKeyId);
  return deepFreeze({
    ...unsignedDecisionValue(unsigned),
    signature: Object.freeze({
      algorithm: 'Ed25519' as const,
      valueBase64: signatureBytes.toString('base64'),
    }),
  });
}

function verifyBytesAgainstRegistry(
  bytes: Uint8Array,
  optionsValue: TimedPublicLaunchAuthorityDecisionVerificationOptions,
  registryValue: PublicLaunchAuthorityKeyRegistry,
): VerifiedPublicLaunchAuthorityDecisionSet {
  try {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength === 0 ||
      bytes.byteLength > MAX_PUBLIC_LAUNCH_AUTHORITY_DECISION_BYTES ||
      (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    ) {
      return invalid();
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\u0000')) return invalid();
    const parsedValue = JSON.parse(text) as unknown;
    if (canonicalPublicLaunchAuthorityJson(parsedValue) !== text) return invalid();
    const parsed = record(parsedValue, ROOT_KEYS);
    if (
      parsed.schemaVersion !== PUBLIC_LAUNCH_AUTHORITY_DECISION_SCHEMA_VERSION ||
      parsed.artifactType !== 'PUBLIC_LAUNCH_AUTHORITY_DECISION_SET' ||
      !Array.isArray(parsed.decisions)
    ) {
      return invalid();
    }
    const decisionValues = strictArray(parsed.decisions, PUBLIC_LAUNCH_AUTHORITY_ROLES.length);
    if (decisionValues.length !== PUBLIC_LAUNCH_AUTHORITY_ROLES.length) return invalid();
    const options = verificationOptions(optionsValue);
    const parsedBinding = binding({
      releaseCandidateManifestSha256: parsed.releaseCandidateManifestSha256,
      deploymentTargetId: parsed.deploymentTargetId,
      deploymentTargetConfigurationSha256: parsed.deploymentTargetConfigurationSha256,
    });
    if (
      parsedBinding.releaseCandidateManifestSha256 !==
        options.binding.releaseCandidateManifestSha256 ||
      parsedBinding.deploymentTargetId !== options.binding.deploymentTargetId ||
      parsedBinding.deploymentTargetConfigurationSha256 !==
        options.binding.deploymentTargetConfigurationSha256
    ) {
      return invalid();
    }
    const registry = authorityRegistry(registryValue);
    const usedKeyIds = new Set<string>();
    const decisions = decisionValues.map((candidate, index) => {
      const expectedRole = PUBLIC_LAUNCH_AUTHORITY_ROLES[index];
      if (expectedRole === undefined) return invalid();
      return parsedDecision(
        candidate,
        expectedRole,
        parsedBinding,
        options.evaluatedAt,
        registry.keys,
        usedKeyIds,
      );
    });
    const firstDecision = decisions[0] ?? invalid();
    const validUntil = decisions.reduce(
      (earliest, decision) => (decision.expiresAt < earliest ? decision.expiresAt : earliest),
      firstDecision.expiresAt,
    );
    return deepFreeze({
      schemaVersion: PUBLIC_LAUNCH_AUTHORITY_DECISION_SCHEMA_VERSION,
      artifactType: 'PUBLIC_LAUNCH_AUTHORITY_DECISION_SET' as const,
      ...parsedBinding,
      decisions: Object.freeze(decisions),
      signatureValidated: true as const,
      authorityRegistrySha256: registry.registrySha256,
      decisionSetSha256: createHash('sha256').update(bytes).digest('hex'),
      validUntil,
    });
  } catch {
    return invalid();
  }
}

/** Test-only trust seam. Values returned here are deliberately not branded. */
export function verifyPublicLaunchAuthorityDecisionBytesWithTestRegistry(
  bytes: Uint8Array,
  options: TestPublicLaunchAuthorityDecisionVerificationOptions,
): VerifiedPublicLaunchAuthorityDecisionSet {
  try {
    const parsed = record(options, [...VERIFY_OPTION_KEYS, 'authorityKeyRegistry']);
    return verifyBytesAgainstRegistry(
      bytes,
      {
        evaluatedAt: parsed.evaluatedAt as string,
        releaseCandidateManifestSha256: parsed.releaseCandidateManifestSha256 as string,
        deploymentTargetId: parsed.deploymentTargetId as string,
        deploymentTargetConfigurationSha256: parsed.deploymentTargetConfigurationSha256 as string,
      },
      parsed.authorityKeyRegistry as PublicLaunchAuthorityKeyRegistry,
    );
  } catch {
    return invalid();
  }
}

export function parseAndVerifyPublicLaunchAuthorityDecisionBytes(
  bytes: Uint8Array,
  options: VerifyPublicLaunchAuthorityDecisionOptions,
): VerifiedPublicLaunchAuthorityDecisionSet {
  const evaluatedAt = new Date().toISOString();
  const verified = verifyBytesAgainstRegistry(
    bytes,
    { ...options, evaluatedAt },
    PUBLIC_LAUNCH_AUTHORITY_KEY_REGISTRY,
  );
  VERIFIED_DECISION_SETS.set(
    verified,
    Object.freeze({ verifiedAtMilliseconds: Date.parse(evaluatedAt) }),
  );
  return verified;
}

export function isVerifiedPublicLaunchAuthorityDecisionSet(
  value: unknown,
): value is VerifiedPublicLaunchAuthorityDecisionSet {
  if (typeof value !== 'object' || value === null) return false;
  const metadata = VERIFIED_DECISION_SETS.get(value);
  if (metadata === undefined) return false;
  const now = Date.now();
  return (
    now >= metadata.verifiedAtMilliseconds &&
    now < Date.parse((value as VerifiedPublicLaunchAuthorityDecisionSet).validUntil)
  );
}

export function revalidatePublicLaunchAuthorityDecisionForApplication(
  decisionSet: VerifiedPublicLaunchAuthorityDecisionSet,
  expectedBinding: PublicLaunchTargetBinding,
): void {
  try {
    const metadata = VERIFIED_DECISION_SETS.get(decisionSet);
    if (metadata === undefined) return invalid();
    const evaluatedAt = new Date().toISOString();
    if (Date.parse(evaluatedAt) < metadata.verifiedAtMilliseconds) return invalid();
    const reverified = verifyBytesAgainstRegistry(
      Buffer.from(
        canonicalPublicLaunchAuthorityJson({
          schemaVersion: decisionSet.schemaVersion,
          artifactType: decisionSet.artifactType,
          releaseCandidateManifestSha256: decisionSet.releaseCandidateManifestSha256,
          deploymentTargetId: decisionSet.deploymentTargetId,
          deploymentTargetConfigurationSha256: decisionSet.deploymentTargetConfigurationSha256,
          decisions: decisionSet.decisions,
        }),
        'utf8',
      ),
      { ...binding(expectedBinding), evaluatedAt },
      PUBLIC_LAUNCH_AUTHORITY_KEY_REGISTRY,
    );
    if (reverified.decisionSetSha256 !== decisionSet.decisionSetSha256) return invalid();
  } catch {
    return invalid();
  }
}

function sameStableFile(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.isFile() &&
    right.isFile() &&
    left.nlink === 1n &&
    right.nlink === 1n &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.birthtimeNs === right.birthtimeNs
  );
}

function closeStableFileDescriptor(descriptor: number): void {
  try {
    closeSync(descriptor);
  } catch {
    return invalid();
  }
}

/** Descriptor-close test seam; it cannot read or confer launch authority. */
export function closePublicLaunchAuthorityFileDescriptorForTest(descriptor: number): void {
  closeStableFileDescriptor(descriptor);
}

function comparablePath(value: string): string {
  let path = normalize(value);
  if (path.startsWith('\\\\?\\UNC\\')) path = `\\\\${path.slice(8)}`;
  else if (path.startsWith('\\\\?\\')) path = path.slice(4);
  path = path.replace(/[\\/]+$/u, '');
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

function assertNoLinkedPathComponents(absolutePath: string): void {
  const root = parse(absolutePath).root;
  const remainder = absolutePath.slice(root.length);
  const components = remainder.split(/[\\/]+/u).filter((component) => component.length > 0);
  if (components.length === 0) return invalid();
  let current = root;
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component === undefined) return invalid();
    current = join(current, component);
    const status = lstatSync(current);
    const final = index === components.length - 1;
    if (status.isSymbolicLink() || (!final && !status.isDirectory())) return invalid();
    const canonical = realpathSync.native(current);
    if (comparablePath(canonical) !== comparablePath(current)) return invalid();
  }
}

function readDescriptorExactly(descriptor: number, size: number): Buffer {
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(descriptor, bytes, offset, size - offset, offset);
    if (count <= 0) return invalid();
    offset += count;
  }
  const overflow = Buffer.allocUnsafe(1);
  if (readSync(descriptor, overflow, 0, 1, size) !== 0) return invalid();
  return bytes;
}

function readBoundedStableRegularFile(path: string, afterFirstReadForTest?: () => void): Buffer {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.length > 4_096 ||
    path.includes('\u0000')
  ) {
    return invalid();
  }
  const absolutePath = resolve(path);
  let descriptor: number | undefined;
  try {
    assertNoLinkedPathComponents(absolutePath);
    const before = lstatSync(absolutePath, { bigint: true });
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size <= 0n ||
      before.size > BigInt(MAX_PUBLIC_LAUNCH_AUTHORITY_DECISION_BYTES)
    ) {
      return invalid();
    }
    descriptor = openSync(absolutePath, fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!sameStableFile(before, opened)) return invalid();
    const size = Number(opened.size);
    const first = readDescriptorExactly(descriptor, size);
    afterFirstReadForTest?.();
    const afterFirst = fstatSync(descriptor, { bigint: true });
    if (!sameStableFile(opened, afterFirst)) return invalid();
    const second = readDescriptorExactly(descriptor, size);
    const afterSecond = fstatSync(descriptor, { bigint: true });
    assertNoLinkedPathComponents(absolutePath);
    const finalPath = lstatSync(absolutePath, { bigint: true });
    if (
      finalPath.isSymbolicLink() ||
      !sameStableFile(opened, afterSecond) ||
      !sameStableFile(afterSecond, finalPath) ||
      !first.equals(second)
    ) {
      return invalid();
    }
    return first;
  } catch {
    return invalid();
  } finally {
    if (descriptor !== undefined) closeStableFileDescriptor(descriptor);
  }
}

export function loadAndVerifyPublicLaunchAuthorityDecision(
  path: string,
  options: VerifyPublicLaunchAuthorityDecisionOptions,
): VerifiedPublicLaunchAuthorityDecisionSet {
  try {
    return parseAndVerifyPublicLaunchAuthorityDecisionBytes(
      readBoundedStableRegularFile(path),
      options,
    );
  } catch {
    return invalid();
  }
}

/** File-boundary test seam. Its result is never production-branded. */
export function loadAndVerifyPublicLaunchAuthorityDecisionWithTestRegistry(
  path: string,
  options: TestPublicLaunchAuthorityDecisionVerificationOptions,
  afterFirstReadForTest?: () => void,
): VerifiedPublicLaunchAuthorityDecisionSet {
  try {
    return verifyPublicLaunchAuthorityDecisionBytesWithTestRegistry(
      readBoundedStableRegularFile(path, afterFirstReadForTest),
      options,
    );
  } catch {
    return invalid();
  }
}
