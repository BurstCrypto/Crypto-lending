#!/usr/bin/env node

/**
 * Offline validation for production infrastructure deployment intents.
 * This module has no cloud, network, subprocess, credential-read, mutation, or
 * deployment capability. A verified intent is only an input to a future,
 * separately reviewed durable reservation/CAS protocol; executionAllowed is
 * always false here. A matching predecessor is only a caller-expected binding;
 * it is not a durable chain-head observation.
 */

import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { TextDecoder, types as utilTypes } from 'node:util';

import { parseStrictJsonBytes } from '../shared/parse-strict-json.mjs';
import { readSecureLocalFile } from '../shared/read-secure-local-file.mjs';
import { validateEd25519PublicKeyBytes } from '../shared/validate-ed25519-public-key.mjs';
import {
  isVerifiedProductionDeploymentDestination,
  resolveProductionDeploymentDestination,
  resolveProductionDeploymentDestinationWithTestRegistry,
} from '../../scripts/production-deployment-target.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = resolve(scriptDirectory, '..', '..');
export const LOCAL_PRODUCTION_DEPLOYMENT_INTENT_ROOT = join(REPOSITORY_ROOT, '.local-validation');
export const DEFAULT_PRODUCTION_DEPLOYMENT_INTENT_EXAMPLE = join(
  scriptDirectory,
  'production-deployment-intent.example.json',
);
export const MAX_PRODUCTION_DEPLOYMENT_INTENT_BYTES = 131_072;

export const PRODUCTION_DEPLOYMENT_INTENT_OPERATIONS = Object.freeze([
  'PROVISION_INERT',
  'ABORT_PROVISION',
  'ACTIVATE_READ_ONLY',
  'UPDATE_READ_ONLY',
  'ROLLBACK',
  'EMERGENCY_KILL',
  'DELETE',
]);
export const PRODUCTION_DEPLOYMENT_LIFECYCLE_STATES = Object.freeze([
  'ABSENT',
  'INERT_DEPLOYED',
  'READ_ONLY_ACTIVE',
  'KILLED_INERT',
  'DELETED',
  'PROVISION_ABORTED',
]);
export const PRODUCTION_DEPLOYMENT_INTENT_SIGNER_ROLES = Object.freeze([
  'DEPLOYMENT_OWNER',
  'INDEPENDENT_SECURITY',
]);
export const PRODUCTION_DEPLOYMENT_INTENT_SCOPE = 'PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_INTENT_V2';

const SIGNING_DOMAIN = 'crypto-lending:production-deployment-intent-signature:v2';
const INTENT_HASH_DOMAIN = 'crypto-lending:production-deployment-intent:v2';
const AUTHORITY_STATE_HASH_DOMAIN = 'crypto-lending:production-deployment-authority-state:v2';
const DEPLOYMENT_STATE_HASH_DOMAIN = 'crypto-lending:production-deployment-state:v2';
const CHAIN_GENESIS_HASH_DOMAIN = 'crypto-lending:production-deployment-chain-genesis:v1';
const AUTHORITY_REGISTRY_HASH_DOMAIN =
  'crypto-lending:production-deployment-intent-authority-registry:v2';
const MAX_INTENT_VALIDITY_MILLISECONDS = 60 * 60 * 1_000;
const MAX_KEY_VALIDITY_MILLISECONDS = 400 * 24 * 60 * 60 * 1_000;
const MAX_AUTHORITY_KEYS = 16;
const MAX_DESIRED_COUNT = 64;
const MAX_KEY_ID_LENGTH = 128;
const ZERO_SHA256 = '0'.repeat(64);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_REVISION_PATTERN = /^[a-f0-9]{40}$/u;
const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/u;
const KEY_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z]+-[1-9][0-9]?$/u;
const STACK_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,127}$/u;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,191}$/u;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ETHEREUM_MAINNET_ID = 'eip155:1';
const SOLANA_MAINNET_ID = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const READ_TRUSTED_TIME_MILLISECONDS = Date.now.bind(Date);
const READ_MONOTONIC_TIME_MILLISECONDS = performance.now.bind(performance);

const VERIFICATION_BINDING_KEYS = Object.freeze([
  'expectedOperation',
  'expectedSequence',
  'expectedIntentSha256',
  'expectedDestinationId',
  'expectedDestinationSha256',
  'expectedDestinationEpochId',
  'expectedDestinationRegistrySha256',
  'expectedPublicOrigin',
  'expectedPredecessorSequence',
  'expectedPredecessorCommittedHeadSha256',
  'expectedPredecessorIntentSha256',
  'expectedPredecessorReservationSha256',
  'expectedPredecessorResultSha256',
  'expectedAbortedProvisionIntentSha256',
  'expectedAbortedProvisionReservationSha256',
  'expectedSourceRevision',
  'expectedReleaseCandidateManifestSha256',
  'expectedInfrastructureContractSha256',
  'expectedInfrastructureTemplateSha256',
  'expectedDeploymentConfigurationSha256',
  'expectedBillingControlSha256',
  'expectedEgressPolicySha256',
  'expectedCredentialStateSha256',
  'expectedCurrentStateSha256',
  'expectedProposedStateSha256',
  'expectedRollbackPlanSha256',
  'expectedKillStateSha256',
  'expectedAccountId',
  'expectedRegion',
  'expectedStackName',
  'expectedChangeSetName',
]);

const EXACT_KEYS = Object.freeze({
  root: ['schemaVersion', 'artifactType', 'intentSha256', 'content', 'signatures'],
  unsignedRoot: ['schemaVersion', 'artifactType', 'intentSha256', 'content'],
  content: [
    'status',
    'intentId',
    'operation',
    'sequence',
    'issuedAt',
    'expiresAt',
    'destinationBinding',
    'deployment',
    'sourceRevision',
    'releaseCandidateManifestSha256',
    'bindings',
    'predecessor',
    'currentState',
    'proposedState',
  ],
  destinationBinding: [
    'destinationId',
    'destinationSha256',
    'epochId',
    'destinationRegistrySha256',
    'environment',
    'accountId',
    'region',
    'stackName',
    'publicOrigin',
  ],
  deployment: ['accountId', 'region', 'stackName', 'changeSetName'],
  bindings: [
    'infrastructureContractSha256',
    'infrastructureTemplateSha256',
    'deploymentConfigurationSha256',
    'billingControlSha256',
    'egressPolicySha256',
    'credentialStateSha256',
    'currentStateSha256',
    'proposedStateSha256',
    'rollbackPlanSha256',
    'killStateSha256',
    'abortedProvisionIntentSha256',
    'abortedProvisionReservationSha256',
  ],
  predecessor: [
    'sequence',
    'committedHeadSha256',
    'intentSha256',
    'reservationSha256',
    'resultSha256',
    'stateSha256',
  ],
  deploymentState: ['lifecycle', 'authority'],
  authority: [
    'apiDesiredCount',
    'webDesiredCount',
    'outboxWorkerDesiredCount',
    'balanceConsumerDesiredCount',
    'migrationTaskEnabled',
    'publicIngressEnabled',
    'externalEgressMode',
    'allowedNetworkIds',
    'financialWritesEnabled',
  ],
  signature: ['role', 'scope', 'authorityKeyId', 'signedAt', 'algorithm', 'valueBase64'],
  signer: ['role', 'scope', 'authorityKeyId', 'signedAt'],
  registry: ['schemaVersion', 'artifactType', 'keys'],
  authorityKey: [
    'keyId',
    'role',
    'scope',
    'algorithm',
    'status',
    'publicKeySpkiDerBase64',
    'validFrom',
    'validUntil',
    'approvalReferenceId',
  ],
  productionOptions: VERIFICATION_BINDING_KEYS,
  testOptions: Object.freeze(['evaluatedAt', ...VERIFICATION_BINDING_KEYS]),
  testClockReading: ['wallTime', 'monotonicMilliseconds'],
});

