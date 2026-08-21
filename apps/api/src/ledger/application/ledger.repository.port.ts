import type {
  LedgerJournalId,
  PostLedgerJournalCommand,
  ReverseLedgerJournalCommand,
} from '../domain/ledger';

export const LEDGER_REPOSITORY = Symbol('LEDGER_REPOSITORY');

export interface LedgerRepository {
  postJournal(command: PostLedgerJournalCommand): Promise<LedgerJournalId>;
  reverseJournal(command: ReverseLedgerJournalCommand): Promise<LedgerJournalId>;
}
