import type {
  LedgerJournalId,
  PostLedgerJournalCommand,
  ReverseLedgerJournalCommand,
} from '../domain/ledger';
import type {
  LedgerPostingCapability,
  LedgerReversalCapability,
} from './ledger-capability-resolver.port';

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
}
