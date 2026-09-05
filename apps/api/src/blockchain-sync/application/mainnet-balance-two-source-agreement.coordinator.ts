import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import { chainObservationPolicyForNetwork } from '../../blockchain/domain/chain-observation-policy';
import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import {
  BALANCE_SYNC_POLICY,
  normalizeBalanceSyncPosition,
  type BalanceSyncPosition,
} from '../domain/balance-sync';
import type {
  BalanceIndexerCandidate,
  BalanceIndexerReadRequest,
  BalanceIndexerSourceCandidate,
  BalanceSyncIndexerPort,
} from './ports/balance-sync.ports';
import { canonicalPositionId } from '../infrastructure/rpc/balance-json-rpc';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_SOURCE_ID = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CANONICAL_UINT = /^(?:0|[1-9][0-9]{0,19})$/u;
const EVM_BLOCK_HASH = /^0x[0-9a-f]{64}$/u;
const SOLANA_BLOCK_IDENTITY = /^[1-9A-HJ-NP-Za-km-z]{32,88}$/u;
const ZERO_EVM_BLOCK_HASH = `0x${'0'.repeat(64)}`;
const ZERO_SOLANA_IDENTITY = '11111111111111111111111111111111';
const MAX_UINT64 = (1n << 64n) - 1n;

export const MAINNET_BALANCE_TWO_SOURCE_AGREEMENT_VERSION = 1 as const;
export const MAINNET_BALANCE_TWO_SOURCE_AGREEMENT_USE =
  'DORMANT_MAINNET_BALANCE_OBSERVATION_CANDIDATE_ONLY' as const;

export const ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID = 'eip155:1' as const;
export const SOLANA_MAINNET_BALANCE_AGREEMENT_NETWORK_ID =
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;

export type MainnetBalanceAgreementNetworkId =
  | typeof ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID
  | typeof SOLANA_MAINNET_BALANCE_AGREEMENT_NETWORK_ID;

export type MainnetBalanceAgreementSourceRole = 'PRIMARY' | 'CORROBORATING';

export interface MainnetBalanceAgreementSourceIdentityV1 {
  readonly sourceFamilyId: string;
  readonly sourceId: string;
}

export interface MainnetBalanceSourcePairV1 {
  readonly networkId: MainnetBalanceAgreementNetworkId;
  readonly approvedAt: string;
  readonly expiresAt: string;
  readonly primary: MainnetBalanceAgreementSourceIdentityV1;
  readonly corroborating: MainnetBalanceAgreementSourceIdentityV1;
}

export interface MainnetBalanceSourcePairRegistryContentV1 {
  readonly schemaVersion: typeof MAINNET_BALANCE_TWO_SOURCE_AGREEMENT_VERSION;
  readonly environment: 'MAINNET';
  readonly approvalStatus: 'NOT_APPROVED' | 'APPROVED';
  readonly pairs: readonly MainnetBalanceSourcePairV1[];
}

export interface MainnetBalanceSourcePairRegistryV1 extends MainnetBalanceSourcePairRegistryContentV1 {
  readonly fingerprintSha256: string;
}

export interface MainnetBalanceAgreementSourceBinding {
  readonly networkId: MainnetBalanceAgreementNetworkId;
  readonly role: MainnetBalanceAgreementSourceRole;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly reader: Pick<BalanceSyncIndexerPort, 'readCurrent'>;
}

export interface MainnetBalanceAgreementClock {
  now(): Date;
}

export interface EthereumMainnetBalanceAgreementCheckpointV1 {
  readonly kind: 'ETHEREUM_BLOCK';
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly parentBlockHash: string;
}

export interface SolanaMainnetBalanceAgreementCheckpointV1 {
  readonly kind: 'SOLANA_ROOTED_BLOCK';
  readonly finalizedSlot: string;
  readonly blockIdentity: string;
  readonly parentBlockIdentity: string;
  readonly rootSlot: string;
  readonly rootDerivation: 'FINALIZED_SLOT_IS_ROOTED';
}

export type MainnetBalanceAgreementCheckpointV1 =
  EthereumMainnetBalanceAgreementCheckpointV1 | SolanaMainnetBalanceAgreementCheckpointV1;

export interface MainnetBalanceSourceAttestationV1 {
  readonly role: MainnetBalanceAgreementSourceRole;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly networkId: MainnetBalanceAgreementNetworkId;
  readonly retrievedAt: string;
  readonly chainIdentityValidated: true;
  readonly checkpoint: MainnetBalanceAgreementCheckpointV1;
  readonly positionSetFingerprintSha256: string;
  readonly candidateFingerprintSha256: string;
}

