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

export const LEDGER_REPOSITORY = Symbol('LEDGER_REPOSITORY');

export interface LedgerRepository {
  postJournal(
    command: PostLedgerJournalCommand,
    capability: LedgerPostingCapability,
  ): Promise<LedgerJournalId>;
  reverseJournal(
    command: ReverseLedgerJournalCommand,
    capability: LedgerReversalCapability,
  ): Promise<LedgerJournalId>;
  transitionLifecycle(command: LedgerLifecycleTransitionCommand): Promise<void>;
  transitionRecovery(command: LedgerRecoveryTransitionCommand): Promise<void>;
}