const ZERO_CALLS = Object.freeze({
  externalCallsMade: 0,
  cloudCallsMade: 0,
  networkCallsMade: 0,
  dnsQueriesMade: 0,
  subprocessesStarted: 0,
  credentialValuesRead: 0,
  resourcesCreated: 0,
  resourcesChanged: 0,
  filesWritten: 0,
});

export const PRODUCTION_DEPLOYMENT_INTENT_AUTHORITY_KEY_REGISTRY = Object.freeze({
  schemaVersion: 2,
  artifactType: 'PRODUCTION_DEPLOYMENT_INTENT_AUTHORITY_KEY_REGISTRY_V2',
  keys: Object.freeze([]),
});

const PRODUCTION_AUTHORIZED_REPORTS = new WeakMap();
const TEST_AUTHORIZED_REPORTS = new WeakMap();

export class ProductionDeploymentIntentInvalidError extends Error {
  constructor() {
    super('Production deployment intent is invalid');
    this.name = 'ProductionDeploymentIntentInvalidError';
  }
}

function invalid() {
  throw new ProductionDeploymentIntentInvalidError();
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function dataRecord(value, expectedKeys) {
  try {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      utilTypes.isProxy(value)
    ) {
      return invalid();
    }
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
    const snapshot = Object.create(null);
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return invalid();
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return invalid();
  }
}

function strictArray(value, maximumLength) {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      utilTypes.isProxy(value)
    ) {
      return invalid();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const lengthDescriptor = descriptors.length;
    if (
      !lengthDescriptor ||
      !('value' in lengthDescriptor) ||
      lengthDescriptor.enumerable ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maximumLength ||
      Reflect.ownKeys(descriptors).length !== lengthDescriptor.value + 1
    ) {
      return invalid();
    }
    const result = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !('value' in descriptor)) return invalid();
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return invalid();
  }
}

