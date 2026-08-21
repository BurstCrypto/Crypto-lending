import type {
  LedgerJournalId,
  PostLedgerJournalCommand,
  ReverseLedgerJournalCommand,
} from '../domain/ledger';
import type {
  LedgerPostingCapability,
  LedgerReversalCapability,
} from './ledger-capability-resolver.port';
import type {
  LedgerLifecycleTransitionCommand,
  LedgerRecoveryTransitionCommand,
} from '../domain/transaction-lifecycle';
import type { LedgerIdempotencyContext } from '../domain/idempotency';

export const LEDGER_REPOSITORY = Symbol('LEDGER_REPOSITORY');

export interface LedgerRepository {
  resolveIdempotency(context: LedgerIdempotencyContext): Promise<LedgerJournalId | null>;
  postJournal(
    command: PostLedgerJournalCommand,
    capability: LedgerPostingCapability,
    idempotency: LedgerIdempotencyContext,
  ): Promise<LedgerJournalId>;
  reverseJournal(
    command: ReverseLedgerJournalCommand,
    capability: LedgerReversalCapability,
    idempotency: LedgerIdempotencyContext,
  ): Promise<LedgerJournalId>;
  transitionLifecycle(command: LedgerLifecycleTransitionCommand): Promise<void>;
  transitionRecovery(command: LedgerRecoveryTransitionCommand): Promise<void>;
}