export interface MainnetBalanceAgreementEvidenceV1 {
  readonly status: 'EXACT_CHECKPOINT_AND_BALANCE_MATCH';
  readonly checkpoint: MainnetBalanceAgreementCheckpointV1;
  readonly sourcePairRegistryFingerprintSha256: string;
  readonly sourcePairApprovalExpiresAt: string;
  readonly positionSetFingerprintSha256: string;
  readonly sourceAttestations: readonly [
    MainnetBalanceSourceAttestationV1,
    MainnetBalanceSourceAttestationV1,
  ];
  readonly agreementFingerprintSha256: string;
}

/**
 * This envelope must remain intact if a later ticket introduces persistence.
 * Passing only observationCandidate to the existing checkpoint repository would
 * discard the source-pair evidence and is therefore deliberately not wired.
 */
export interface MainnetBalanceTwoSourceAgreementCandidateV1 {
  readonly agreementVersion: typeof MAINNET_BALANCE_TWO_SOURCE_AGREEMENT_VERSION;
  readonly use: typeof MAINNET_BALANCE_TWO_SOURCE_AGREEMENT_USE;
  readonly mayPersist: false;
  readonly mayAuthorizeFinancialAction: false;
  readonly accountId: string;
  readonly observationCandidate: BalanceIndexerCandidate;
  readonly agreement: MainnetBalanceAgreementEvidenceV1;
}

export type MainnetBalanceTwoSourceAgreementFailureCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_CHAIN'
  | 'UNTRUSTED_SOURCE_IDENTITY'
  | 'SOURCE_UNAVAILABLE'
  | 'SOURCE_DATA_INVALID'
  | 'SOURCE_STALE'
  | 'CHECKPOINT_MISMATCH'
  | 'BALANCE_MISMATCH';

export class MainnetBalanceTwoSourceAgreementUnavailableError extends Error {
  constructor(readonly code: MainnetBalanceTwoSourceAgreementFailureCode) {
    super('Mainnet balance source agreement is unavailable.');
    this.name = 'MainnetBalanceTwoSourceAgreementUnavailableError';
  }
}

interface CanonicalTime {
  readonly timestamp: string;
  readonly milliseconds: number;
}

interface ParsedSourceCandidate {
  readonly source: BalanceIndexerSourceCandidate;
  readonly checkpoint: MainnetBalanceAgreementCheckpointV1;
  readonly positions: readonly BalanceSyncPosition[];
  readonly positionSetFingerprintSha256: string;
}

interface NormalizedSourceBinding extends Omit<MainnetBalanceAgreementSourceBinding, 'reader'> {
  readonly readerIdentity: object;
  readonly readCurrent: (request: BalanceIndexerReadRequest) => Promise<unknown>;
}

interface CapturedDataMethod {
  readonly receiver: object;
  readonly method: (...arguments_: readonly unknown[]) => unknown;
}

function fail(code: MainnetBalanceTwoSourceAgreementFailureCode): never {
  throw new MainnetBalanceTwoSourceAgreementUnavailableError(code);
}

function registryFingerprint(content: MainnetBalanceSourcePairRegistryContentV1): string {
  return fingerprint([
    'crypto-lending:mainnet-balance-source-pair-registry:v1',
    content.schemaVersion,
    content.environment,
    content.approvalStatus,
    content.pairs.map((pair) => [
      pair.networkId,
      pair.approvedAt,
      pair.expiresAt,
      [pair.primary.sourceFamilyId, pair.primary.sourceId],
      [pair.corroborating.sourceFamilyId, pair.corroborating.sourceId],
    ]),
  ]);
}

export function fingerprintMainnetBalanceSourcePairRegistryV1(input: unknown): string {
  return registryFingerprint(parseRegistryContent(input));
}

const UNAPPROVED_REGISTRY_CONTENT = deepFreeze({
  schemaVersion: MAINNET_BALANCE_TWO_SOURCE_AGREEMENT_VERSION,
  environment: 'MAINNET' as const,
  approvalStatus: 'NOT_APPROVED' as const,
  pairs: Object.freeze([]),
});

/**
 * Checked-in production posture. No source name, provider, endpoint, or pair is
 * approved by this repository change.
 */
export const MAINNET_BALANCE_SOURCE_PAIR_REGISTRY_V1: MainnetBalanceSourcePairRegistryV1 =
  deepFreeze({
    ...UNAPPROVED_REGISTRY_CONTENT,
    fingerprintSha256: registryFingerprint(UNAPPROVED_REGISTRY_CONTENT),
  });

