export const LAB_CONNECTOR_IDS = [
  'unapproved',
  'metamask',
  'coinbase',
  'walletconnect',
  'phantom',
] as const;

export const LAB_CHAIN_IDS = [
  'eip155:11155111',
  'eip155:84532',
  'evm:unsupported',
  'solana:devnet',
] as const;

export const LAB_EVENT_KINDS = [
  'connect',
  'reject',
  'restore',
  'account-change',
  'chain-change',
  'ownership-proof',
  'session-update',
  'session-delete',
  'session-expire',
  'pairing-expire',
  'qr-display',
  'mobile-return',
  'offline',
  'online',
  'disconnect',
] as const;

export const LAB_RUN_RESULTS = ['pass', 'fail', 'blocked', 'deferred'] as const;

export const LAB_ENVIRONMENT_IDS = ['D1', 'D2', 'D3', 'P1', 'A1', 'S1', 'H1'] as const;

export const LAB_ALLOWED_NETWORKS = ['eip155:11155111', 'eip155:84532', 'solana:devnet'] as const;

export const LAB_TERMS_ACKNOWLEDGEMENT_STATES = [
  'not-applicable',
  'accepted',
  'not-accepted',
] as const;

export type LabConnectorId = (typeof LAB_CONNECTOR_IDS)[number];
export type LabChainId = (typeof LAB_CHAIN_IDS)[number];
export type LabEventKind = (typeof LAB_EVENT_KINDS)[number];
export type LabEventOutcome = 'accepted' | 'rejected' | 'blocked' | 'cleared';
export type LabChainContext = 'observed' | 'requested';
export type LabRunResult = (typeof LAB_RUN_RESULTS)[number];
export type LabEnvironmentId = (typeof LAB_ENVIRONMENT_IDS)[number];
export type LabAllowedNetwork = (typeof LAB_ALLOWED_NETWORKS)[number];
export type LabTermsAcknowledgementState = (typeof LAB_TERMS_ACKNOWLEDGEMENT_STATES)[number];

export interface LabEvidenceEvent {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly connectorId: LabConnectorId;
  readonly chainId: LabChainId;
  readonly chainContext: LabChainContext;
  readonly kind: LabEventKind;
  readonly outcome: LabEventOutcome;
  readonly accountObserved: boolean;
  readonly evidenceMode: 'sanitized-real-wallet';
}

export interface LabSoftwareIdentity {
  readonly name: string;
  readonly version: string;
}

export interface LabAuditSnapshot {
  readonly reference: string;
  readonly date: string;
}

export interface LabEvidenceRunInput {
  readonly runId: string;
  readonly caseId: string;
  readonly result: LabRunResult;
  readonly tester: string;
  readonly candidateCommit: string;
  readonly lockSha256: string;
  readonly environmentId: LabEnvironmentId;
  readonly os: LabSoftwareIdentity;
  readonly browser: LabSoftwareIdentity;
  readonly wallet: LabSoftwareIdentity;
  readonly network: LabAllowedNetwork;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly termsAcknowledgement: LabTermsAcknowledgementState;
  readonly auditSnapshot: LabAuditSnapshot;
  readonly sanitizedEvidenceLinks?: readonly string[];
  readonly jiraFollowUps?: readonly string[];
  readonly events: readonly LabEvidenceEvent[];
}

export interface LabEvidenceRun extends LabEvidenceRunInput {
  readonly schemaVersion: 2;
  readonly classification: 'sanitized-testnet-wallet-run-evidence';
  readonly containsAddresses: false;
  readonly containsSignatures: false;
  readonly containsPairingData: false;
  readonly containsWalletSecrets: false;
}

const connectorIds = new Set<string>(LAB_CONNECTOR_IDS);
const chainIds = new Set<string>(LAB_CHAIN_IDS);
const eventKinds = new Set<string>(LAB_EVENT_KINDS);
const eventOutcomes = new Set<string>(['accepted', 'rejected', 'blocked', 'cleared']);
const chainContexts = new Set<string>(['observed', 'requested']);
const runResults = new Set<string>(LAB_RUN_RESULTS);
const environmentIds = new Set<string>(LAB_ENVIRONMENT_IDS);
const allowedNetworks = new Set<string>(LAB_ALLOWED_NETWORKS);
const termsAcknowledgementStates = new Set<string>(LAB_TERMS_ACKNOWLEDGEMENT_STATES);
const MAX_EVENTS = 250;
const MAX_LINKS = 25;
const MAX_JIRA_FOLLOW_UPS = 25;
const MAX_REFERENCE_LENGTH = 500;
const MAX_SERIALIZED_LENGTH = 250_000;

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const CASE_ID_PATTERN = /^[A-Z][A-Z0-9-]{1,39}$/;
const TESTER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._@+-]{0,79}$/;
const SOFTWARE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .()+/_-]{0,79}$/;
const SOFTWARE_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .()+/_-]{0,39}$/;
const CANDIDATE_COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const LOCK_SHA_256_PATTERN = /^[0-9a-f]{64}$/i;
const JIRA_KEY_PATTERN = /^KAN-[1-9][0-9]{0,7}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RELATIVE_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,499}$/;

