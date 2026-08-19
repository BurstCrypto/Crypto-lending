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

/**
 * A lab-generated, non-provider-derived identifier for one connection slot.
 * Raw provider UIDs, session topics, accounts, and wallet-supplied values must
 * never be used as a connection ID.
 */
export type LabConnectionId = string;

export interface LabEvidenceEventInput {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly connectionId: LabConnectionId;
  readonly connectorId: LabConnectorId;
  readonly chainId: LabChainId;
  readonly chainContext: LabChainContext;
  readonly kind: LabEventKind;
  readonly outcome: LabEventOutcome;
  readonly accountObserved?: boolean;
}

export interface LabEvidenceEvent {
  readonly schemaVersion: 2;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly connectionId: LabConnectionId;
  readonly connectorId: LabConnectorId;
  readonly chainId: LabChainId;
  readonly chainContext: LabChainContext;
  readonly kind: LabEventKind;
  readonly outcome: LabEventOutcome;
  readonly accountObserved: boolean;
  readonly evidenceMode: 'sanitized-real-wallet';
}

export interface LabEvidenceCandidateBinding {
  readonly candidateCommit: string;
  readonly lockSha256: string;
}

export interface LabEvidenceSessionInput extends LabEvidenceCandidateBinding {
  readonly events: readonly LabEvidenceEvent[];
}

export interface LabSoftwareIdentity {
  readonly name: string;
  readonly version: string;
}

export interface LabAuditSnapshot {
  readonly reference: string;
  readonly date: string;
}

export interface LabEvidenceConnectionInput {
  readonly connectionId: LabConnectionId;
  readonly connectorId: LabConnectorId;
  readonly wallet: LabSoftwareIdentity;
  readonly networks: readonly LabAllowedNetwork[];
}

export type LabEvidenceConnection = LabEvidenceConnectionInput;

interface LabEvidenceRunMetadataInput {
  readonly runId: string;
  readonly caseId: string;
  readonly result: LabRunResult;
  readonly tester: string;
  readonly candidateCommit: string;
  readonly lockSha256: string;
  readonly environmentId: LabEnvironmentId;
  readonly os: LabSoftwareIdentity;
  readonly browser: LabSoftwareIdentity;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly termsAcknowledgement: LabTermsAcknowledgementState;
  readonly auditSnapshot: LabAuditSnapshot;
  readonly sanitizedEvidenceLinks?: readonly string[];
  readonly jiraFollowUps?: readonly string[];
}

export interface LabEvidenceRunInput extends LabEvidenceRunMetadataInput {
  readonly connections: readonly LabEvidenceConnectionInput[];
  readonly events: readonly LabEvidenceEvent[];
}

interface LabLegacyEvidenceRunInput extends LabEvidenceRunMetadataInput {
  readonly wallet: LabSoftwareIdentity;
  readonly network: LabAllowedNetwork;
  readonly events: readonly LabEvidenceEvent[];
}

export interface LabEvidenceRun extends LabEvidenceRunMetadataInput {
  readonly schemaVersion: 3;
  readonly classification: 'sanitized-testnet-wallet-run-evidence';
  readonly containsAddresses: false;
  readonly containsSignatures: false;
  readonly containsPairingData: false;
  readonly containsWalletSecrets: false;
  readonly connections: readonly LabEvidenceConnection[];
  readonly events: readonly LabEvidenceEvent[];
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
const MAX_CONNECTIONS = LAB_CONNECTOR_IDS.length;
const MAX_LINKS = 25;
const MAX_JIRA_FOLLOW_UPS = 25;
const MAX_REFERENCE_LENGTH = 500;
const MAX_SERIALIZED_LENGTH = 250_000;

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const CASE_ID_PATTERN = /^[A-Z][A-Z0-9-]{1,39}$/;
const CONNECTION_ID_PATTERN = /^conn_[A-Za-z0-9_-]{1,75}$/;
const EVENT_ID_PATTERN =
  /^evt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TESTER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._@+-]{0,79}$/;