/**
 * Dormant, finalized-only agreement boundary. Readers and a trusted registry
 * are injected; this class has no Nest decorator, transport, endpoint, secret,
 * timer, persistence adapter, or activation side effect.
 */
export class DormantMainnetBalanceTwoSourceAgreementCoordinator {
  private readonly registry!: MainnetBalanceSourcePairRegistryV1;
  private readonly bindings!: readonly NormalizedSourceBinding[];
  private readonly clockNow!: () => Date;

  constructor(
    registryInput: unknown,
    bindingsInput: readonly MainnetBalanceAgreementSourceBinding[],
    clock: MainnetBalanceAgreementClock,
  ) {
    try {
      this.registry = parseRegistry(registryInput);
      this.bindings = normalizeBindings(bindingsInput, this.registry);
      const capturedClock = captureDataMethod(clock, 'now', 'INVALID_CONFIGURATION');
      this.clockNow = () => Reflect.apply(capturedClock.method, capturedClock.receiver, []) as Date;
    } catch (error) {
      if (error instanceof MainnetBalanceTwoSourceAgreementUnavailableError) throw error;
      return fail('INVALID_CONFIGURATION');
    }
  }

  async readCurrentAgreement(
    requestInput: BalanceIndexerReadRequest,
  ): Promise<MainnetBalanceTwoSourceAgreementCandidateV1> {
    const request = parseRequest(requestInput);
    const started = clockTime(this.clockNow);
    const pair = trustedCurrentPair(this.registry, request.networkId, started.milliseconds);
    const primaryBinding = bindingFor(this.bindings, pair, 'PRIMARY');
    const corroboratingBinding = bindingFor(this.bindings, pair, 'CORROBORATING');
    let primaryValue: unknown;
    let corroboratingValue: unknown;
    try {
      [primaryValue, corroboratingValue] = await Promise.all([
        primaryBinding.readCurrent(request),
        corroboratingBinding.readCurrent(request),
      ]);
    } catch {
      return fail('SOURCE_UNAVAILABLE');
    }
    if (
      typeof primaryValue === 'object' &&
      primaryValue !== null &&
      primaryValue === corroboratingValue
    ) {
      return fail('UNTRUSTED_SOURCE_IDENTITY');
    }
    const completed = clockTime(this.clockNow);
    if (completed.milliseconds < started.milliseconds) return fail('INVALID_CONFIGURATION');
    trustedCurrentPair(this.registry, request.networkId, completed.milliseconds);

    const primaryCandidate = parseCandidate(primaryValue, request, completed.milliseconds);
    const corroboratingCandidate = parseCandidate(
      corroboratingValue,
      request,
      completed.milliseconds,
    );
    if (
      canonicalJson(primaryCandidate.checkpoint) !==
      canonicalJson(corroboratingCandidate.checkpoint)
    ) {
      return fail('CHECKPOINT_MISMATCH');
    }
    if (
      primaryCandidate.positionSetFingerprintSha256 !==
        corroboratingCandidate.positionSetFingerprintSha256 ||
      canonicalJson(primaryCandidate.positions) !== canonicalJson(corroboratingCandidate.positions)
    ) {
      return fail('BALANCE_MISMATCH');
    }

    const primaryAttestation = sourceAttestation(
      primaryBinding,
      request,
      primaryCandidate,
      this.registry.fingerprintSha256,
    );
    const corroboratingAttestation = sourceAttestation(
      corroboratingBinding,
      request,
      corroboratingCandidate,
      this.registry.fingerprintSha256,
    );
    const retrievedAt =
      primaryCandidate.source.retrievedAt >= corroboratingCandidate.source.retrievedAt
        ? primaryCandidate.source.retrievedAt
        : corroboratingCandidate.source.retrievedAt;
    const observationCandidate = deepFreeze({
      walletId: request.walletId,
      networkId: request.networkId,
      tier: request.tier,
      source: {
        position: primaryCandidate.source.position,
        hash: primaryCandidate.source.hash,
        parentHash: primaryCandidate.source.parentHash,
        selector: request.selector,
        retrievedAt,
        identityValidated: true as const,
      },
      positions: primaryCandidate.positions,
    }) satisfies BalanceIndexerCandidate;
    const agreementWithoutFingerprint = deepFreeze({
      status: 'EXACT_CHECKPOINT_AND_BALANCE_MATCH' as const,
      checkpoint: primaryCandidate.checkpoint,
      sourcePairRegistryFingerprintSha256: this.registry.fingerprintSha256,
      sourcePairApprovalExpiresAt: pair.expiresAt,
      positionSetFingerprintSha256: primaryCandidate.positionSetFingerprintSha256,
      sourceAttestations: Object.freeze([
        primaryAttestation,
        corroboratingAttestation,
      ]) as readonly [MainnetBalanceSourceAttestationV1, MainnetBalanceSourceAttestationV1],
    });
    const agreement = deepFreeze({
      ...agreementWithoutFingerprint,
      agreementFingerprintSha256: fingerprint([
        'crypto-lending:mainnet-balance-two-source-agreement:v1',
        MAINNET_BALANCE_TWO_SOURCE_AGREEMENT_VERSION,
        MAINNET_BALANCE_TWO_SOURCE_AGREEMENT_USE,
        request.accountId,
        observationCandidate,
        agreementWithoutFingerprint,
      ]),
    });
    return deepFreeze({
      agreementVersion: MAINNET_BALANCE_TWO_SOURCE_AGREEMENT_VERSION,
      use: MAINNET_BALANCE_TWO_SOURCE_AGREEMENT_USE,
      mayPersist: false,
      mayAuthorizeFinancialAction: false,
      accountId: request.accountId,
      observationCandidate,
      agreement,
    });
  }
}

