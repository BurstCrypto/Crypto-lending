import {
  isWalletLabConnectorId,
  isWalletLabNetworkId,
  type WalletLabConnectorId,
  type WalletLabNetworkId,
} from './config';

export const WALLET_LAB_EVENT_KINDS = [
  'connect',
  'reject',
  'restore',
  'account-change',
  'chain-change',
  'ownership-proof',
  'session-update',
  'disconnect',
] as const;

export type WalletLabEventKind = (typeof WALLET_LAB_EVENT_KINDS)[number];
export type WalletLabEventOutcome = 'accepted' | 'rejected' | 'simulated' | 'cleared';

export interface WalletLabEvidenceEvent {
  schemaVersion: 1;
  eventId: string;
  occurredAt: string;
  connectorId: WalletLabConnectorId;
  networkId: WalletLabNetworkId;
  kind: WalletLabEventKind;
  outcome: WalletLabEventOutcome;
  accountObserved: boolean;
  evidenceMode: 'sanitized-mock';
}

export interface WalletLabEvidenceInput {
  eventId: string;
  occurredAt: string;
  connectorId: WalletLabConnectorId;
  networkId: WalletLabNetworkId;
  kind: WalletLabEventKind;
  outcome: WalletLabEventOutcome;
  accountObserved?: boolean;
}

const eventKinds = new Set<string>(WALLET_LAB_EVENT_KINDS);
const outcomes = new Set<string>(['accepted', 'rejected', 'simulated', 'cleared']);
const MAXIMUM_EVIDENCE_EVENTS = 250;

function isCanonicalTimestamp(value: string): boolean {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

export function buildWalletLabEvidence(input: WalletLabEvidenceInput): WalletLabEvidenceEvent {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(input.eventId)) {
    throw new TypeError('wallet lab evidence eventId is invalid');
  }
  if (!isCanonicalTimestamp(input.occurredAt)) {
    throw new TypeError('wallet lab evidence occurredAt must be a canonical UTC timestamp');
  }
  if (!isWalletLabConnectorId(input.connectorId) || !isWalletLabNetworkId(input.networkId)) {
    throw new TypeError('wallet lab evidence connector or network is not allowlisted');
  }
  if (!eventKinds.has(input.kind) || !outcomes.has(input.outcome)) {
    throw new TypeError('wallet lab evidence kind or outcome is not allowlisted');
  }
  if (input.accountObserved !== undefined && typeof input.accountObserved !== 'boolean') {
    throw new TypeError('wallet lab evidence accountObserved must be boolean');
  }

  return Object.freeze({
    schemaVersion: 1,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
    connectorId: input.connectorId,
    networkId: input.networkId,
    kind: input.kind,
    outcome: input.outcome,
    accountObserved: input.accountObserved ?? false,
    evidenceMode: 'sanitized-mock',
  });
}

export function exportWalletLabEvidence(events: readonly WalletLabEvidenceEvent[]): string {
  if (events.length > MAXIMUM_EVIDENCE_EVENTS) {
    throw new RangeError(`wallet lab evidence is limited to ${MAXIMUM_EVIDENCE_EVENTS} events`);
  }

  const validated = events.map((event) => buildWalletLabEvidence(event));
  return JSON.stringify(
    {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      classification: 'sanitized-test-evidence',
      containsWalletSecrets: false,
      events: validated,
    },
    null,
    2,
  );
}
