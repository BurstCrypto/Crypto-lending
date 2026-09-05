import { BALANCE_SYNC_POLICY } from '../domain/balance-sync';
import type { BalanceSyncJobPort } from './ports/balance-sync.ports';

export const BALANCE_SYNC_JOB_DISPOSITION_NOT_APPROVED =
  'BALANCE_SYNC_JOB_DISPOSITION_NOT_APPROVED' as const;

const receiptRetryMinimumDelaySecondsByError = new WeakMap<object, number>();

/** Fixed local failure; it deliberately retains no job, provider, or queue detail. */
export class BalanceSyncJobDispositionNotApprovedError extends Error {
  readonly code = BALANCE_SYNC_JOB_DISPOSITION_NOT_APPROVED;

  constructor() {
    super(BALANCE_SYNC_JOB_DISPOSITION_NOT_APPROVED);
    this.name = 'BalanceSyncJobDispositionNotApprovedError';
    Object.freeze(this);
  }
}

function validatedReceiptRetryMinimumDelaySeconds(input: unknown): number | undefined {
  try {
    if (input === null || typeof input !== 'object') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(input, 'delaySeconds');
    if (!descriptor || !('value' in descriptor)) return undefined;
    const delaySeconds = descriptor.value;
    if (
      typeof delaySeconds !== 'number' ||
      !Number.isSafeInteger(delaySeconds) ||
      delaySeconds < BALANCE_SYNC_POLICY.retryBaseDelaySeconds ||
      delaySeconds > BALANCE_SYNC_POLICY.retryMaximumDelaySeconds
    ) {
      return undefined;
    }
    return delaySeconds;
  } catch {
    return undefined;
  }
}

/**
 * Recognizes only exact failures created for a validated scheduleRetry call.
 * Constructed, copied, and proxied lookalikes cannot forge the bounded signal;
 * only the exact error marked by this module carries it.
 */
export function balanceSyncReceiptRetryMinimumDelaySeconds(error: unknown): number | undefined {
  try {
    if (error === null || (typeof error !== 'object' && typeof error !== 'function')) {
      return undefined;
    }
    return receiptRetryMinimumDelaySecondsByError.get(error as object);
  } catch {
    return undefined;
  }
}

/**
 * Receipt-retention handoff for the dormant balance consumer. Both methods
 * perform no I/O and always fail, causing SqsJobWorker to leave the source
 * receipt undeleted. The worker's ChangeMessageVisibility call and the source
 * queue's native redrive policy are the sole retry/DLQ authority; this port has
 * no SendMessage or direct-DLQ capability.
 */
export class FailClosedBalanceSyncJobPort implements BalanceSyncJobPort {
  async scheduleRetry(input: Parameters<BalanceSyncJobPort['scheduleRetry']>[0]): Promise<void> {
    const minimumDelaySeconds = validatedReceiptRetryMinimumDelaySeconds(input);
    const error = new BalanceSyncJobDispositionNotApprovedError();
    if (minimumDelaySeconds !== undefined) {
      receiptRetryMinimumDelaySecondsByError.set(error, minimumDelaySeconds);
    }
    throw error;
  }

  async deadLetter(_input: Parameters<BalanceSyncJobPort['deadLetter']>[0]): Promise<void> {
    void _input;
    throw new BalanceSyncJobDispositionNotApprovedError();
  }
}