const SOFTWARE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .()+/_-]{0,79}$/;
const SOFTWARE_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .()+/_-]{0,39}$/;
const CANDIDATE_COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const LOCK_SHA_256_PATTERN = /^[0-9a-f]{64}$/i;
const JIRA_KEY_PATTERN = /^KAN-[1-9][0-9]{0,7}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RELATIVE_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,499}$/;
const EVM_ADDRESS_PATTERN = /0x[0-9a-f]{40}(?![0-9a-f])/iu;
const HEX_SECRET_PATTERN =
  /(?:0x[0-9a-f]{64}(?![0-9a-f])|(?:^|[^0-9a-f])[0-9a-f]{64}(?=$|[^0-9a-f]))/iu;
const SOLANA_ADDRESS_PATTERN =
  /(?:^|[^1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?=$|[^1-9A-HJ-NP-Za-km-z])/u;
const GENERIC_WALLET_IDENTITY_VALUES = new Set([
  'n/a',
  'not available',
  'unknown',
  'unknown wallet',
  'unspecified',
  'wallet',
  'example wallet',
  'generic wallet',
  'other wallet',
  'test wallet',
  'unapproved connector',
  'walletconnect',
  'walletconnect peer',
]);
const CANONICAL_WALLET_NAMES: Readonly<Partial<Record<LabConnectorId, string>>> = Object.freeze({
  metamask: 'MetaMask',
  coinbase: 'Coinbase Wallet',
  phantom: 'Phantom',
});
const WALLETCONNECT_ONLY_EVENT_KINDS = new Set<LabEventKind>([
  'session-update',
  'session-delete',
  'session-expire',
  'pairing-expire',
  'qr-display',
]);

const V1_EVENT_RECORD_KEYS = [
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

const V2_EVENT_RECORD_KEYS = [
  'schemaVersion',
  'eventId',
  'occurredAt',
  'connectionId',
  'connectorId',
  'chainId',
  'chainContext',
  'kind',
  'outcome',
  'accountObserved',
  'evidenceMode',
] as const;

const EVENT_ENVELOPE_KEYS = [
  'schemaVersion',
  'exportedAt',
  'classification',
  'containsAddresses',
  'containsSignatures',
  'containsPairingData',
  'containsWalletSecrets',
  'events',
] as const;

const RUN_RECORD_COMMON_REQUIRED_KEYS = [
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
  'startedAt',
  'completedAt',
  'termsAcknowledgement',
  'auditSnapshot',
  'events',
] as const;

const V2_RUN_RECORD_REQUIRED_KEYS = [
  ...RUN_RECORD_COMMON_REQUIRED_KEYS,
  'wallet',
  'network',
] as const;
const V3_RUN_RECORD_REQUIRED_KEYS = [...RUN_RECORD_COMMON_REQUIRED_KEYS, 'connections'] as const;
const RUN_RECORD_OPTIONAL_KEYS = ['sanitizedEvidenceLinks', 'jiraFollowUps', 'exportedAt'] as const;
const CONNECTION_RECORD_KEYS = ['connectionId', 'connectorId', 'wallet', 'networks'] as const;
const SESSION_RECORD_KEYS = [
  'schemaVersion',
  'exportedAt',
  'classification',
  'containsAddresses',
  'containsSignatures',
  'containsPairingData',
  'containsWalletSecrets',
  'candidateCommit',
  'lockSha256',
  'events',
] as const;

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

function requireSecretFreeText(value: string, label: string): string {
  const representations = [value];
  if (value.includes('%')) {
    try {
      representations.push(decodeURIComponent(value));
    } catch {
      // Structural validators decide whether malformed percent encoding is allowed.
    }
  }
  for (const representation of representations) {
    if (
      EVM_ADDRESS_PATTERN.test(representation) ||
      HEX_SECRET_PATTERN.test(representation) ||
      SOLANA_ADDRESS_PATTERN.test(representation)
    ) {
      throw new TypeError(`${label} contains a prohibited address or secret pattern.`);
    }
  }
  return value;
}

function validateCandidateBinding(
  binding: LabEvidenceCandidateBinding,
): LabEvidenceCandidateBinding {
  if (typeof binding !== 'object' || binding === null) {
    throw new TypeError('Evidence candidate binding is invalid.');
  }
  if (
    typeof binding.candidateCommit !== 'string' ||
    !CANDIDATE_COMMIT_PATTERN.test(binding.candidateCommit)
  ) {
    throw new TypeError('Candidate commit must be a 40-character hexadecimal hash.');
  }
  if (typeof binding.lockSha256 !== 'string' || !LOCK_SHA_256_PATTERN.test(binding.lockSha256)) {
    throw new TypeError('Package lock SHA-256 must be a 64-character hexadecimal hash.');
  }
  return Object.freeze({
    candidateCommit: binding.candidateCommit,
    lockSha256: binding.lockSha256,
  });
}

function validateConnectionId(value: unknown): LabConnectionId {
  if (typeof value !== 'string' || !CONNECTION_ID_PATTERN.test(value)) {
    throw new TypeError('Evidence connection ID is invalid or unsanitized.');
  }
  return value;
}

export function connectionIdForConnectorId(connectorId: LabConnectorId): LabConnectionId {
  if (!connectorIds.has(connectorId)) {
    throw new TypeError('Evidence connector is not allowlisted for a connection ID.');
  }
  return `conn_${connectorId}`;
}

function isNetworkCompatibleWithConnector(
  connectorId: LabConnectorId,
  network: LabAllowedNetwork,
): boolean {
  return connectorId === 'phantom'
    ? network === 'solana:devnet'
    : network === 'eip155:11155111' || network === 'eip155:84532';
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
  return Object.freeze({
    name: requireSecretFreeText(identity.name, `${label} name`),
    version: requireSecretFreeText(identity.version, `${label} version`),
  });
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
  for (const reference of references) {
    requireSecretFreeText(reference, 'Sanitized evidence link');
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
  requireSecretFreeText(snapshot.reference, 'Audit snapshot reference');
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

function restoreEvidenceConnection(value: unknown): LabEvidenceConnectionInput {
  const record = requireRecord(value, 'Evidence connection');
  requireExactKeys(record, CONNECTION_RECORD_KEYS);
  return {
    connectionId: record.connectionId as string,
    connectorId: record.connectorId as LabConnectorId,
    wallet: restoreSoftwareIdentity(record.wallet, 'Wallet identity'),
    networks: record.networks as readonly LabAllowedNetwork[],
  };
}

function restoreEvidenceConnections(value: unknown): readonly LabEvidenceConnectionInput[] {
  if (!Array.isArray(value) || value.length > MAX_CONNECTIONS) {
    throw new RangeError(`Evidence is limited to ${MAX_CONNECTIONS} connections.`);
  }
  return value.map(restoreEvidenceConnection);
}

function restoreEvidenceEvent(value: unknown, expectedVersion?: 1 | 2): LabEvidenceEvent {
  const record = requireRecord(value, 'Serialized evidence event');
  if (expectedVersion !== undefined && record.schemaVersion !== expectedVersion) {
    throw new TypeError('Serialized evidence event schema is invalid.');
  }
  if (record.schemaVersion === 1) {
    requireExactKeys(record, V1_EVENT_RECORD_KEYS);
    if (record.evidenceMode !== 'sanitized-real-wallet') {
      throw new TypeError('Serialized evidence event schema is invalid.');
    }
    return createLabEvidenceEvent({
      eventId: record.eventId as string,
      occurredAt: record.occurredAt as string,
      connectionId: connectionIdForConnectorId(record.connectorId as LabConnectorId),
      connectorId: record.connectorId as LabConnectorId,
      chainId: record.chainId as LabChainId,
      chainContext: record.chainContext as LabChainContext,
      kind: record.kind as LabEventKind,
      outcome: record.outcome as LabEventOutcome,
      accountObserved: record.accountObserved as boolean,
    });
  }
  if (record.schemaVersion === 2) {
    requireExactKeys(record, V2_EVENT_RECORD_KEYS);
    if (record.evidenceMode !== 'sanitized-real-wallet') {
      throw new TypeError('Serialized evidence event schema is invalid.');
    }
    return createLabEvidenceEvent({
      eventId: record.eventId as string,
      occurredAt: record.occurredAt as string,
      connectionId: record.connectionId as string,
      connectorId: record.connectorId as LabConnectorId,
      chainId: record.chainId as LabChainId,
      chainContext: record.chainContext as LabChainContext,
      kind: record.kind as LabEventKind,
      outcome: record.outcome as LabEventOutcome,
      accountObserved: record.accountObserved as boolean,
    });
  }
  throw new TypeError('Serialized evidence event schema is invalid.');
}

function restoreEvidenceEventArray(
  value: unknown,
  expectedVersion?: 1 | 2,
): readonly LabEvidenceEvent[] {
  if (!Array.isArray(value) || value.length > MAX_EVENTS) {
    throw new RangeError(`Evidence is limited to ${MAX_EVENTS} events.`);
  }
  return Object.freeze(value.map((event) => restoreEvidenceEvent(event, expectedVersion)));
}

function requireSafetyEnvelope(
  record: UnknownRecord,
  version: 1 | 2 | 3,
  classification:
    | 'sanitized-testnet-wallet-evidence'
    | 'sanitized-testnet-wallet-run-evidence'
    | 'candidate-bound-sanitized-testnet-wallet-session-evidence',
): void {
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

function validateEvidenceConnection(connection: LabEvidenceConnectionInput): LabEvidenceConnection {
  if (typeof connection !== 'object' || connection === null) {
    throw new TypeError('Evidence connection is invalid.');
  }
  const connectionId = validateConnectionId(connection.connectionId);
  if (!connectorIds.has(connection.connectorId)) {
    throw new TypeError('Evidence connection connector is not allowlisted.');
  }
  if (connectionId !== connectionIdForConnectorId(connection.connectorId)) {
    throw new TypeError('Evidence connection ID does not match its connector.');
  }
  if (
    !Array.isArray(connection.networks) ||
    connection.networks.length > LAB_ALLOWED_NETWORKS.length
  ) {
    throw new RangeError(
      `Evidence connection is limited to ${LAB_ALLOWED_NETWORKS.length} networks.`,
    );
  }
  if (!connection.networks.every((network) => allowedNetworks.has(network))) {
    throw new TypeError('Evidence connection network is not allowlisted.');
  }
  if (new Set(connection.networks).size !== connection.networks.length) {
    throw new TypeError('Evidence connection networks must be unique.');
  }
  if (
    !connection.networks.every((network) =>
      isNetworkCompatibleWithConnector(connection.connectorId, network),
    )
  ) {
    throw new TypeError('Evidence connection network is incompatible with its connector.');
  }
  const wallet = validateSoftwareIdentity('wallet', connection.wallet);
  const canonicalWalletName = CANONICAL_WALLET_NAMES[connection.connectorId];
  if (canonicalWalletName !== undefined && wallet.name !== canonicalWalletName) {
    throw new TypeError('Evidence wallet name does not match its canonical connector identity.');
  }
  if (
    GENERIC_WALLET_IDENTITY_VALUES.has(wallet.name.trim().toLowerCase()) ||
    GENERIC_WALLET_IDENTITY_VALUES.has(wallet.version.trim().toLowerCase())
  ) {
    throw new TypeError('Evidence connection requires an exact wallet software identity.');
  }
  return Object.freeze({
    connectionId,
    connectorId: connection.connectorId,
    wallet,
    networks: Object.freeze([...connection.networks]),
  });
}

function validateEvidenceConnections(
  connections: readonly LabEvidenceConnectionInput[],
): readonly LabEvidenceConnection[] {
  if (!Array.isArray(connections) || connections.length > MAX_CONNECTIONS) {
    throw new RangeError(`Evidence is limited to ${MAX_CONNECTIONS} connections.`);
  }
  if (connections.length === 0) {
    throw new RangeError('Completed evidence runs require at least one connection.');
  }
  const rawConnectionIds = connections.flatMap((connection) =>
    typeof connection?.connectionId === 'string' ? [connection.connectionId] : [],
  );
  if (new Set(rawConnectionIds).size !== rawConnectionIds.length) {
    throw new TypeError('Evidence connection IDs must be unique within a run.');
  }
  const rawConnectorIds = connections.flatMap((connection) =>
    typeof connection?.connectorId === 'string' ? [connection.connectorId] : [],
  );
  if (new Set(rawConnectorIds).size !== rawConnectorIds.length) {
    throw new TypeError('Evidence connector IDs must be unique within a run.');
  }
  const validated = connections.map(validateEvidenceConnection);
  if (new Set(validated.map(({ connectionId }) => connectionId)).size !== validated.length) {
    throw new TypeError('Evidence connection IDs must be unique within a run.');
  }
  if (new Set(validated.map(({ connectorId }) => connectorId)).size !== validated.length) {
    throw new TypeError('Evidence connector IDs must be unique within a run.');
  }
  return Object.freeze(validated);
}

function validateRunMetadata(input: LabEvidenceRunMetadataInput) {
  if (typeof input !== 'object' || input === null) {
    throw new TypeError('Evidence run is invalid.');
  }
  if (typeof input.runId !== 'string' || !RUN_ID_PATTERN.test(input.runId)) {
    throw new TypeError('Evidence run ID is invalid.');
  }
  requireSecretFreeText(input.runId, 'Evidence run ID');
  if (typeof input.caseId !== 'string' || !CASE_ID_PATTERN.test(input.caseId)) {
    throw new TypeError('Evidence case ID is invalid.');
  }
  requireSecretFreeText(input.caseId, 'Evidence case ID');
  if (!runResults.has(input.result)) {
    throw new TypeError('Evidence run result is not allowlisted.');
  }
  if (typeof input.tester !== 'string' || !TESTER_PATTERN.test(input.tester)) {
    throw new TypeError('Evidence tester is invalid.');
  }
  requireSecretFreeText(input.tester, 'Evidence tester');
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
  return {
    startedAt,
    completedAt,
    os: validateSoftwareIdentity('OS', input.os),
    browser: validateSoftwareIdentity('browser', input.browser),
    auditSnapshot: validateAuditSnapshot(input.auditSnapshot),
    sanitizedEvidenceLinks:
      input.sanitizedEvidenceLinks === undefined
        ? undefined
        : validateEvidenceReferences(input.sanitizedEvidenceLinks),
    jiraFollowUps:
      input.jiraFollowUps === undefined ? undefined : validateJiraFollowUps(input.jiraFollowUps),
  };
}

function validateRunEvents(
  events: readonly LabEvidenceEvent[],
  startedAt: number,
  completedAt: number,
): readonly LabEvidenceEvent[] {
  if (!Array.isArray(events) || events.length > MAX_EVENTS) {
    throw new RangeError(`Evidence is limited to ${MAX_EVENTS} events.`);
  }
  if (events.length === 0) {
    throw new RangeError('Completed evidence runs require at least one event.');
  }
  const validated = events.map((event) => createLabEvidenceEvent(event));
  if (new Set(validated.map((event) => event.eventId)).size !== validated.length) {
    throw new TypeError('Evidence event IDs must be unique within a run.');
  }
  let previousTimestamp = startedAt;
  for (const event of validated) {
    const eventTimestamp = new Date(event.occurredAt).getTime();
    if (eventTimestamp < startedAt || eventTimestamp > completedAt) {
      throw new RangeError('Evidence event timestamp is outside the run interval.');
    }
    if (eventTimestamp < previousTimestamp) {
      throw new RangeError('Evidence events must be ordered by timestamp.');
    }
    previousTimestamp = eventTimestamp;
  }
  return Object.freeze(validated);
}

function deriveLegacyConnections(
  input: LabLegacyEvidenceRunInput,
  events: readonly LabEvidenceEvent[],
): readonly LabEvidenceConnection[] {
  if (!allowedNetworks.has(input.network)) {
    throw new TypeError('Evidence network is not allowlisted.');
  }
  const wallet = validateSoftwareIdentity('wallet', input.wallet);
  if (new Set(events.map(({ connectorId }) => connectorId)).size > 1) {
    throw new TypeError('Legacy v2 run has ambiguous multi-connector attribution.');
  }
  const legacyConnectorId = events[0]?.connectorId;
  if (
    legacyConnectorId !== undefined &&
    !isNetworkCompatibleWithConnector(legacyConnectorId, input.network)
  ) {
    throw new TypeError('Legacy v2 run has incompatible network attribution.');
  }
  const eventNetworks = new Set(
    events.flatMap(({ chainId }) =>
      allowedNetworks.has(chainId) ? [chainId as LabAllowedNetwork] : [],
    ),
  );
  if (eventNetworks.size > 1 || (eventNetworks.size === 1 && !eventNetworks.has(input.network))) {
    throw new TypeError('Legacy v2 run has ambiguous network attribution.');
  }
  const migratedNetworks = eventNetworks.size === 0 ? [] : [input.network];
  const byConnectionId = new Map<string, LabEvidenceConnectionInput>();
  for (const event of events) {
    const existing = byConnectionId.get(event.connectionId);
    if (existing && existing.connectorId !== event.connectorId) {
      throw new TypeError('Evidence event connector attribution does not match the run roster.');
    }
    byConnectionId.set(event.connectionId, {
      connectionId: event.connectionId,
      connectorId: event.connectorId,
      wallet,
      networks: migratedNetworks,
    });
  }
  return validateEvidenceConnections([...byConnectionId.values()]);
}

function assertEventAttribution(
  events: readonly LabEvidenceEvent[],
  connections: readonly LabEvidenceConnection[],
): void {
  const byConnectionId = new Map(
    connections.map((connection) => [connection.connectionId, connection]),
  );
  const referencedConnectionIds = new Set<string>();
  const referencedNetworks = new Map<string, Set<LabAllowedNetwork>>();
  for (const event of events) {
    const connection = byConnectionId.get(event.connectionId);
    if (!connection) {
      throw new TypeError('Evidence event connection is not represented in the run roster.');
    }
    if (connection.connectorId !== event.connectorId) {
      throw new TypeError('Evidence event connector attribution does not match the run roster.');
    }
    if (
      allowedNetworks.has(event.chainId) &&
      !connection.networks.includes(event.chainId as LabAllowedNetwork)
    ) {
      throw new TypeError('Evidence event network is not represented in the run roster.');
    }
    if (allowedNetworks.has(event.chainId)) {
      const networks = referencedNetworks.get(event.connectionId) ?? new Set<LabAllowedNetwork>();
      networks.add(event.chainId as LabAllowedNetwork);
      referencedNetworks.set(event.connectionId, networks);
    }
    referencedConnectionIds.add(event.connectionId);
  }
  if (connections.some(({ connectionId }) => !referencedConnectionIds.has(connectionId))) {
    throw new TypeError('Every evidence roster connection must be referenced by an event.');
  }
  for (const connection of connections) {
    const observed =
      referencedNetworks.get(connection.connectionId) ?? new Set<LabAllowedNetwork>();
    if (
      observed.size !== connection.networks.length ||
      connection.networks.some((network) => !observed.has(network))
    ) {
      throw new TypeError('Evidence connection networks must exactly match its event networks.');
    }
  }
}

export function createLabEvidenceEvent(input: LabEvidenceEventInput): LabEvidenceEvent {
  if (typeof input !== 'object' || input === null) {
    throw new TypeError('Evidence event is invalid.');
  }
  if (typeof input.eventId !== 'string' || !EVENT_ID_PATTERN.test(input.eventId)) {
    throw new TypeError('Evidence event ID is invalid.');
  }
  if (!isCanonicalTimestamp(input.occurredAt)) {
    throw new TypeError('Evidence timestamp must be canonical UTC.');
  }
  if (!connectorIds.has(input.connectorId) || !chainIds.has(input.chainId)) {
    throw new TypeError('Evidence connector or chain is not allowlisted.');
  }
  const connectionId = validateConnectionId(input.connectionId);
  if (connectionId !== connectionIdForConnectorId(input.connectorId)) {
    throw new TypeError('Evidence connection ID does not match its connector.');
  }
  if (
    (input.chainId === 'evm:unsupported' && input.connectorId === 'phantom') ||
    (allowedNetworks.has(input.chainId) &&
      !isNetworkCompatibleWithConnector(input.connectorId, input.chainId as LabAllowedNetwork))
  ) {
    throw new TypeError('Evidence chain is incompatible with its connector.');
  }
  if (!eventKinds.has(input.kind) || !eventOutcomes.has(input.outcome)) {
    throw new TypeError('Evidence kind or outcome is not allowlisted.');
  }
  if (!chainContexts.has(input.chainContext)) {
    throw new TypeError('Evidence chain context is not allowlisted.');
  }
  if (input.chainId === 'evm:unsupported' && input.chainContext !== 'observed') {
    throw new TypeError('Unsupported-chain evidence must be an observation.');
  }
  if (WALLETCONNECT_ONLY_EVENT_KINDS.has(input.kind) && input.connectorId !== 'walletconnect') {
    throw new TypeError('Evidence event kind is restricted to WalletConnect.');
  }
  if (input.kind === 'mobile-return' && input.connectorId === 'unapproved') {
    throw new TypeError('Mobile-return evidence requires an approved connector.');
  }
  if (
    input.connectorId === 'unapproved' &&
    input.outcome === 'accepted' &&
    (input.kind === 'connect' || input.kind === 'restore' || input.kind === 'ownership-proof')
  ) {
    throw new TypeError('Unapproved connectors cannot record an accepted authorization event.');
  }
  if (input.accountObserved !== undefined && typeof input.accountObserved !== 'boolean') {
    throw new TypeError('Evidence account-observed flag must be boolean.');
  }
  return Object.freeze({
    schemaVersion: 2,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
    connectionId,
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
  if (!Array.isArray(events) || events.length > MAX_EVENTS) {
    throw new RangeError(`Evidence is limited to ${MAX_EVENTS} events.`);
  }
  const validated = events.map((event) => createLabEvidenceEvent(event));
  return JSON.stringify(
    {
      schemaVersion: 2,
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

function validateSessionEvents(events: readonly LabEvidenceEvent[]): readonly LabEvidenceEvent[] {
  if (!Array.isArray(events) || events.length === 0 || events.length > MAX_EVENTS) {
    throw new RangeError(`Bound session evidence requires 1-${MAX_EVENTS} events.`);
  }
  const validated = events.map((event) => createLabEvidenceEvent(event));
  if (new Set(validated.map(({ eventId }) => eventId)).size !== validated.length) {
    throw new TypeError('Bound session evidence event IDs must be unique.');
  }
  for (let index = 1; index < validated.length; index += 1) {
    if (
      new Date(validated[index]!.occurredAt).getTime() <
      new Date(validated[index - 1]!.occurredAt).getTime()
    ) {
      throw new RangeError('Bound session evidence events must be ordered by timestamp.');
    }
  }
  return Object.freeze(validated);
}

export function exportLabEvidenceSession(input: LabEvidenceSessionInput): string {
  if (typeof input !== 'object' || input === null) {
    throw new TypeError('Evidence session is invalid.');
  }
  const binding = validateCandidateBinding(input);
  const events = validateSessionEvents(input.events);
  return JSON.stringify(
    {
      schemaVersion: 3,
      exportedAt: new Date().toISOString(),
      classification: 'candidate-bound-sanitized-testnet-wallet-session-evidence',
      containsAddresses: false,
      containsSignatures: false,
      containsPairingData: false,
      containsWalletSecrets: false,
      candidateCommit: binding.candidateCommit,
      lockSha256: binding.lockSha256,
      events,
    },
    null,
    2,
  );
}

export function restoreLabEvidenceSession(
  serialized: string,
  expectedBinding: LabEvidenceCandidateBinding,
): readonly LabEvidenceEvent[] {
  const expected = validateCandidateBinding(expectedBinding);
  const record = requireRecord(parseSerializedEvidence(serialized), 'Serialized evidence session');
  requireExactKeys(record, SESSION_RECORD_KEYS);
  requireSafetyEnvelope(record, 3, 'candidate-bound-sanitized-testnet-wallet-session-evidence');
  if (!isCanonicalTimestamp(record.exportedAt)) {
    throw new TypeError('Evidence export timestamp must be canonical UTC.');
  }
  const stored = validateCandidateBinding({
    candidateCommit: record.candidateCommit as string,
    lockSha256: record.lockSha256 as string,
  });
  if (
    stored.candidateCommit.toLowerCase() !== expected.candidateCommit.toLowerCase() ||
    stored.lockSha256.toLowerCase() !== expected.lockSha256.toLowerCase()
  ) {
    throw new TypeError('Stored evidence candidate or lock binding does not match.');
  }
  return validateSessionEvents(restoreEvidenceEventArray(record.events, 2));
}

export function createLabEvidenceRun(input: LabEvidenceRunInput): LabEvidenceRun {
  const metadata = validateRunMetadata(input);
  const events = validateRunEvents(input.events, metadata.startedAt, metadata.completedAt);
  const connections = validateEvidenceConnections(input.connections);
  assertEventAttribution(events, connections);
  return Object.freeze({
    schemaVersion: 3,
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
    os: metadata.os,
    browser: metadata.browser,
    connections,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    termsAcknowledgement: input.termsAcknowledgement,
    auditSnapshot: metadata.auditSnapshot,
    ...(metadata.sanitizedEvidenceLinks === undefined
      ? {}
      : { sanitizedEvidenceLinks: metadata.sanitizedEvidenceLinks }),
    ...(metadata.jiraFollowUps === undefined ? {} : { jiraFollowUps: metadata.jiraFollowUps }),
    events,
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

function restoreRunMetadata(record: UnknownRecord): LabEvidenceRunMetadataInput {
  return {
    runId: record.runId as string,
    caseId: record.caseId as string,
    result: record.result as LabRunResult,
    tester: record.tester as string,
    candidateCommit: record.candidateCommit as string,
    lockSha256: record.lockSha256 as string,
    environmentId: record.environmentId as LabEnvironmentId,
    os: restoreSoftwareIdentity(record.os, 'OS identity'),
    browser: restoreSoftwareIdentity(record.browser, 'Browser identity'),
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
  };
}

function validateExportedAt(record: UnknownRecord): void {
  if (Object.hasOwn(record, 'exportedAt') && !isCanonicalTimestamp(record.exportedAt)) {
    throw new TypeError('Evidence export timestamp must be canonical UTC.');
  }
}

function restoreEvidenceRunRecord(value: unknown): LabEvidenceRun {
  const record = requireRecord(value, 'Serialized evidence run');
  if (record.schemaVersion === 3) {
    requireExactKeys(record, V3_RUN_RECORD_REQUIRED_KEYS, RUN_RECORD_OPTIONAL_KEYS);
    requireSafetyEnvelope(record, 3, 'sanitized-testnet-wallet-run-evidence');
    validateExportedAt(record);
    return createLabEvidenceRun({
      ...restoreRunMetadata(record),
      connections: restoreEvidenceConnections(record.connections),
      events: restoreEvidenceEventArray(record.events, 2),
    });
  }
  if (record.schemaVersion === 2) {
    requireExactKeys(record, V2_RUN_RECORD_REQUIRED_KEYS, RUN_RECORD_OPTIONAL_KEYS);
    requireSafetyEnvelope(record, 2, 'sanitized-testnet-wallet-run-evidence');
    validateExportedAt(record);
    const metadata = restoreRunMetadata(record);
    const events = restoreEvidenceEventArray(record.events, 1);
    const legacyInput: LabLegacyEvidenceRunInput = {
      ...metadata,
      wallet: restoreSoftwareIdentity(record.wallet, 'Wallet identity'),
      network: record.network as LabAllowedNetwork,
      events,
    };
    return createLabEvidenceRun({
      ...metadata,
      connections: deriveLegacyConnections(legacyInput, events),
      events,
    });
  }
  throw new TypeError('Serialized evidence run schema is invalid.');
}

/**
 * Rebuilds current v2 events from a serialized event array, a v1/v2 event
 * export, or a complete v2/v3 run. Legacy v1 events are assigned the stable
 * conn_<connectorId> migration ID. Unknown fields remain rejected.
 */
export function restoreLabEvidenceEvents(serialized: string): readonly LabEvidenceEvent[] {
  const value = parseSerializedEvidence(serialized);
  if (Array.isArray(value)) return restoreEvidenceEventArray(value);
  const record = requireRecord(value, 'Serialized evidence');
  if (record.classification === 'sanitized-testnet-wallet-run-evidence') {
    return restoreEvidenceRunRecord(record).events;
  }
  if (record.schemaVersion !== 1 && record.schemaVersion !== 2) {
    throw new TypeError('Serialized evidence event envelope schema is invalid.');
  }
  requireExactKeys(record, EVENT_ENVELOPE_KEYS);
  requireSafetyEnvelope(record, record.schemaVersion, 'sanitized-testnet-wallet-evidence');
  if (!isCanonicalTimestamp(record.exportedAt)) {
    throw new TypeError('Evidence export timestamp must be canonical UTC.');
  }
  return restoreEvidenceEventArray(record.events, record.schemaVersion);
}

/** Rebuilds a v3 run, upgrading a complete serialized v2 run when necessary. */
export function restoreLabEvidenceRun(serialized: string): LabEvidenceRun {
  return restoreEvidenceRunRecord(parseSerializedEvidence(serialized));
}