const EVENT_RECORD_KEYS = [
  'schemaVersion',
  'eventId',
  'occurredAt',
  'connectorId',
  'chainId',
  'chainContext',
  'kind',
  'outcome',
  'accountObserved',
  'evidenceMode',
] as const;

const V1_ENVELOPE_KEYS = [
  'schemaVersion',
  'exportedAt',
  'classification',
  'containsAddresses',
  'containsSignatures',
  'containsPairingData',
  'containsWalletSecrets',
  'events',
] as const;

const RUN_RECORD_REQUIRED_KEYS = [
  'schemaVersion',
  'classification',
  'containsAddresses',
  'containsSignatures',
  'containsPairingData',
  'containsWalletSecrets',
  'runId',
  'caseId',
  'result',
  'tester',
  'candidateCommit',
  'lockSha256',
  'environmentId',
  'os',
  'browser',
  'wallet',
  'network',
  'startedAt',
  'completedAt',
  'termsAcknowledgement',
  'auditSnapshot',
  'events',
] as const;

const RUN_RECORD_OPTIONAL_KEYS = ['sanitizedEvidenceLinks', 'jiraFollowUps', 'exportedAt'] as const;

type UnknownRecord = Record<string, unknown>;

function requireRecord(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid.`);
  }

  return value as UnknownRecord;
}

function requireExactKeys(
  record: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    Object.keys(record).some((key) => !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(record, key))
  ) {
    throw new TypeError('Serialized evidence contains unknown or missing fields.');
  }
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isCanonicalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateSoftwareIdentity(
  label: 'OS' | 'browser' | 'wallet',
  identity: LabSoftwareIdentity,
): LabSoftwareIdentity {
  if (
    typeof identity !== 'object' ||
    identity === null ||
    typeof identity.name !== 'string' ||
    typeof identity.version !== 'string' ||
    !SOFTWARE_NAME_PATTERN.test(identity.name) ||
    !SOFTWARE_VERSION_PATTERN.test(identity.version)
  ) {
    throw new TypeError(`${label} name or version is invalid.`);
  }

  return Object.freeze({ name: identity.name, version: identity.version });
}

function containsUnsafeReferenceCharacter(reference: string): boolean {
  return Array.from(reference).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 || character === '#' || character === '\\';
  });
}

function isSafeEvidenceReference(reference: string): boolean {
  if (
    typeof reference !== 'string' ||
    reference.length === 0 ||
    reference.length > MAX_REFERENCE_LENGTH ||
    containsUnsafeReferenceCharacter(reference)
  ) {
    return false;
  }

  if (reference.startsWith('https://')) {
    try {
      const url = new URL(reference);
      return (
        url.protocol === 'https:' &&
        url.hostname.length > 0 &&
        url.username === '' &&
        url.password === '' &&
        url.hash === ''
      );
    } catch {
      return false;
    }
  }

  if (!RELATIVE_PATH_PATTERN.test(reference) || reference.includes('?')) return false;

  return reference
    .split('/')
    .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function validateEvidenceReferences(references: readonly string[]): readonly string[] {
  if (!Array.isArray(references) || references.length > MAX_LINKS) {
    throw new RangeError(`Sanitized evidence is limited to ${MAX_LINKS} links.`);
  }
  if (!references.every(isSafeEvidenceReference)) {
    throw new TypeError('Sanitized evidence link is unsafe.');
  }
  if (new Set(references).size !== references.length) {
    throw new TypeError('Sanitized evidence links must be unique.');
  }

  return Object.freeze([...references]);
}

function validateJiraFollowUps(keys: readonly string[]): readonly string[] {
  if (!Array.isArray(keys) || keys.length > MAX_JIRA_FOLLOW_UPS) {
    throw new RangeError(`Evidence is limited to ${MAX_JIRA_FOLLOW_UPS} Jira follow-ups.`);
  }
  if (!keys.every((key) => typeof key === 'string' && JIRA_KEY_PATTERN.test(key))) {
    throw new TypeError('Jira follow-up must be a KAN issue key.');
  }
  if (new Set(keys).size !== keys.length) {
    throw new TypeError('Jira follow-ups must be unique.');
  }

  return Object.freeze([...keys]);
}

function validateAuditSnapshot(snapshot: LabAuditSnapshot): LabAuditSnapshot {
  if (typeof snapshot !== 'object' || snapshot === null) {
    throw new TypeError('Audit snapshot is invalid.');
  }
  if (!isSafeEvidenceReference(snapshot.reference)) {
    throw new TypeError('Audit snapshot reference is unsafe.');
  }
  if (!isCanonicalDate(snapshot.date)) {
    throw new TypeError('Audit snapshot date must be a canonical UTC date.');
  }

  return Object.freeze({ reference: snapshot.reference, date: snapshot.date });
}

function restoreSoftwareIdentity(value: unknown, label: string): LabSoftwareIdentity {
  const record = requireRecord(value, label);
  requireExactKeys(record, ['name', 'version']);

  return {
    name: record.name as string,
    version: record.version as string,
  };
}

function restoreAuditSnapshot(value: unknown): LabAuditSnapshot {
  const record = requireRecord(value, 'Audit snapshot');
  requireExactKeys(record, ['reference', 'date']);

  return {
    reference: record.reference as string,
    date: record.date as string,
  };
}

function restoreEvidenceEvent(value: unknown): LabEvidenceEvent {
  const record = requireRecord(value, 'Serialized evidence event');
  requireExactKeys(record, EVENT_RECORD_KEYS);
  if (record.schemaVersion !== 1 || record.evidenceMode !== 'sanitized-real-wallet') {
    throw new TypeError('Serialized evidence event schema is invalid.');
  }

  return createLabEvidenceEvent({
    eventId: record.eventId as string,
    occurredAt: record.occurredAt as string,
    connectorId: record.connectorId as LabConnectorId,
    chainId: record.chainId as LabChainId,
    chainContext: record.chainContext as LabChainContext,
    kind: record.kind as LabEventKind,
    outcome: record.outcome as LabEventOutcome,
    accountObserved: record.accountObserved as boolean,
  });
}

function restoreEvidenceEventArray(value: unknown): readonly LabEvidenceEvent[] {
  if (!Array.isArray(value) || value.length > MAX_EVENTS) {
    throw new RangeError(`Evidence is limited to ${MAX_EVENTS} events.`);
  }

  return Object.freeze(value.map(restoreEvidenceEvent));
}

function requireSafetyEnvelope(record: UnknownRecord, version: 1 | 2): void {
  const classification =
    version === 1 ? 'sanitized-testnet-wallet-evidence' : 'sanitized-testnet-wallet-run-evidence';
  if (
    record.schemaVersion !== version ||
    record.classification !== classification ||
    record.containsAddresses !== false ||
    record.containsSignatures !== false ||
    record.containsPairingData !== false ||
    record.containsWalletSecrets !== false
  ) {
    throw new TypeError('Serialized evidence safety envelope is invalid.');
  }
}

function parseSerializedEvidence(serialized: string): unknown {
  if (
    typeof serialized !== 'string' ||
    serialized.length === 0 ||
    serialized.length > MAX_SERIALIZED_LENGTH
  ) {
    throw new RangeError('Serialized evidence is empty or too large.');
  }

  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    throw new TypeError('Serialized evidence is not valid JSON.');
  }
}

export function createLabEvidenceEvent(input: {
  eventId: string;
  occurredAt: string;
  connectorId: LabConnectorId;
  chainId: LabChainId;
  chainContext: LabChainContext;
  kind: LabEventKind;
  outcome: LabEventOutcome;
  accountObserved?: boolean;
}): LabEvidenceEvent {
  if (typeof input !== 'object' || input === null) {
    throw new TypeError('Evidence event is invalid.');
  }
  if (typeof input.eventId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(input.eventId)) {
    throw new TypeError('Evidence event ID is invalid.');
  }
  if (!isCanonicalTimestamp(input.occurredAt)) {
    throw new TypeError('Evidence timestamp must be canonical UTC.');
  }
  if (!connectorIds.has(input.connectorId) || !chainIds.has(input.chainId)) {
    throw new TypeError('Evidence connector or chain is not allowlisted.');
  }
  if (!eventKinds.has(input.kind) || !eventOutcomes.has(input.outcome)) {
    throw new TypeError('Evidence kind or outcome is not allowlisted.');
  }
  if (!chainContexts.has(input.chainContext)) {
    throw new TypeError('Evidence chain context is not allowlisted.');
  }
  if (input.accountObserved !== undefined && typeof input.accountObserved !== 'boolean') {
    throw new TypeError('Evidence account-observed flag must be boolean.');
  }

  return Object.freeze({
    schemaVersion: 1,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
    connectorId: input.connectorId,
    chainId: input.chainId,
    chainContext: input.chainContext,
    kind: input.kind,
    outcome: input.outcome,
    accountObserved: input.accountObserved ?? false,
    evidenceMode: 'sanitized-real-wallet',
  });
}

export function exportLabEvidence(events: readonly LabEvidenceEvent[]): string {
  if (events.length > MAX_EVENTS)
    throw new RangeError(`Evidence is limited to ${MAX_EVENTS} events.`);

  const validated = events.map((event) => createLabEvidenceEvent(event));
  return JSON.stringify(
    {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      classification: 'sanitized-testnet-wallet-evidence',
      containsAddresses: false,
      containsSignatures: false,
      containsPairingData: false,
      containsWalletSecrets: false,
      events: validated,
    },
    null,
    2,
  );
}

export function createLabEvidenceRun(input: LabEvidenceRunInput): LabEvidenceRun {
  if (typeof input !== 'object' || input === null) {
    throw new TypeError('Evidence run is invalid.');
  }
  if (typeof input.runId !== 'string' || !RUN_ID_PATTERN.test(input.runId)) {
    throw new TypeError('Evidence run ID is invalid.');
  }
  if (typeof input.caseId !== 'string' || !CASE_ID_PATTERN.test(input.caseId)) {
    throw new TypeError('Evidence case ID is invalid.');
  }
  if (!runResults.has(input.result)) {
    throw new TypeError('Evidence run result is not allowlisted.');
  }
  if (typeof input.tester !== 'string' || !TESTER_PATTERN.test(input.tester)) {
    throw new TypeError('Evidence tester is invalid.');
  }
  if (
    typeof input.candidateCommit !== 'string' ||
    !CANDIDATE_COMMIT_PATTERN.test(input.candidateCommit)
  ) {
    throw new TypeError('Candidate commit must be a 40-character hexadecimal hash.');
  }
  if (typeof input.lockSha256 !== 'string' || !LOCK_SHA_256_PATTERN.test(input.lockSha256)) {
    throw new TypeError('Package lock SHA-256 must be a 64-character hexadecimal hash.');
  }
  if (!environmentIds.has(input.environmentId)) {
    throw new TypeError('Evidence environment ID is not allowlisted.');
  }
  if (!allowedNetworks.has(input.network)) {
    throw new TypeError('Evidence network is not allowlisted.');
  }
  if (!isCanonicalTimestamp(input.startedAt) || !isCanonicalTimestamp(input.completedAt)) {
    throw new TypeError('Evidence run timestamps must be canonical UTC.');
  }

  const startedAt = new Date(input.startedAt).getTime();
  const completedAt = new Date(input.completedAt).getTime();
  if (completedAt < startedAt) {
    throw new RangeError('Evidence run cannot complete before it starts.');
  }
  if (!termsAcknowledgementStates.has(input.termsAcknowledgement)) {
    throw new TypeError('Terms acknowledgement state is not allowlisted.');
  }
  if (!Array.isArray(input.events) || input.events.length > MAX_EVENTS) {
    throw new RangeError(`Evidence is limited to ${MAX_EVENTS} events.`);
  }

  const events = input.events.map((event) => createLabEvidenceEvent(event));
  if (new Set(events.map((event) => event.eventId)).size !== events.length) {
    throw new TypeError('Evidence event IDs must be unique within a run.');
  }
  let previousTimestamp = startedAt;
  for (const event of events) {
    const eventTimestamp = new Date(event.occurredAt).getTime();
    if (eventTimestamp < startedAt || eventTimestamp > completedAt) {
      throw new RangeError('Evidence event timestamp is outside the run interval.');
    }
    if (eventTimestamp < previousTimestamp) {
      throw new RangeError('Evidence events must be ordered by timestamp.');
    }
    previousTimestamp = eventTimestamp;
  }

  const sanitizedEvidenceLinks =
    input.sanitizedEvidenceLinks === undefined
      ? undefined
      : validateEvidenceReferences(input.sanitizedEvidenceLinks);
  const jiraFollowUps =
    input.jiraFollowUps === undefined ? undefined : validateJiraFollowUps(input.jiraFollowUps);

  return Object.freeze({
    schemaVersion: 2,
    classification: 'sanitized-testnet-wallet-run-evidence',
    containsAddresses: false,
    containsSignatures: false,
    containsPairingData: false,
    containsWalletSecrets: false,
    runId: input.runId,
    caseId: input.caseId,
    result: input.result,
    tester: input.tester,
    candidateCommit: input.candidateCommit,
    lockSha256: input.lockSha256,
    environmentId: input.environmentId,
    os: validateSoftwareIdentity('OS', input.os),
    browser: validateSoftwareIdentity('browser', input.browser),
    wallet: validateSoftwareIdentity('wallet', input.wallet),
    network: input.network,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    termsAcknowledgement: input.termsAcknowledgement,
    auditSnapshot: validateAuditSnapshot(input.auditSnapshot),
    ...(sanitizedEvidenceLinks === undefined ? {} : { sanitizedEvidenceLinks }),
    ...(jiraFollowUps === undefined ? {} : { jiraFollowUps }),
    events: Object.freeze(events),
  });
}

export function exportLabEvidenceRun(input: LabEvidenceRunInput): string {
  const run = createLabEvidenceRun(input);

  return JSON.stringify(
    {
      ...run,
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}

function restoreEvidenceRunRecord(value: unknown): LabEvidenceRun {
  const record = requireRecord(value, 'Serialized evidence run');
  requireExactKeys(record, RUN_RECORD_REQUIRED_KEYS, RUN_RECORD_OPTIONAL_KEYS);
  requireSafetyEnvelope(record, 2);
  if (Object.hasOwn(record, 'exportedAt') && !isCanonicalTimestamp(record.exportedAt)) {
    throw new TypeError('Evidence export timestamp must be canonical UTC.');
  }

  const events = restoreEvidenceEventArray(record.events);

  return createLabEvidenceRun({
    runId: record.runId as string,
    caseId: record.caseId as string,
    result: record.result as LabRunResult,
    tester: record.tester as string,
    candidateCommit: record.candidateCommit as string,
    lockSha256: record.lockSha256 as string,
    environmentId: record.environmentId as LabEnvironmentId,
    os: restoreSoftwareIdentity(record.os, 'OS identity'),
    browser: restoreSoftwareIdentity(record.browser, 'Browser identity'),
    wallet: restoreSoftwareIdentity(record.wallet, 'Wallet identity'),
    network: record.network as LabAllowedNetwork,
    startedAt: record.startedAt as string,
    completedAt: record.completedAt as string,
    termsAcknowledgement: record.termsAcknowledgement as LabTermsAcknowledgementState,
    auditSnapshot: restoreAuditSnapshot(record.auditSnapshot),
    ...(Object.hasOwn(record, 'sanitizedEvidenceLinks')
      ? { sanitizedEvidenceLinks: record.sanitizedEvidenceLinks as readonly string[] }
      : {}),
    ...(Object.hasOwn(record, 'jiraFollowUps')
      ? { jiraFollowUps: record.jiraFollowUps as readonly string[] }
      : {}),
    events,
  });
}

/**
 * Rebuilds sanitized v1 events from a serialized event array, a v1 export, or a
 * complete v2 run. Unknown fields and invalid allowlist values are rejected.
 */
export function restoreLabEvidenceEvents(serialized: string): readonly LabEvidenceEvent[] {
  const value = parseSerializedEvidence(serialized);
  if (Array.isArray(value)) return restoreEvidenceEventArray(value);

  const record = requireRecord(value, 'Serialized evidence');
  if (record.schemaVersion === 2) return restoreEvidenceRunRecord(record).events;

  requireExactKeys(record, V1_ENVELOPE_KEYS);
  requireSafetyEnvelope(record, 1);
  if (!isCanonicalTimestamp(record.exportedAt)) {
    throw new TypeError('Evidence export timestamp must be canonical UTC.');
  }

  return restoreEvidenceEventArray(record.events);
}

/** Rebuilds and validates a complete serialized v2 evidence run envelope. */
export function restoreLabEvidenceRun(serialized: string): LabEvidenceRun {
  return restoreEvidenceRunRecord(parseSerializedEvidence(serialized));
}