function parseRegistry(input: unknown): MainnetBalanceSourcePairRegistryV1 {
  const record = exactRecord(
    input,
    ['schemaVersion', 'environment', 'approvalStatus', 'pairs', 'fingerprintSha256'],
    'INVALID_CONFIGURATION',
  );
  const content = parseRegistryContent({
    schemaVersion: record.schemaVersion,
    environment: record.environment,
    approvalStatus: record.approvalStatus,
    pairs: record.pairs,
  });
  if (
    typeof record.fingerprintSha256 !== 'string' ||
    !SHA256.test(record.fingerprintSha256) ||
    record.fingerprintSha256 !== registryFingerprint(content)
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  return deepFreeze({ ...content, fingerprintSha256: record.fingerprintSha256 });
}

function parseRegistryContent(input: unknown): MainnetBalanceSourcePairRegistryContentV1 {
  const record = exactRecord(
    input,
    ['schemaVersion', 'environment', 'approvalStatus', 'pairs'],
    'INVALID_CONFIGURATION',
  );
  if (
    record.schemaVersion !== MAINNET_BALANCE_TWO_SOURCE_AGREEMENT_VERSION ||
    record.environment !== 'MAINNET' ||
    (record.approvalStatus !== 'NOT_APPROVED' && record.approvalStatus !== 'APPROVED')
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  const pairs = dataArray(record.pairs, 2, 'INVALID_CONFIGURATION').map(parsePair);
  pairs.sort((left, right) => compare(left.networkId, right.networkId));
  if (
    new Set(pairs.map(({ networkId }) => networkId)).size !== pairs.length ||
    (record.approvalStatus === 'NOT_APPROVED' && pairs.length !== 0) ||
    (record.approvalStatus === 'APPROVED' &&
      (pairs.length !== 2 ||
        !pairs.some(
          ({ networkId }) => networkId === ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID,
        ) ||
        !pairs.some(({ networkId }) => networkId === SOLANA_MAINNET_BALANCE_AGREEMENT_NETWORK_ID)))
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  return deepFreeze({
    schemaVersion: MAINNET_BALANCE_TWO_SOURCE_AGREEMENT_VERSION,
    environment: 'MAINNET',
    approvalStatus: record.approvalStatus,
    pairs: Object.freeze(pairs),
  });
}

function parsePair(value: unknown): MainnetBalanceSourcePairV1 {
  const record = exactRecord(
    value,
    ['networkId', 'approvedAt', 'expiresAt', 'primary', 'corroborating'],
    'INVALID_CONFIGURATION',
  );
  const networkId = mainnetNetwork(record.networkId, 'INVALID_CONFIGURATION');
  const approvedAt = timestamp(record.approvedAt, 'INVALID_CONFIGURATION');
  const expiresAt = timestamp(record.expiresAt, 'INVALID_CONFIGURATION');
  const primary = sourceIdentity(record.primary);
  const corroborating = sourceIdentity(record.corroborating);
  if (
    approvedAt.milliseconds >= expiresAt.milliseconds ||
    primary.sourceFamilyId === corroborating.sourceFamilyId ||
    primary.sourceId === corroborating.sourceId
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  return deepFreeze({
    networkId,
    approvedAt: approvedAt.timestamp,
    expiresAt: expiresAt.timestamp,
    primary,
    corroborating,
  });
}

function sourceIdentity(value: unknown): MainnetBalanceAgreementSourceIdentityV1 {
  const record = exactRecord(value, ['sourceFamilyId', 'sourceId'], 'INVALID_CONFIGURATION');
  if (
    typeof record.sourceFamilyId !== 'string' ||
    !SAFE_SOURCE_ID.test(record.sourceFamilyId) ||
    typeof record.sourceId !== 'string' ||
    !SAFE_SOURCE_ID.test(record.sourceId)
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  return Object.freeze({
    sourceFamilyId: record.sourceFamilyId,
    sourceId: record.sourceId,
  });
}

function normalizeBindings(
  input: readonly MainnetBalanceAgreementSourceBinding[],
  registry: MainnetBalanceSourcePairRegistryV1,
): readonly NormalizedSourceBinding[] {
  const bindings = dataArray(input, 4, 'INVALID_CONFIGURATION').map((value) => {
    const record = exactRecord(
      value,
      ['networkId', 'role', 'sourceFamilyId', 'sourceId', 'reader'],
      'INVALID_CONFIGURATION',
    );
    const networkId = mainnetNetwork(record.networkId, 'INVALID_CONFIGURATION');
    if (
      (record.role !== 'PRIMARY' && record.role !== 'CORROBORATING') ||
      typeof record.sourceFamilyId !== 'string' ||
      !SAFE_SOURCE_ID.test(record.sourceFamilyId) ||
      typeof record.sourceId !== 'string' ||
      !SAFE_SOURCE_ID.test(record.sourceId)
    ) {
      return fail('INVALID_CONFIGURATION');
    }
    const capturedReader = captureDataMethod(record.reader, 'readCurrent', 'INVALID_CONFIGURATION');
    return Object.freeze({
      networkId,
      role: record.role,
      sourceFamilyId: record.sourceFamilyId,
      sourceId: record.sourceId,
      readerIdentity: capturedReader.receiver,
      readCurrent: async (request: BalanceIndexerReadRequest): Promise<unknown> =>
        Reflect.apply(capturedReader.method, capturedReader.receiver, [request]),
    });
  });
  const expected = registry.pairs.flatMap((pair) => [
    bindingIdentity(pair, 'PRIMARY'),
    bindingIdentity(pair, 'CORROBORATING'),
  ]);
  const actualKeys = bindings.map(bindingKey);
  if (
    bindings.length !== expected.length ||
    new Set(actualKeys).size !== actualKeys.length ||
    new Set(bindings.map(({ readerIdentity }) => readerIdentity)).size !== bindings.length ||
    expected.some((identity) => !actualKeys.includes(bindingKey(identity)))
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  return Object.freeze(
    bindings.sort((left, right) => compare(bindingKey(left), bindingKey(right))),
  );
}

function bindingIdentity(
  pair: MainnetBalanceSourcePairV1,
  role: MainnetBalanceAgreementSourceRole,
): Omit<MainnetBalanceAgreementSourceBinding, 'reader'> {
  const identity = role === 'PRIMARY' ? pair.primary : pair.corroborating;
  return {
    networkId: pair.networkId,
    role,
    sourceFamilyId: identity.sourceFamilyId,
    sourceId: identity.sourceId,
  };
}

function bindingKey(value: Omit<MainnetBalanceAgreementSourceBinding, 'reader'>): string {
  return [value.networkId, value.role, value.sourceFamilyId, value.sourceId].join('\0');
}

function parseRequest(value: unknown): BalanceIndexerReadRequest & {
  readonly networkId: MainnetBalanceAgreementNetworkId;
  readonly tier: 'FINANCIAL';
  readonly selector: 'finalized';
} {
  const record = exactRecord(
    value,
    ['accountId', 'walletId', 'networkId', 'tier', 'selector'],
    'INVALID_REQUEST',
  );
  if (
    typeof record.networkId !== 'string' ||
    (record.networkId !== ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID &&
      record.networkId !== SOLANA_MAINNET_BALANCE_AGREEMENT_NETWORK_ID)
  ) {
    return fail('UNSUPPORTED_CHAIN');
  }
  if (
    typeof record.accountId !== 'string' ||
    !UUID_V4.test(record.accountId) ||
    typeof record.walletId !== 'string' ||
    !UUID_V4.test(record.walletId) ||
    record.tier !== 'FINANCIAL' ||
    record.selector !== 'finalized'
  ) {
    return fail('INVALID_REQUEST');
  }
  return Object.freeze({
    accountId: record.accountId,
    walletId: record.walletId,
    networkId: record.networkId,
    tier: 'FINANCIAL',
    selector: 'finalized',
  });
}

function trustedCurrentPair(
  registry: MainnetBalanceSourcePairRegistryV1,
  networkId: MainnetBalanceAgreementNetworkId,
  nowMilliseconds: number,
): MainnetBalanceSourcePairV1 {
  const pair = registry.pairs.find((candidate) => candidate.networkId === networkId);
  if (
    registry.approvalStatus !== 'APPROVED' ||
    !pair ||
    nowMilliseconds < Date.parse(pair.approvedAt) ||
    nowMilliseconds >= Date.parse(pair.expiresAt)
  ) {
    return fail('UNTRUSTED_SOURCE_IDENTITY');
  }
  return pair;
}

function bindingFor(
  bindings: readonly NormalizedSourceBinding[],
  pair: MainnetBalanceSourcePairV1,
  role: MainnetBalanceAgreementSourceRole,
): NormalizedSourceBinding {
  const expected = bindingKey(bindingIdentity(pair, role));
  const binding = bindings.find((candidate) => bindingKey(candidate) === expected);
  if (!binding) return fail('UNTRUSTED_SOURCE_IDENTITY');
  return binding;
}

function parseCandidate(
  value: unknown,
  request: BalanceIndexerReadRequest & { readonly networkId: MainnetBalanceAgreementNetworkId },
  evaluatedAtMilliseconds: number,
): ParsedSourceCandidate {
  const record = exactRecord(
    value,
    ['walletId', 'networkId', 'tier', 'source', 'positions'],
    'SOURCE_DATA_INVALID',
  );
  if (
    record.walletId !== request.walletId ||
    record.networkId !== request.networkId ||
    record.tier !== request.tier
  ) {
    return fail('SOURCE_DATA_INVALID');
  }
  const source = parseSource(record.source, request, evaluatedAtMilliseconds);
  const checkpoint = checkpointFor(request.networkId, source);
  const positions = parsePositions(
    record.positions,
    request.accountId,
    request.walletId,
    request.networkId,
  );
  return Object.freeze({
    source,
    checkpoint,
    positions,
    positionSetFingerprintSha256: positionSetFingerprint(request.networkId, positions),
  });
}

function parseSource(
  value: unknown,
  request: BalanceIndexerReadRequest & { readonly networkId: MainnetBalanceAgreementNetworkId },
  evaluatedAtMilliseconds: number,
): BalanceIndexerSourceCandidate {
  const record = exactRecord(
    value,
    ['position', 'hash', 'parentHash', 'selector', 'retrievedAt', 'identityValidated'],
    'SOURCE_DATA_INVALID',
  );
  if (record.selector !== request.selector || record.identityValidated !== true) {
    return fail('SOURCE_DATA_INVALID');
  }
  const position = canonicalUint64(record.position, 'SOURCE_DATA_INVALID');
  if (position === '0') return fail('SOURCE_DATA_INVALID');
  const retrievedAt = timestamp(record.retrievedAt, 'SOURCE_DATA_INVALID');
  const policy = chainObservationPolicyForNetwork(request.networkId);
  if (
    !policy ||
    policy.environment !== 'MAINNET' ||
    retrievedAt.milliseconds > evaluatedAtMilliseconds ||
    evaluatedAtMilliseconds - retrievedAt.milliseconds > policy.freshness.currentWithinMs
  ) {
    return fail('SOURCE_STALE');
  }
  let hash: string;
  let parentHash: string;
  if (request.networkId === ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID) {
    if (
      typeof record.hash !== 'string' ||
      !EVM_BLOCK_HASH.test(record.hash) ||
      record.hash === ZERO_EVM_BLOCK_HASH ||
      typeof record.parentHash !== 'string' ||
      !EVM_BLOCK_HASH.test(record.parentHash) ||
      record.parentHash === ZERO_EVM_BLOCK_HASH ||
      record.hash === record.parentHash
    ) {
      return fail('SOURCE_DATA_INVALID');
    }
    hash = record.hash;
    parentHash = record.parentHash;
  } else {
    if (
      typeof record.hash !== 'string' ||
      !SOLANA_BLOCK_IDENTITY.test(record.hash) ||
      record.hash === ZERO_SOLANA_IDENTITY ||
      typeof record.parentHash !== 'string' ||
      !SOLANA_BLOCK_IDENTITY.test(record.parentHash) ||
      record.parentHash === ZERO_SOLANA_IDENTITY ||
      record.hash === record.parentHash
    ) {
      return fail('SOURCE_DATA_INVALID');
    }
    hash = record.hash;
    parentHash = record.parentHash;
  }
  return Object.freeze({
    position,
    hash,
    parentHash,
    selector: 'finalized',
    retrievedAt: retrievedAt.timestamp,
    identityValidated: true,
  });
}

function checkpointFor(
  networkId: MainnetBalanceAgreementNetworkId,
  source: BalanceIndexerSourceCandidate,
): MainnetBalanceAgreementCheckpointV1 {
  if (networkId === ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID) {
    return Object.freeze({
      kind: 'ETHEREUM_BLOCK',
      blockNumber: source.position,
      blockHash: source.hash,
      parentBlockHash: source.parentHash,
    });
  }
  return Object.freeze({
    kind: 'SOLANA_ROOTED_BLOCK',
    finalizedSlot: source.position,
    blockIdentity: source.hash,
    parentBlockIdentity: source.parentHash,
    rootSlot: source.position,
    rootDerivation: 'FINALIZED_SLOT_IS_ROOTED',
  });
}

function parsePositions(
  value: unknown,
  accountId: string,
  walletId: string,
  networkId: MainnetBalanceAgreementNetworkId,
): readonly BalanceSyncPosition[] {
  const positions = dataArray(
    value,
    BALANCE_SYNC_POLICY.maximumPositionsPerObservation,
    'SOURCE_DATA_INVALID',
  ).map((candidate) => {
    const record = exactRecord(
      candidate,
      ['positionId', 'stablecoin', 'assetIdentity', 'amountAtomic'],
      'SOURCE_DATA_INVALID',
    );
    if (
      typeof record.positionId !== 'string' ||
      !SHA256.test(record.positionId) ||
      typeof record.stablecoin !== 'string' ||
      typeof record.assetIdentity !== 'string'
    ) {
      return fail('SOURCE_DATA_INVALID');
    }
    const asset = MAINNET_SUPPORTED_ASSET_REGISTRY.normalizeAsset(networkId, record.assetIdentity);
    if (
      !asset ||
      asset.stablecoin !== record.stablecoin ||
      asset.identity !== record.assetIdentity ||
      record.positionId !== canonicalPositionId([accountId, walletId, networkId, asset.identity])
    ) {
      return fail('SOURCE_DATA_INVALID');
    }
    let amountAtomic: string;
    try {
      amountAtomic = normalizeBalanceSyncPosition(record.amountAtomic);
    } catch {
      return fail('SOURCE_DATA_INVALID');
    }
    return Object.freeze({
      positionId: record.positionId,
      stablecoin: asset.stablecoin,
      assetIdentity: asset.identity,
      amountAtomic,
    });
  });
  positions.sort((left, right) => compare(left.assetIdentity, right.assetIdentity));
  const expectedAssets = MAINNET_SUPPORTED_ASSET_REGISTRY.latest.assets
    .filter(
      ({ activationState, networkId: assetNetworkId }) =>
        activationState === 'ACTIVE' && assetNetworkId === networkId,
    )
    .map(({ identity }) => identity)
    .sort(compare);
  if (
    positions.length !== expectedAssets.length ||
    new Set(positions.map(({ positionId }) => positionId)).size !== positions.length ||
    new Set(positions.map(({ assetIdentity }) => assetIdentity)).size !== positions.length ||
    positions.some(({ assetIdentity }, index) => assetIdentity !== expectedAssets[index])
  ) {
    return fail('SOURCE_DATA_INVALID');
  }
  return Object.freeze(positions);
}

function positionSetFingerprint(
  networkId: MainnetBalanceAgreementNetworkId,
  positions: readonly BalanceSyncPosition[],
): string {
  return fingerprint([
    'crypto-lending:mainnet-balance-position-set:v1',
    networkId,
    positions.map(({ positionId, stablecoin, assetIdentity, amountAtomic }) => [
      positionId,
      stablecoin,
      assetIdentity,
      amountAtomic,
    ]),
  ]);
}

function sourceAttestation(
  binding: NormalizedSourceBinding,
  request: BalanceIndexerReadRequest & { readonly networkId: MainnetBalanceAgreementNetworkId },
  candidate: ParsedSourceCandidate,
  registryFingerprintSha256: string,
): MainnetBalanceSourceAttestationV1 {
  const material = [
    'crypto-lending:mainnet-balance-source-attestation:v1',
    registryFingerprintSha256,
    request.accountId,
    request.walletId,
    request.networkId,
    request.tier,
    request.selector,
    binding.role,
    binding.sourceFamilyId,
    binding.sourceId,
    candidate.source,
    candidate.checkpoint,
    candidate.positionSetFingerprintSha256,
  ];
  return deepFreeze({
    role: binding.role,
    sourceFamilyId: binding.sourceFamilyId,
    sourceId: binding.sourceId,
    networkId: request.networkId,
    retrievedAt: candidate.source.retrievedAt,
    chainIdentityValidated: true,
    checkpoint: candidate.checkpoint,
    positionSetFingerprintSha256: candidate.positionSetFingerprintSha256,
    candidateFingerprintSha256: fingerprint(material),
  });
}

function mainnetNetwork(
  value: unknown,
  code: MainnetBalanceTwoSourceAgreementFailureCode,
): MainnetBalanceAgreementNetworkId {
  if (
    value !== ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID &&
    value !== SOLANA_MAINNET_BALANCE_AGREEMENT_NETWORK_ID
  ) {
    return fail(code);
  }
  return value;
}

function canonicalUint64(
  value: unknown,
  code: MainnetBalanceTwoSourceAgreementFailureCode,
): string {
  if (
    typeof value !== 'string' ||
    !CANONICAL_UINT.test(value) ||
    value.length > MAX_UINT64.toString().length
  ) {
    return fail(code);
  }
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    return fail(code);
  }
  if (parsed > MAX_UINT64) return fail(code);
  return value;
}

function clockTime(now: () => Date): CanonicalTime {
  let value: Date;
  try {
    value = now();
  } catch {
    return fail('INVALID_CONFIGURATION');
  }
  try {
    if (isProxy(value) || Object.getPrototypeOf(value) !== Date.prototype) {
      return fail('INVALID_CONFIGURATION');
    }
    const milliseconds = Date.prototype.getTime.call(value);
    if (!Number.isFinite(milliseconds)) return fail('INVALID_CONFIGURATION');
    return Object.freeze({
      timestamp: Date.prototype.toISOString.call(value),
      milliseconds,
    });
  } catch (error) {
    if (error instanceof MainnetBalanceTwoSourceAgreementUnavailableError) throw error;
    return fail('INVALID_CONFIGURATION');
  }
}

function timestamp(
  value: unknown,
  code: MainnetBalanceTwoSourceAgreementFailureCode,
): CanonicalTime {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) return fail(code);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail(code);
  }
  return Object.freeze({ timestamp: value, milliseconds });
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  code: MainnetBalanceTwoSourceAgreementFailureCode,
): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || isProxy(value) || Array.isArray(value)) {
      return fail(code);
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      return fail(code);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== keys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return fail(code);
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        return fail(code);
      }
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof MainnetBalanceTwoSourceAgreementUnavailableError) throw error;
    return fail(code);
  }
}

