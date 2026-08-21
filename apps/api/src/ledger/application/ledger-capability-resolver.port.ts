import type {
  EconomicEventType,
  LedgerActorAccountId,
  LedgerBookId,
  LedgerJournalId,
  LedgerLegId,
  LedgerTransactionId,
  PostLedgerReasonCode,
  ReversalLedgerReasonCode,
} from '../domain/ledger';

const CAPABILITY_PATTERN = /^[0-9a-f]{64}$/u;
const capabilityValues = new WeakMap<object, string>();
const capabilityPurposes = new WeakMap<object, LedgerCapabilityPurpose>();

export const LEDGER_CAPABILITY_RESOLVER = Symbol('LEDGER_CAPABILITY_RESOLVER');

export type LedgerCapabilityPurpose = 'POST' | 'REVERSE';

declare const ledgerCapabilityBrand: unique symbol;

export interface LedgerCapability<Purpose extends LedgerCapabilityPurpose> {
  readonly [ledgerCapabilityBrand]: Purpose;
}

export type LedgerPostingCapability = LedgerCapability<'POST'>;
export type LedgerReversalCapability = LedgerCapability<'REVERSE'>;

export class LedgerCapabilityError extends Error {
  readonly code = 'LEDGER_CAPABILITY_UNAVAILABLE' as const;

  constructor() {
    super('Ledger capability is unavailable');
    this.name = 'LedgerCapabilityError';
  }
}

/**
 * Wraps a resolver-provided bearer value without putting it on an enumerable
 * object property. The raw value must never enter request DTOs, logs, traces,
 * error messages, URLs, or durable command objects.
 */
export function createLedgerCapability<Purpose extends LedgerCapabilityPurpose>(
  purpose: Purpose,
  value: unknown,
): LedgerCapability<Purpose> {
  if (typeof value !== 'string' || !CAPABILITY_PATTERN.test(value)) {
    throw new LedgerCapabilityError();
  }
  const capability = Object.freeze(Object.create(null)) as LedgerCapability<Purpose>;
  capabilityValues.set(capability, value);
  capabilityPurposes.set(capability, purpose);
  return capability;
}

export function revealLedgerCapability<Purpose extends LedgerCapabilityPurpose>(
  capability: LedgerCapability<Purpose>,
  expectedPurpose: Purpose,
): string {
  try {
    if (
      !capability ||
      typeof capability !== 'object' ||
      Object.getPrototypeOf(capability) !== null ||
      !Object.isFrozen(capability) ||
      Reflect.ownKeys(capability).length !== 0 ||
      capabilityPurposes.get(capability) !== expectedPurpose
    ) {
      throw new LedgerCapabilityError();
    }
    const value = capabilityValues.get(capability);
    if (value === undefined) throw new LedgerCapabilityError();
    return value;
  } catch {
    throw new LedgerCapabilityError();
  }
}

export interface LedgerPostingCapabilityRequest {
  readonly actorAccountId: LedgerActorAccountId;
  readonly bookId: LedgerBookId;
  readonly transactionId: LedgerTransactionId;
  readonly legId: LedgerLegId;
  readonly economicEventType: EconomicEventType;
  readonly reason: PostLedgerReasonCode;
}

export interface LedgerReversalCapabilityRequest {
  readonly actorAccountId: LedgerActorAccountId;
  readonly originalJournalId: LedgerJournalId;
  readonly reason: ReversalLedgerReasonCode;
}

/**
 * Implemented only by the trusted authorization/provisioning boundary. KAN-42
 * owns issuance and custody; this port deliberately has no permissive default.
 */
export interface LedgerCapabilityResolver {
  resolvePosting(
    request: LedgerPostingCapabilityRequest,
  ): LedgerPostingCapability | null | Promise<LedgerPostingCapability | null>;
  resolveReversal(
    request: LedgerReversalCapabilityRequest,
  ): LedgerReversalCapability | null | Promise<LedgerReversalCapability | null>;
}
