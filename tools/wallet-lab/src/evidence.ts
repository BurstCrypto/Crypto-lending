export const LAB_CONNECTOR_IDS = [
  'injected',
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
  'disconnect',
] as const;

export type LabConnectorId = (typeof LAB_CONNECTOR_IDS)[number];
export type LabChainId = (typeof LAB_CHAIN_IDS)[number];
export type LabEventKind = (typeof LAB_EVENT_KINDS)[number];
export type LabEventOutcome = 'accepted' | 'rejected' | 'blocked' | 'cleared';
export type LabChainContext = 'observed' | 'requested';

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

const connectorIds = new Set<string>(LAB_CONNECTOR_IDS);
const chainIds = new Set<string>(LAB_CHAIN_IDS);
const eventKinds = new Set<string>(LAB_EVENT_KINDS);
const eventOutcomes = new Set<string>(['accepted', 'rejected', 'blocked', 'cleared']);
const chainContexts = new Set<string>(['observed', 'requested']);
const MAX_EVENTS = 250;

function isCanonicalTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
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
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(input.eventId)) {
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