function dataArray(
  value: unknown,
  maximumLength: number,
  code: MainnetBalanceTwoSourceAgreementFailureCode,
): unknown[] {
  try {
    if (typeof value !== 'object' || value === null || isProxy(value) || !Array.isArray(value)) {
      return fail(code);
    }
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      return fail(code);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = descriptors['length'];
    if (
      !lengthDescriptor ||
      !('value' in lengthDescriptor) ||
      typeof lengthDescriptor.value !== 'number' ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maximumLength ||
      lengthDescriptor.enumerable
    ) {
      return fail(code);
    }
    const length = lengthDescriptor.value;
    const expectedKeys = [...Array.from({ length }, (_, index) => String(index)), 'length'];
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail(code);
    }
    return Array.from({ length }, (_, index) => {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        return fail(code);
      }
      return descriptor.value;
    });
  } catch (error) {
    if (error instanceof MainnetBalanceTwoSourceAgreementUnavailableError) throw error;
    return fail(code);
  }
}

function captureDataMethod(
  value: unknown,
  methodName: string,
  code: MainnetBalanceTwoSourceAgreementFailureCode,
): CapturedDataMethod {
  try {
    if (typeof value !== 'object' || value === null || isProxy(value)) return fail(code);
    const receiver = value;
    let owner: object | null = receiver;
    let depth = 0;
    while (owner !== null && owner !== Object.prototype && depth < 8) {
      if (isProxy(owner)) return fail(code);
      const descriptor = Object.getOwnPropertyDescriptor(owner, methodName);
      if (descriptor) {
        if (
          !('value' in descriptor) ||
          typeof descriptor.value !== 'function' ||
          isProxy(descriptor.value)
        ) {
          return fail(code);
        }
        return Object.freeze({
          receiver,
          method: descriptor.value as (...arguments_: readonly unknown[]) => unknown,
        });
      }
      owner = Object.getPrototypeOf(owner) as object | null;
      depth += 1;
    }
    return fail(code);
  } catch (error) {
    if (error instanceof MainnetBalanceTwoSourceAgreementUnavailableError) throw error;
    return fail(code);
  }
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort(compare)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<const Value>(value: Value): Readonly<Value> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
