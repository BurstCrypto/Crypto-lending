import type { BalanceSyncJobPort } from './ports/balance-sync.ports';

export const BALANCE_SYNC_JOB_DISPOSITION_NOT_APPROVED =
  'BALANCE_SYNC_JOB_DISPOSITION_NOT_APPROVED' as const;

/** Fixed local failure; it deliberately retains no job, provider, or queue detail. */
export class BalanceSyncJobDispositionNotApprovedError extends Error {
  readonly code = BALANCE_SYNC_JOB_DISPOSITION_NOT_APPROVED;

  constructor() {
    super(BALANCE_SYNC_JOB_DISPOSITION_NOT_APPROVED);
    this.name = 'BalanceSyncJobDispositionNotApprovedError';
    Object.freeze(this);
  }
}

/**
 * Dormant default until retry/dead-letter durability and send authority are
 * explicitly approved. Both methods perform no I/O and always fail closed.
 */
export class FailClosedBalanceSyncJobPort implements BalanceSyncJobPort {
  async scheduleRetry(_input: Parameters<BalanceSyncJobPort['scheduleRetry']>[0]): Promise<void> {
    void _input;
    throw new BalanceSyncJobDispositionNotApprovedError();
  }

  async deadLetter(_input: Parameters<BalanceSyncJobPort['deadLetter']>[0]): Promise<void> {
    void _input;
    throw new BalanceSyncJobDispositionNotApprovedError();
  }
}