function canonicalValue(value, seen) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return invalid();
    return String(value);
  }
  if (typeof value !== 'object' || seen.has(value) || utilTypes.isProxy(value)) return invalid();
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${strictArray(value, 256)
        .map((entry) => canonicalValue(entry, seen))
        .join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) return invalid();
    return `{${keys
      .map((key) => key)
      .sort()
      .map((key) => {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !('value' in descriptor)) return invalid();
        return `${JSON.stringify(key)}:${canonicalValue(descriptor.value, seen)}`;
      })
      .join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

export function canonicalizeProductionDeploymentIntentValue(value) {
  try {
    return canonicalValue(value, new Set());
  } catch {
    return invalid();
  }
}

function domainHash(domain, value) {
  return createHash('sha256').update(`${domain}\n`, 'utf8').update(value, 'utf8').digest('hex');
}

function canonicalInstant(value) {
  if (typeof value !== 'string' || !INSTANT_PATTERN.test(value)) return invalid();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().replace('.000Z', 'Z') !== value) {
    return invalid();
  }
  return Object.freeze({ text: value, milliseconds: date.getTime() });
}

function trustedCurrentInstant() {
  try {
    const milliseconds = READ_TRUSTED_TIME_MILLISECONDS();
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return invalid();
    const date = new Date(milliseconds);
    if (!Number.isFinite(date.getTime()) || date.getTime() !== milliseconds) return invalid();
    return Object.freeze({ text: date.toISOString(), milliseconds });
  } catch {
    return invalid();
  }
}

function monotonicMilliseconds(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return invalid();
  return value;
}

function trustedClockReading() {
  try {
    // Pair conservatively: a pause before the wall read can only shorten the
    // monotonic lifetime derived from this sample, never extend it.
    const capturedMonotonicMilliseconds = monotonicMilliseconds(READ_MONOTONIC_TIME_MILLISECONDS());
    return Object.freeze({
      wall: trustedCurrentInstant(),
      monotonicMilliseconds: capturedMonotonicMilliseconds,
    });
  } catch {
    return invalid();
  }
}

function testClockReading(value) {
  const parsed = dataRecord(value, EXACT_KEYS.testClockReading);
  return Object.freeze({
    wall: canonicalInstant(parsed.wallTime),
    monotonicMilliseconds: monotonicMilliseconds(parsed.monotonicMilliseconds),
  });
}

function testClockSequence(value) {
  const readings = strictArray(value, 2).map((candidate) => testClockReading(candidate));
  if (readings.length !== 2) return invalid();
  let index = 0;
  return () => {
    const reading = readings[index];
    index += 1;
    return reading ?? invalid();
  };
}

function digest(value, allowGenesis = false) {
  if (
    typeof value !== 'string' ||
    !SHA256_PATTERN.test(value) ||
    (!allowGenesis && value === ZERO_SHA256)
  ) {
    return invalid();
  }
  return value;
}

function sourceRevision(value) {
  if (
    typeof value !== 'string' ||
    !SOURCE_REVISION_PATTERN.test(value) ||
    value === '0'.repeat(40)
  ) {
    return invalid();
  }
  return value;
}

function boundedIdentifier(value, maximumLength = 128) {
  if (
    typeof value !== 'string' ||
    value.length > maximumLength ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    return invalid();
  }
  return value;
}

function boundedCount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_DESIRED_COUNT) return invalid();
  return value;
}

function chainSequence(value, allowGenesis = false) {
  if (
    !Number.isSafeInteger(value) ||
    value < (allowGenesis ? 0 : 1) ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    return invalid();
  }
  return value;
}

function boolean(value) {
  return typeof value === 'boolean' ? value : invalid();
}

function operation(value) {
  if (!PRODUCTION_DEPLOYMENT_INTENT_OPERATIONS.includes(value)) return invalid();
  return value;
}

function lifecycle(value) {
  if (!PRODUCTION_DEPLOYMENT_LIFECYCLE_STATES.includes(value)) return invalid();
  return value;
}

function canonicalHttpsOrigin(value) {
  if (typeof value !== 'string' || value.length > 255) return invalid();
  let url;
  try {
    url = new URL(value);
  } catch {
    return invalid();
  }
  const labels = url.hostname.split('.');
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.hostname !== url.hostname.toLowerCase() ||
    labels.length < 2 ||
    labels.some(
      (label) =>
        label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    ) ||
    !/[a-z]/u.test(url.hostname) ||
    value !== url.origin
  ) {
    return invalid();
  }
  return value;
}

function destinationBinding(value) {
  const parsed = dataRecord(value, EXACT_KEYS.destinationBinding);
  if (
    parsed.environment !== 'production' ||
    typeof parsed.accountId !== 'string' ||
    !/^\d{12}$/u.test(parsed.accountId) ||
    parsed.accountId === '0'.repeat(12) ||
    typeof parsed.region !== 'string' ||
    !REGION_PATTERN.test(parsed.region) ||
    typeof parsed.stackName !== 'string' ||
    !STACK_NAME_PATTERN.test(parsed.stackName)
  ) {
    return invalid();
  }
  return Object.freeze({
    destinationId: boundedIdentifier(parsed.destinationId, 96),
    destinationSha256: digest(parsed.destinationSha256),
    epochId: digest(parsed.epochId),
    destinationRegistrySha256: digest(parsed.destinationRegistrySha256),
    environment: 'production',
    accountId: parsed.accountId,
    region: parsed.region,
    stackName: parsed.stackName,
    publicOrigin: canonicalHttpsOrigin(parsed.publicOrigin),
  });
}

export function productionDeploymentChainGenesisSha256(value) {
  try {
    const destination = destinationBinding(value);
    return domainHash(
      CHAIN_GENESIS_HASH_DOMAIN,
      canonicalizeProductionDeploymentIntentValue({
        destinationId: destination.destinationId,
        destinationSha256: destination.destinationSha256,
        epochId: destination.epochId,
        environment: destination.environment,
        accountId: destination.accountId,
        region: destination.region,
        stackName: destination.stackName,
        publicOrigin: destination.publicOrigin,
      }),
    );
  } catch {
    return invalid();
  }
}

function authorityState(value) {
  const parsed = dataRecord(value, EXACT_KEYS.authority);
  const externalEgressMode = parsed.externalEgressMode;
  if (
    externalEgressMode !== 'NO_EXTERNAL_EGRESS' &&
    externalEgressMode !== 'ETHEREUM_SOLANA_READ_ONLY'
  ) {
    return invalid();
  }
  const allowedNetworkIds = strictArray(parsed.allowedNetworkIds, 2);
  if (
    (externalEgressMode === 'NO_EXTERNAL_EGRESS' && allowedNetworkIds.length !== 0) ||
    (externalEgressMode === 'ETHEREUM_SOLANA_READ_ONLY' &&
      (allowedNetworkIds.length !== 2 ||
        allowedNetworkIds[0] !== ETHEREUM_MAINNET_ID ||
        allowedNetworkIds[1] !== SOLANA_MAINNET_ID))
  ) {
    return invalid();
  }
  return deepFreeze({
    apiDesiredCount: boundedCount(parsed.apiDesiredCount),
    webDesiredCount: boundedCount(parsed.webDesiredCount),
    outboxWorkerDesiredCount: boundedCount(parsed.outboxWorkerDesiredCount),
    balanceConsumerDesiredCount: boundedCount(parsed.balanceConsumerDesiredCount),
    migrationTaskEnabled: boolean(parsed.migrationTaskEnabled),
    publicIngressEnabled: boolean(parsed.publicIngressEnabled),
    externalEgressMode,
    allowedNetworkIds: Object.freeze([...allowedNetworkIds]),
    financialWritesEnabled: boolean(parsed.financialWritesEnabled),
  });
}

export function productionDeploymentAuthorityStateSha256(value) {
  try {
    return domainHash(
      AUTHORITY_STATE_HASH_DOMAIN,
      canonicalizeProductionDeploymentIntentValue(authorityState(value)),
    );
  } catch {
    return invalid();
  }
}

const INERT_AUTHORITY_STATE = deepFreeze({
  apiDesiredCount: 0,
  webDesiredCount: 0,
  outboxWorkerDesiredCount: 0,
  balanceConsumerDesiredCount: 0,
  migrationTaskEnabled: false,
  publicIngressEnabled: false,
  externalEgressMode: 'NO_EXTERNAL_EGRESS',
  allowedNetworkIds: Object.freeze([]),
  financialWritesEnabled: false,
});
function sameAuthorityState(left, right) {
  return (
    productionDeploymentAuthorityStateSha256(left) ===
    productionDeploymentAuthorityStateSha256(right)
  );
}

function deploymentState(value) {
  const parsed = dataRecord(value, EXACT_KEYS.deploymentState);
  const parsedLifecycle = lifecycle(parsed.lifecycle);
  const authority = authorityState(parsed.authority);
  const authorityIsInert = sameAuthorityState(authority, INERT_AUTHORITY_STATE);
  if (
    (parsedLifecycle === 'READ_ONLY_ACTIVE' &&
      (authorityIsInert ||
        authority.apiDesiredCount === 0 ||
        authority.webDesiredCount === 0 ||
        authority.migrationTaskEnabled ||
        !authority.publicIngressEnabled ||
        authority.externalEgressMode !== 'ETHEREUM_SOLANA_READ_ONLY' ||
        authority.financialWritesEnabled)) ||
    (parsedLifecycle !== 'READ_ONLY_ACTIVE' && !authorityIsInert)
  ) {
    return invalid();
  }
  return deepFreeze({ lifecycle: parsedLifecycle, authority });
}

export function productionDeploymentStateSha256(value) {
  try {
    return domainHash(
      DEPLOYMENT_STATE_HASH_DOMAIN,
      canonicalizeProductionDeploymentIntentValue(deploymentState(value)),
    );
  } catch {
    return invalid();
  }
}

const KILLED_INERT_STATE_SHA256 = productionDeploymentStateSha256({
  lifecycle: 'KILLED_INERT',
  authority: INERT_AUTHORITY_STATE,
});

function authorityDoesNotIncrease(current, proposed) {
  const egressRank = (mode) => (mode === 'NO_EXTERNAL_EGRESS' ? 0 : 1);
  return (
    proposed.apiDesiredCount <= current.apiDesiredCount &&
    proposed.webDesiredCount <= current.webDesiredCount &&
    proposed.outboxWorkerDesiredCount <= current.outboxWorkerDesiredCount &&
    proposed.balanceConsumerDesiredCount <= current.balanceConsumerDesiredCount &&
    (!proposed.migrationTaskEnabled || current.migrationTaskEnabled) &&
    (!proposed.publicIngressEnabled || current.publicIngressEnabled) &&
    egressRank(proposed.externalEgressMode) <= egressRank(current.externalEgressMode) &&
    (!proposed.financialWritesEnabled || current.financialWritesEnabled)
  );
}

function deployment(value) {
  const parsed = dataRecord(value, EXACT_KEYS.deployment);
  if (
    typeof parsed.accountId !== 'string' ||
    !/^\d{12}$/u.test(parsed.accountId) ||
    typeof parsed.region !== 'string' ||
    !REGION_PATTERN.test(parsed.region) ||
    typeof parsed.stackName !== 'string' ||
    !STACK_NAME_PATTERN.test(parsed.stackName) ||
    typeof parsed.changeSetName !== 'string' ||
    !STACK_NAME_PATTERN.test(parsed.changeSetName)
  ) {
    return invalid();
  }
  return Object.freeze({
    accountId: parsed.accountId,
    region: parsed.region,
    stackName: parsed.stackName,
    changeSetName: parsed.changeSetName,
  });
}

function bindings(value, currentState, proposedState) {
  const parsed = dataRecord(value, EXACT_KEYS.bindings);
  const snapshot = Object.freeze({
    infrastructureContractSha256: digest(parsed.infrastructureContractSha256),
    infrastructureTemplateSha256: digest(parsed.infrastructureTemplateSha256),
    deploymentConfigurationSha256: digest(parsed.deploymentConfigurationSha256),
    billingControlSha256: digest(parsed.billingControlSha256),
    egressPolicySha256: digest(parsed.egressPolicySha256),
    credentialStateSha256: digest(parsed.credentialStateSha256),
    currentStateSha256: digest(parsed.currentStateSha256),
    proposedStateSha256: digest(parsed.proposedStateSha256),
    rollbackPlanSha256: digest(parsed.rollbackPlanSha256),
    killStateSha256: digest(parsed.killStateSha256),
    abortedProvisionIntentSha256: digest(parsed.abortedProvisionIntentSha256, true),
    abortedProvisionReservationSha256: digest(parsed.abortedProvisionReservationSha256, true),
  });
  if (
    snapshot.currentStateSha256 !== productionDeploymentStateSha256(currentState) ||
    snapshot.proposedStateSha256 !== productionDeploymentStateSha256(proposedState) ||
    snapshot.killStateSha256 !== KILLED_INERT_STATE_SHA256
  ) {
    return invalid();
  }
  return snapshot;
}

function predecessor(value) {
  const parsed = dataRecord(value, EXACT_KEYS.predecessor);
  return Object.freeze({
    sequence: chainSequence(parsed.sequence, true),
    committedHeadSha256: digest(parsed.committedHeadSha256),
    intentSha256: digest(parsed.intentSha256, true),
    reservationSha256: digest(parsed.reservationSha256, true),
    resultSha256: digest(parsed.resultSha256, true),
    stateSha256: digest(parsed.stateSha256),
  });
}

const ALLOWED_LIFECYCLE_TRANSITIONS = Object.freeze({
  PROVISION_INERT: Object.freeze(['ABSENT', 'INERT_DEPLOYED']),
  ABORT_PROVISION: Object.freeze(['ABSENT', 'PROVISION_ABORTED']),
  ACTIVATE_READ_ONLY: Object.freeze([
    Object.freeze(['INERT_DEPLOYED', 'READ_ONLY_ACTIVE']),
    Object.freeze(['KILLED_INERT', 'READ_ONLY_ACTIVE']),
  ]),
  UPDATE_READ_ONLY: Object.freeze(['READ_ONLY_ACTIVE', 'READ_ONLY_ACTIVE']),
  ROLLBACK: Object.freeze([
    Object.freeze(['READ_ONLY_ACTIVE', 'READ_ONLY_ACTIVE']),
    Object.freeze(['READ_ONLY_ACTIVE', 'INERT_DEPLOYED']),
  ]),
  EMERGENCY_KILL: Object.freeze([
    Object.freeze(['INERT_DEPLOYED', 'KILLED_INERT']),
    Object.freeze(['READ_ONLY_ACTIVE', 'KILLED_INERT']),
  ]),
  DELETE: Object.freeze([
    Object.freeze(['INERT_DEPLOYED', 'DELETED']),
    Object.freeze(['KILLED_INERT', 'DELETED']),
  ]),
});

function lifecycleTransitionAllowed(parsedOperation, currentLifecycle, proposedLifecycle) {
  const configured = ALLOWED_LIFECYCLE_TRANSITIONS[parsedOperation];
  if (!Array.isArray(configured)) return false;
  const candidates = Array.isArray(configured[0]) ? configured : [configured];
  return candidates.some(
    ([current, proposed]) => current === currentLifecycle && proposed === proposedLifecycle,
  );
}

function operationSemantics(
  parsedOperation,
  sequence,
  destination,
  current,
  proposed,
  parsedBindings,
  parsedPredecessor,
) {
  if (
    !lifecycleTransitionAllowed(parsedOperation, current.lifecycle, proposed.lifecycle) ||
    sequence !== parsedPredecessor.sequence + 1 ||
    parsedPredecessor.stateSha256 !== parsedBindings.currentStateSha256
  ) {
    return invalid();
  }

  const genesisOperation =
    parsedOperation === 'PROVISION_INERT' || parsedOperation === 'ABORT_PROVISION';
  const predecessorArtifacts = [
    parsedPredecessor.intentSha256,
    parsedPredecessor.reservationSha256,
    parsedPredecessor.resultSha256,
  ];
  if (
    (genesisOperation &&
      (sequence !== 1 ||
        parsedPredecessor.sequence !== 0 ||
        parsedPredecessor.committedHeadSha256 !==
          productionDeploymentChainGenesisSha256(destination) ||
        predecessorArtifacts.some((value) => value !== ZERO_SHA256))) ||
    (!genesisOperation &&
      (sequence < 2 || predecessorArtifacts.some((value) => value === ZERO_SHA256)))
  ) {
    return invalid();
  }

  const abortBindings = [
    parsedBindings.abortedProvisionIntentSha256,
    parsedBindings.abortedProvisionReservationSha256,
  ];
  if (
    (parsedOperation === 'ABORT_PROVISION' &&
      abortBindings.some((value) => value === ZERO_SHA256)) ||
    (parsedOperation !== 'ABORT_PROVISION' &&
      abortBindings.some((value) => value !== ZERO_SHA256)) ||
    ((parsedOperation === 'ROLLBACK' || parsedOperation === 'EMERGENCY_KILL') &&
      !authorityDoesNotIncrease(current.authority, proposed.authority))
  ) {
    return invalid();
  }
}

function parsedContent(value) {
  const parsed = dataRecord(value, EXACT_KEYS.content);
  if (parsed.status !== 'AUTHORIZED') return invalid();
  const issuedAt = canonicalInstant(parsed.issuedAt);
  const expiresAt = canonicalInstant(parsed.expiresAt);
  if (
    expiresAt.milliseconds <= issuedAt.milliseconds ||
    expiresAt.milliseconds - issuedAt.milliseconds > MAX_INTENT_VALIDITY_MILLISECONDS
  ) {
    return invalid();
  }
  const parsedOperation = operation(parsed.operation);
  const sequence = chainSequence(parsed.sequence);
  const destination = destinationBinding(parsed.destinationBinding);
  const parsedDeployment = deployment(parsed.deployment);
  if (
    parsedDeployment.accountId !== destination.accountId ||
    parsedDeployment.region !== destination.region ||
    parsedDeployment.stackName !== destination.stackName
  ) {
    return invalid();
  }
  const currentState = deploymentState(parsed.currentState);
  const proposedState = deploymentState(parsed.proposedState);
  const parsedBindings = bindings(parsed.bindings, currentState, proposedState);
  const parsedPredecessor = predecessor(parsed.predecessor);
  operationSemantics(
    parsedOperation,
    sequence,
    destination,
    currentState,
    proposedState,
    parsedBindings,
    parsedPredecessor,
  );
  const content = deepFreeze({
    status: 'AUTHORIZED',
    intentId: boundedIdentifier(parsed.intentId, 192),
    operation: parsedOperation,
    sequence,
    issuedAt: issuedAt.text,
    expiresAt: expiresAt.text,
    destinationBinding: destination,
    deployment: parsedDeployment,
    sourceRevision: sourceRevision(parsed.sourceRevision),
    releaseCandidateManifestSha256: digest(parsed.releaseCandidateManifestSha256),
    bindings: parsedBindings,
    predecessor: parsedPredecessor,
    currentState,
    proposedState,
  });
  return Object.freeze({ content, issuedAt, expiresAt });
}

export function productionDeploymentIntentContentSha256(value) {
  try {
    return domainHash(
      INTENT_HASH_DOMAIN,
      canonicalizeProductionDeploymentIntentValue(parsedContent(value).content),
    );
  } catch {
    return invalid();
  }
}

function signer(value) {
  const parsed = dataRecord(value, EXACT_KEYS.signer);
  if (
    !PRODUCTION_DEPLOYMENT_INTENT_SIGNER_ROLES.includes(parsed.role) ||
    parsed.scope !== PRODUCTION_DEPLOYMENT_INTENT_SCOPE ||
    typeof parsed.authorityKeyId !== 'string' ||
    parsed.authorityKeyId.length > MAX_KEY_ID_LENGTH ||
    !KEY_ID_PATTERN.test(parsed.authorityKeyId)
  ) {
    return invalid();
  }
  return Object.freeze({
    role: parsed.role,
    scope: PRODUCTION_DEPLOYMENT_INTENT_SCOPE,
    authorityKeyId: parsed.authorityKeyId,
    signedAt: canonicalInstant(parsed.signedAt).text,
  });
}

function unsignedRoot(value) {
  const parsed = dataRecord(value, EXACT_KEYS.unsignedRoot);
  if (
    parsed.schemaVersion !== 2 ||
    parsed.artifactType !== 'PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_INTENT_V2'
  ) {
    return invalid();
  }
  const content = parsedContent(parsed.content);
  const intentSha256 = digest(parsed.intentSha256);
  if (intentSha256 !== productionDeploymentIntentContentSha256(content.content)) return invalid();
  return Object.freeze({
    value: Object.freeze({
      schemaVersion: 2,
      artifactType: 'PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_INTENT_V2',
      intentSha256,
      content: content.content,
    }),
    issuedAt: content.issuedAt,
    expiresAt: content.expiresAt,
  });
}

export function productionDeploymentIntentSigningBytes(unsignedValue, signerValue) {
  try {
    const unsigned = unsignedRoot(unsignedValue);
    const parsedSigner = signer(signerValue);
    const signedAt = canonicalInstant(parsedSigner.signedAt);
    if (
      signedAt.milliseconds < unsigned.issuedAt.milliseconds ||
      signedAt.milliseconds >= unsigned.expiresAt.milliseconds
    ) {
      return invalid();
    }
    return Buffer.from(
      `${SIGNING_DOMAIN}\n${canonicalizeProductionDeploymentIntentValue({
        schemaVersion: unsigned.value.schemaVersion,
        artifactType: unsigned.value.artifactType,
        intentSha256: unsigned.value.intentSha256,
        content: unsigned.value.content,
        signer: parsedSigner,
      })}`,
      'utf8',
    );
  } catch {
    return invalid();
  }
}

function canonicalBase64(value, expectedBytes) {
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
  if (bytes.toString('base64') !== value || bytes.length !== expectedBytes) return invalid();
  return bytes;
}

function parsedRegistry(value) {
  const parsed = dataRecord(value, EXACT_KEYS.registry);
  if (
    parsed.schemaVersion !== 2 ||
    parsed.artifactType !== 'PRODUCTION_DEPLOYMENT_INTENT_AUTHORITY_KEY_REGISTRY_V2'
  ) {
    return invalid();
  }
  const candidates = strictArray(parsed.keys, MAX_AUTHORITY_KEYS);
  const keyIds = new Set();
  const publicKeyHashes = new Set();
  let previousKeyId;
  const keys = candidates.map((candidate) => {
    const key = dataRecord(candidate, EXACT_KEYS.authorityKey);
    if (
      typeof key.keyId !== 'string' ||
      key.keyId.length > MAX_KEY_ID_LENGTH ||
      !KEY_ID_PATTERN.test(key.keyId) ||
      keyIds.has(key.keyId) ||
      (previousKeyId !== undefined && previousKeyId >= key.keyId) ||
      !PRODUCTION_DEPLOYMENT_INTENT_SIGNER_ROLES.includes(key.role) ||
      key.scope !== PRODUCTION_DEPLOYMENT_INTENT_SCOPE ||
      key.algorithm !== 'Ed25519' ||
      key.status !== 'APPROVED' ||
      typeof key.approvalReferenceId !== 'string' ||
      !REFERENCE_PATTERN.test(key.approvalReferenceId)
    ) {
      return invalid();
    }
    const validFrom = canonicalInstant(key.validFrom);
    const validUntil = canonicalInstant(key.validUntil);
    if (
      validUntil.milliseconds <= validFrom.milliseconds ||
      validUntil.milliseconds - validFrom.milliseconds > MAX_KEY_VALIDITY_MILLISECONDS
    ) {
      return invalid();
    }
    const der = canonicalBase64(key.publicKeySpkiDerBase64, 44);
    if (!der.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
      return invalid();
    }
    try {
      validateEd25519PublicKeyBytes(der.subarray(ED25519_SPKI_PREFIX.length));
    } catch {
      return invalid();
    }
    let publicKey;
    try {
      publicKey = createPublicKey({ key: der, format: 'der', type: 'spki' });
    } catch {
      return invalid();
    }
    if (publicKey.asymmetricKeyType !== 'ed25519') return invalid();
    const canonicalDer = publicKey.export({ format: 'der', type: 'spki' });
    if (!Buffer.isBuffer(canonicalDer) || !canonicalDer.equals(der)) return invalid();
    const publicKeySha256 = createHash('sha256').update(der).digest('hex');
    if (publicKeyHashes.has(publicKeySha256)) return invalid();
    keyIds.add(key.keyId);
    publicKeyHashes.add(publicKeySha256);
    previousKeyId = key.keyId;
    return Object.freeze({
      keyId: key.keyId,
      role: key.role,
      scope: key.scope,
      validFrom,
      validUntil,
      publicKey,
      publicKeySha256,
    });
  });
  return Object.freeze({
    keys: Object.freeze(keys),
    registrySha256: domainHash(
      AUTHORITY_REGISTRY_HASH_DOMAIN,
      canonicalizeProductionDeploymentIntentValue(value),
    ),
  });
}

function parsedSignature(value, expectedRole) {
  const parsed = dataRecord(value, EXACT_KEYS.signature);
  const parsedSigner = signer({
    role: parsed.role,
    scope: parsed.scope,
    authorityKeyId: parsed.authorityKeyId,
    signedAt: parsed.signedAt,
  });
  if (parsedSigner.role !== expectedRole || parsed.algorithm !== 'Ed25519') return invalid();
  return Object.freeze({
    ...parsedSigner,
    algorithm: 'Ed25519',
    valueBase64: canonicalBase64(parsed.valueBase64, 64).toString('base64'),
  });
}

function verificationOptions(value, trustedEvaluationInstant) {
  const usesInjectedTestTime = trustedEvaluationInstant === undefined;
  const parsed = dataRecord(
    value,
    usesInjectedTestTime ? EXACT_KEYS.testOptions : EXACT_KEYS.productionOptions,
  );
  const evaluatedAt = usesInjectedTestTime
    ? canonicalInstant(parsed.evaluatedAt)
    : trustedEvaluationInstant;
  if (
    typeof parsed.expectedAccountId !== 'string' ||
    !/^\d{12}$/u.test(parsed.expectedAccountId) ||
    typeof parsed.expectedRegion !== 'string' ||
    !REGION_PATTERN.test(parsed.expectedRegion) ||
    typeof parsed.expectedStackName !== 'string' ||
    !STACK_NAME_PATTERN.test(parsed.expectedStackName) ||
    typeof parsed.expectedChangeSetName !== 'string' ||
    !STACK_NAME_PATTERN.test(parsed.expectedChangeSetName)
  ) {
    return invalid();
  }
  return Object.freeze({
    evaluatedAt,
    expectedOperation: operation(parsed.expectedOperation),
    expectedSequence: chainSequence(parsed.expectedSequence),
    expectedIntentSha256: digest(parsed.expectedIntentSha256),
    expectedDestinationId: boundedIdentifier(parsed.expectedDestinationId, 96),
    expectedDestinationSha256: digest(parsed.expectedDestinationSha256),
    expectedDestinationEpochId: digest(parsed.expectedDestinationEpochId),
    expectedDestinationRegistrySha256: digest(parsed.expectedDestinationRegistrySha256),
    expectedPublicOrigin: canonicalHttpsOrigin(parsed.expectedPublicOrigin),
    expectedPredecessorSequence: chainSequence(parsed.expectedPredecessorSequence, true),
    expectedPredecessorCommittedHeadSha256: digest(parsed.expectedPredecessorCommittedHeadSha256),
    expectedPredecessorIntentSha256: digest(parsed.expectedPredecessorIntentSha256, true),
    expectedPredecessorReservationSha256: digest(parsed.expectedPredecessorReservationSha256, true),
    expectedPredecessorResultSha256: digest(parsed.expectedPredecessorResultSha256, true),
    expectedAbortedProvisionIntentSha256: digest(parsed.expectedAbortedProvisionIntentSha256, true),
    expectedAbortedProvisionReservationSha256: digest(
      parsed.expectedAbortedProvisionReservationSha256,
      true,
    ),
    expectedSourceRevision: sourceRevision(parsed.expectedSourceRevision),
    expectedReleaseCandidateManifestSha256: digest(parsed.expectedReleaseCandidateManifestSha256),
    expectedInfrastructureContractSha256: digest(parsed.expectedInfrastructureContractSha256),
    expectedInfrastructureTemplateSha256: digest(parsed.expectedInfrastructureTemplateSha256),
    expectedDeploymentConfigurationSha256: digest(parsed.expectedDeploymentConfigurationSha256),
    expectedBillingControlSha256: digest(parsed.expectedBillingControlSha256),
    expectedEgressPolicySha256: digest(parsed.expectedEgressPolicySha256),
    expectedCredentialStateSha256: digest(parsed.expectedCredentialStateSha256),
    expectedCurrentStateSha256: digest(parsed.expectedCurrentStateSha256),
    expectedProposedStateSha256: digest(parsed.expectedProposedStateSha256),
    expectedRollbackPlanSha256: digest(parsed.expectedRollbackPlanSha256),
    expectedKillStateSha256: digest(parsed.expectedKillStateSha256),
    expectedAccountId: parsed.expectedAccountId,
    expectedRegion: parsed.expectedRegion,
    expectedStackName: parsed.expectedStackName,
    expectedChangeSetName: parsed.expectedChangeSetName,
  });
}

function parsedRoot(value) {
  const parsed = dataRecord(value, EXACT_KEYS.root);
  const unsigned = unsignedRoot({
    schemaVersion: parsed.schemaVersion,
    artifactType: parsed.artifactType,
    intentSha256: parsed.intentSha256,
    content: parsed.content,
  });
  const signatureCandidates = strictArray(
    parsed.signatures,
    PRODUCTION_DEPLOYMENT_INTENT_SIGNER_ROLES.length,
  );
  if (signatureCandidates.length !== PRODUCTION_DEPLOYMENT_INTENT_SIGNER_ROLES.length) {
    return invalid();
  }
  const signatures = signatureCandidates.map((candidate, index) => {
    const expectedRole = PRODUCTION_DEPLOYMENT_INTENT_SIGNER_ROLES[index];
    return expectedRole === undefined ? invalid() : parsedSignature(candidate, expectedRole);
  });
  if (new Set(signatures.map(({ authorityKeyId }) => authorityKeyId)).size !== signatures.length) {
    return invalid();
  }
  return Object.freeze({ unsigned, signatures: Object.freeze(signatures) });
}

function resolveBoundDestination(content, destinationResolver, requireProductionBrand) {
  let resolved;
  try {
    resolved = destinationResolver(
      content.destinationBinding.destinationId,
      content.destinationBinding.destinationSha256,
    );
  } catch {
    return invalid();
  }
  const productionBranded = isVerifiedProductionDeploymentDestination(resolved);
  const binding = content.destinationBinding;
  if (
    (requireProductionBrand && !productionBranded) ||
    (!requireProductionBrand && productionBranded) ||
    resolved.destinationId !== binding.destinationId ||
    resolved.destinationSha256 !== binding.destinationSha256 ||
    resolved.epochId !== binding.epochId ||
    resolved.registrySha256 !== binding.destinationRegistrySha256 ||
    resolved.environment !== binding.environment ||
    resolved.awsAccountId !== binding.accountId ||
    resolved.awsRegion !== binding.region ||
    resolved.stackName !== binding.stackName ||
    resolved.publicOrigin !== binding.publicOrigin
  ) {
    return invalid();
  }
  return resolved;
}

function createAuthorizationFreshness(initialReading, finalReading, expiresAtMilliseconds) {
  const monotonicDeadlineMilliseconds =
    initialReading.monotonicMilliseconds +
    (expiresAtMilliseconds - initialReading.wall.milliseconds);
  if (
    finalReading.wall.milliseconds < initialReading.wall.milliseconds ||
    finalReading.monotonicMilliseconds < initialReading.monotonicMilliseconds ||
    finalReading.wall.milliseconds >= expiresAtMilliseconds ||
    !Number.isFinite(monotonicDeadlineMilliseconds) ||
    finalReading.monotonicMilliseconds >= monotonicDeadlineMilliseconds
  ) {
    return invalid();
  }
  return Object.seal({
    invalidated: false,
    expiresAtMilliseconds,
    monotonicDeadlineMilliseconds,
    lastObservedWallMilliseconds: finalReading.wall.milliseconds,
    lastObservedMonotonicMilliseconds: finalReading.monotonicMilliseconds,
  });
}

function verifyIntent(
  value,
  optionsValue,
  registryValue,
  {
    requireProductionDestination,
    destinationResolver,
    brandProduction,
    trustedEvaluationInstant,
    authorizationLifecycle,
  },
) {
  try {
    if (
      (brandProduction &&
        (trustedEvaluationInstant === undefined ||
          authorizationLifecycle?.reportRegistry !== PRODUCTION_AUTHORIZED_REPORTS)) ||
      (!brandProduction &&
        authorizationLifecycle?.reportRegistry === PRODUCTION_AUTHORIZED_REPORTS) ||
      (authorizationLifecycle !== undefined &&
        trustedEvaluationInstant !== authorizationLifecycle.initialReading.wall) ||
      typeof destinationResolver !== 'function'
    ) {
      return invalid();
    }
    const parsed = parsedRoot(value);
    const options = verificationOptions(optionsValue, trustedEvaluationInstant);
    const content = parsed.unsigned.value.content;
    if (
      parsed.unsigned.value.intentSha256 !== options.expectedIntentSha256 ||
      content.operation !== options.expectedOperation ||
      content.sequence !== options.expectedSequence ||
      content.destinationBinding.destinationId !== options.expectedDestinationId ||
      content.destinationBinding.destinationSha256 !== options.expectedDestinationSha256 ||
      content.destinationBinding.epochId !== options.expectedDestinationEpochId ||
      content.destinationBinding.destinationRegistrySha256 !==
        options.expectedDestinationRegistrySha256 ||
      content.destinationBinding.publicOrigin !== options.expectedPublicOrigin ||
      content.predecessor.sequence !== options.expectedPredecessorSequence ||
      content.predecessor.committedHeadSha256 !== options.expectedPredecessorCommittedHeadSha256 ||
      content.predecessor.intentSha256 !== options.expectedPredecessorIntentSha256 ||
      content.predecessor.reservationSha256 !== options.expectedPredecessorReservationSha256 ||
      content.predecessor.resultSha256 !== options.expectedPredecessorResultSha256 ||
      content.bindings.abortedProvisionIntentSha256 !==
        options.expectedAbortedProvisionIntentSha256 ||
      content.bindings.abortedProvisionReservationSha256 !==
        options.expectedAbortedProvisionReservationSha256 ||
      content.sourceRevision !== options.expectedSourceRevision ||
      content.releaseCandidateManifestSha256 !== options.expectedReleaseCandidateManifestSha256 ||
      content.bindings.infrastructureContractSha256 !==
        options.expectedInfrastructureContractSha256 ||
      content.bindings.infrastructureTemplateSha256 !==
        options.expectedInfrastructureTemplateSha256 ||
      content.bindings.deploymentConfigurationSha256 !==
        options.expectedDeploymentConfigurationSha256 ||
      content.bindings.billingControlSha256 !== options.expectedBillingControlSha256 ||
      content.bindings.egressPolicySha256 !== options.expectedEgressPolicySha256 ||
      content.bindings.credentialStateSha256 !== options.expectedCredentialStateSha256 ||
      content.bindings.currentStateSha256 !== options.expectedCurrentStateSha256 ||
      content.bindings.proposedStateSha256 !== options.expectedProposedStateSha256 ||
      content.bindings.rollbackPlanSha256 !== options.expectedRollbackPlanSha256 ||
      content.bindings.killStateSha256 !== options.expectedKillStateSha256 ||
      content.deployment.accountId !== options.expectedAccountId ||
      content.deployment.region !== options.expectedRegion ||
      content.deployment.stackName !== options.expectedStackName ||
      content.deployment.changeSetName !== options.expectedChangeSetName ||
      options.evaluatedAt.milliseconds < parsed.unsigned.issuedAt.milliseconds ||
      options.evaluatedAt.milliseconds >= parsed.unsigned.expiresAt.milliseconds
    ) {
      return invalid();
    }
    const resolvedDestination = resolveBoundDestination(
      content,
      destinationResolver,
      requireProductionDestination,
    );
    const registry = parsedRegistry(registryValue);
    const usedPublicKeys = new Set();
    for (const signature of parsed.signatures) {
      const authority = registry.keys.find(({ keyId }) => keyId === signature.authorityKeyId);
      const signedAt = canonicalInstant(signature.signedAt);
      if (
        authority === undefined ||
        authority.role !== signature.role ||
        authority.scope !== signature.scope ||
        signedAt.milliseconds < parsed.unsigned.issuedAt.milliseconds ||
        signedAt.milliseconds > options.evaluatedAt.milliseconds ||
        signedAt.milliseconds >= parsed.unsigned.expiresAt.milliseconds ||
        signedAt.milliseconds < authority.validFrom.milliseconds ||
        parsed.unsigned.expiresAt.milliseconds > authority.validUntil.milliseconds ||
        usedPublicKeys.has(authority.publicKeySha256) ||
        !verifySignature(
          null,
          productionDeploymentIntentSigningBytes(parsed.unsigned.value, {
            role: signature.role,
            scope: signature.scope,
            authorityKeyId: signature.authorityKeyId,
            signedAt: signature.signedAt,
          }),
          authority.publicKey,
          canonicalBase64(signature.valueBase64, 64),
        )
      ) {
        return invalid();
      }
      usedPublicKeys.add(authority.publicKeySha256);
    }
    const freshness =
      authorizationLifecycle === undefined
        ? undefined
        : createAuthorizationFreshness(
            authorizationLifecycle.initialReading,
            authorizationLifecycle.readClock(),
            parsed.unsigned.expiresAt.milliseconds,
          );
    const abortedProvisionAttempt =
      content.operation === 'ABORT_PROVISION'
        ? Object.freeze({
            intentSha256: content.bindings.abortedProvisionIntentSha256,
            reservationSha256: content.bindings.abortedProvisionReservationSha256,
          })
        : null;
    const report = deepFreeze({
      ok: true,
      signatureValidated: true,
      productionAuthorityValidated: brandProduction,
      readyForAuthorizedPlan: false,
      callerExpectedPredecessorMatched: true,
      durableCasRequired: true,
      durableCasAccepted: false,
      reservationCommitted: false,
      executionAllowed: false,
      operation: content.operation,
      sequence: content.sequence,
      intentSha256: parsed.unsigned.value.intentSha256,
      destinationResolved: true,
      destination: resolvedDestination,
      destinationBinding: content.destinationBinding,
      predecessor: content.predecessor,
      abortedProvisionAttempt,
      authorityRegistrySha256: registry.registrySha256,
      validUntil: content.expiresAt,
      plan: Object.freeze({
        kind: 'LOCAL_ONLY_NON_EXECUTABLE_PRODUCTION_DEPLOYMENT_RESERVATION_REQUEST',
        operation: content.operation,
        sequence: content.sequence,
        committedHeadSha256: content.predecessor.committedHeadSha256,
        abortedProvisionAttempt,
        durableCasAccepted: false,
        executionAllowed: false,
        durableCasAndLiveEvidenceRequired: true,
      }),
      errors: Object.freeze([]),
      ...ZERO_CALLS,
    });
    if (freshness !== undefined) authorizationLifecycle.reportRegistry.set(report, freshness);
    return report;
  } catch {
    return failureReport();
  }
}

function failureReport(errors = ['Production deployment intent validation failed.']) {
  return deepFreeze({
    ok: false,
    signatureValidated: false,
    productionAuthorityValidated: false,
    readyForAuthorizedPlan: false,
    destinationResolved: false,
    abortedProvisionAttempt: null,
    callerExpectedPredecessorMatched: false,
    durableCasRequired: true,
    durableCasAccepted: false,
    reservationCommitted: false,
    executionAllowed: false,
    errors: Object.freeze([...errors]),
    ...ZERO_CALLS,
  });
}

function verifyIntentAtTrustedCurrentTime(
  value,
  options,
  registry,
  { requireProductionDestination, destinationResolver, brandProduction },
) {
  try {
    const initialReading = trustedClockReading();
    return verifyIntent(value, options, registry, {
      requireProductionDestination,
      destinationResolver,
      brandProduction,
      trustedEvaluationInstant: initialReading.wall,
      authorizationLifecycle: brandProduction
        ? Object.freeze({
            initialReading,
            readClock: trustedClockReading,
            reportRegistry: PRODUCTION_AUTHORIZED_REPORTS,
          })
        : undefined,
    });
  } catch {
    return failureReport();
  }
}

function reportIsFreshAt(value, registry, reading) {
  if (value === null || typeof value !== 'object') return false;
  const freshness = registry.get(value);
  if (freshness === undefined || freshness.invalidated) return false;
  if (
    reading.wall.milliseconds < freshness.lastObservedWallMilliseconds ||
    reading.monotonicMilliseconds < freshness.lastObservedMonotonicMilliseconds ||
    reading.wall.milliseconds >= freshness.expiresAtMilliseconds ||
    reading.monotonicMilliseconds >= freshness.monotonicDeadlineMilliseconds
  ) {
    freshness.invalidated = true;
    return false;
  }
  freshness.lastObservedWallMilliseconds = reading.wall.milliseconds;
  freshness.lastObservedMonotonicMilliseconds = reading.monotonicMilliseconds;
  return true;
}

function reportIsFreshFromClock(value, registry, readClock) {
  if (value === null || typeof value !== 'object') return false;
  const freshness = registry.get(value);
  if (freshness === undefined || freshness.invalidated) return false;
  try {
    return reportIsFreshAt(value, registry, readClock());
  } catch {
    freshness.invalidated = true;
    return false;
  }
}

function revalidateReportFromClock(value, registry, readClock) {
  if (!reportIsFreshFromClock(value, registry, readClock)) return invalid();
  return value;
}

function testDestinationResolver(registry) {
  return (destinationId, destinationSha256) =>
    resolveProductionDeploymentDestinationWithTestRegistry(
      destinationId,
      destinationSha256,
      registry,
    );
}

/** Test-only trust seam. A successful report is deliberately never production-branded. */
export function verifyProductionDeploymentIntentWithTestRegistry(
  value,
  options,
  registry,
  destinationRegistry,
) {
  return verifyIntent(value, options, registry, {
    requireProductionDestination: false,
    destinationResolver: testDestinationResolver(destinationRegistry),
    brandProduction: false,
  });
}

/** Test-only trusted-clock seam. Successful reports remain explicitly unbranded. */
export function verifyProductionDeploymentIntentAtTrustedClockWithTestRegistry(
  value,
  options,
  registry,
  destinationRegistry,
) {
  return verifyIntentAtTrustedCurrentTime(value, options, registry, {
    requireProductionDestination: false,
    destinationResolver: testDestinationResolver(destinationRegistry),
    brandProduction: false,
  });
}

/**
 * Test-only production-lifecycle seam. It uses the real double-read and sticky
 * freshness machinery with an isolated metadata map, so it cannot mint a
 * production brand or enable execution.
 */
export function verifyProductionDeploymentIntentAuthorizationLifecycleForTest(
  value,
  options,
  registry,
  destinationRegistry,
  clockReadings,
) {
  try {
    const readClock = testClockSequence(clockReadings);
    const initialReading = readClock();
    return verifyIntent(value, options, registry, {
      requireProductionDestination: false,
      destinationResolver: testDestinationResolver(destinationRegistry),
      brandProduction: false,
      trustedEvaluationInstant: initialReading.wall,
      authorizationLifecycle: Object.freeze({
        initialReading,
        readClock,
        reportRegistry: TEST_AUTHORIZED_REPORTS,
      }),
    });
  } catch {
    return failureReport();
  }
}

/** Test-only seam: injected keys cannot bypass the empty production destination registry. */
export function verifyProductionDeploymentIntentAgainstProductionDestinationWithTestRegistry(
  value,
  options,
  registry,
) {
  return verifyIntent(value, options, registry, {
    requireProductionDestination: true,
    destinationResolver: resolveProductionDeploymentDestination,
    brandProduction: false,
  });
}

export function verifyProductionDeploymentIntent(value, options) {
  return verifyIntentAtTrustedCurrentTime(
    value,
    options,
    PRODUCTION_DEPLOYMENT_INTENT_AUTHORITY_KEY_REGISTRY,
    {
      requireProductionDestination: true,
      destinationResolver: resolveProductionDeploymentDestination,
      brandProduction: true,
    },
  );
}

export function isProductionAuthorizedDeploymentIntentReport(value) {
  return reportIsFreshFromClock(value, PRODUCTION_AUTHORIZED_REPORTS, trustedClockReading);
}

export function revalidateProductionDeploymentIntentReportForApplication(value) {
  return revalidateReportFromClock(value, PRODUCTION_AUTHORIZED_REPORTS, trustedClockReading);
}

/** Test-only freshness seam; its isolated reports never possess production authority. */
export function isUnbrandedDeploymentIntentReportFreshAtForTest(value, clockReading) {
  if (PRODUCTION_AUTHORIZED_REPORTS.has(value)) return false;
  return reportIsFreshFromClock(value, TEST_AUTHORIZED_REPORTS, () =>
    testClockReading(clockReading),
  );
}

/** Test-only revalidation seam; it rejects production-branded reports. */
export function revalidateUnbrandedDeploymentIntentReportAtForTest(value, clockReading) {
  if (PRODUCTION_AUTHORIZED_REPORTS.has(value)) return invalid();
  return revalidateReportFromClock(value, TEST_AUTHORIZED_REPORTS, () =>
    testClockReading(clockReading),
  );
}

function parsedCanonicalBytes(bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_PRODUCTION_DEPLOYMENT_INTENT_BYTES
  ) {
    return invalid();
  }
  const parsed = parseStrictJsonBytes(bytes);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (text.includes('\u0000') || canonicalizeProductionDeploymentIntentValue(parsed) !== text) {
    return invalid();
  }
  return parsed;
}

export function verifyProductionDeploymentIntentBytesWithTestRegistry(
  bytes,
  options,
  registry,
  destinationRegistry,
) {
  try {
    return verifyIntent(parsedCanonicalBytes(bytes), options, registry, {
      requireProductionDestination: false,
      destinationResolver: testDestinationResolver(destinationRegistry),
      brandProduction: false,
    });
  } catch {
    return failureReport();
  }
}

export function verifyProductionDeploymentIntentBytes(bytes, options) {
  try {
    return verifyIntentAtTrustedCurrentTime(
      parsedCanonicalBytes(bytes),
      options,
      PRODUCTION_DEPLOYMENT_INTENT_AUTHORITY_KEY_REGISTRY,
      {
        requireProductionDestination: true,
        destinationResolver: resolveProductionDeploymentDestination,
        brandProduction: true,
      },
    );
  } catch {
    return failureReport();
  }
}

function comparablePath(value) {
  const resolved = resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function pathWithin(parent, child) {
  const fragment = relative(parent, child);
  return (
    fragment !== '' &&
    !isAbsolute(fragment) &&
    fragment !== '..' &&
    !fragment.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  );
}

function operationalIntentPath(value) {
  const resolved = resolve(value);
  if (
    !pathWithin(LOCAL_PRODUCTION_DEPLOYMENT_INTENT_ROOT, resolved) ||
    !resolved.toLowerCase().endsWith('.production-deployment-intent.local.json')
  ) {
    return invalid();
  }
  return resolved;
}

export function loadAndVerifyProductionDeploymentIntent(path, options) {
  try {
    return verifyProductionDeploymentIntentBytes(
      readSecureLocalFile(operationalIntentPath(path), MAX_PRODUCTION_DEPLOYMENT_INTENT_BYTES),
      options,
    );
  } catch {
    return failureReport();
  }
}

function exactInertExample(value) {
  const parsed = dataRecord(value, EXACT_KEYS.root);
  if (
    parsed.schemaVersion !== 2 ||
    parsed.artifactType !== 'PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_INTENT_V2' ||
    parsed.intentSha256 !== 'NOT_AUTHORIZED' ||
    strictArray(parsed.signatures, 0).length !== 0
  ) {
    return false;
  }
  const content = dataRecord(parsed.content, EXACT_KEYS.content);
  const exampleDestination = dataRecord(content.destinationBinding, EXACT_KEYS.destinationBinding);
  const exampleDeployment = dataRecord(content.deployment, EXACT_KEYS.deployment);
  const exampleBindings = dataRecord(content.bindings, EXACT_KEYS.bindings);
  const examplePredecessor = dataRecord(content.predecessor, EXACT_KEYS.predecessor);
  const currentState = dataRecord(content.currentState, EXACT_KEYS.deploymentState);
  const proposedState = dataRecord(content.proposedState, EXACT_KEYS.deploymentState);
  return (
    content.status === 'NOT_AUTHORIZED' &&
    content.intentId === 'NOT_AUTHORIZED' &&
    content.operation === 'PROVISION_INERT' &&
    content.sequence === 1 &&
    content.issuedAt === 'NOT_RUN' &&
    content.expiresAt === 'NOT_RUN' &&
    exampleDestination.environment === 'production' &&
    Object.entries(exampleDestination).every(
      ([key, entry]) => key === 'environment' || entry === 'NOT_CAPTURED',
    ) &&
    Object.values(exampleDeployment).every((entry) => entry === 'NOT_AUTHORIZED') &&
    content.sourceRevision === 'NOT_CAPTURED' &&
    content.releaseCandidateManifestSha256 === 'NOT_CAPTURED' &&
    Object.values(exampleBindings).every((entry) => entry === 'NOT_CAPTURED') &&
    examplePredecessor.sequence === 0 &&
    Object.entries(examplePredecessor).every(
      ([key, entry]) => key === 'sequence' || entry === 'NOT_CAPTURED',
    ) &&
    currentState.lifecycle === 'ABSENT' &&
    sameAuthorityState(authorityState(currentState.authority), INERT_AUTHORITY_STATE) &&
    proposedState.lifecycle === 'INERT_DEPLOYED' &&
    sameAuthorityState(authorityState(proposedState.authority), INERT_AUTHORITY_STATE)
  );
}

/** Checked-in example validation never grants production authority. */
export function validateProductionDeploymentIntentExample(value) {
  try {
    const ok = exactInertExample(value);
    return deepFreeze({
      ok,
      signatureValidated: false,
      productionAuthorityValidated: false,
      readyForAuthorizedPlan: false,
      executionAllowed: false,
      mode: 'example',
      errors: Object.freeze(ok ? [] : ['Inert deployment intent example validation failed.']),
      ...ZERO_CALLS,
    });
  } catch {
    return failureReport(['Inert deployment intent example validation failed.']);
  }
}

function loadExample() {
  try {
    const bytes = readSecureLocalFile(
      DEFAULT_PRODUCTION_DEPLOYMENT_INTENT_EXAMPLE,
      MAX_PRODUCTION_DEPLOYMENT_INTENT_BYTES,
    );
    return parseStrictJsonBytes(bytes);
  } catch {
    return invalid();
  }
}

function main() {
  if (process.argv.length !== 2) {
    process.stderr.write('Usage: validate-production-deployment-intent.mjs\n');
    process.exitCode = 2;
    return;
  }
  const report = validateProductionDeploymentIntentExample(loadExample());
  if (!report.ok) {
    process.stderr.write('Production deployment intent example validation failed.\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    'Inert production deployment intent example validated. Execution allowed: false. External calls made: 0. Resources changed: 0.\n',
  );
}

if (comparablePath(process.argv[1] ?? '') === comparablePath(fileURLToPath(import.meta.url))) {
  main();
}
