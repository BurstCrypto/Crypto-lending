import type { BalanceSyncJobEnvelope } from '../domain/balance-sync';
import {
  BALANCE_SYNC_JOB_DISPOSITION_NOT_APPROVED,
  BalanceSyncJobDispositionNotApprovedError,
  FailClosedBalanceSyncJobPort,
} from './fail-closed-balance-sync-job.port';

const ENVELOPE = Object.freeze({
  id: 'contains-provider-private-detail',
}) as unknown as BalanceSyncJobEnvelope;

describe('FailClosedBalanceSyncJobPort', () => {
  it.each([
    ['scheduleRetry', () => new FailClosedBalanceSyncJobPort().scheduleRetry({
      envelope: ENVELOPE,
      delaySeconds: 5,
      failureCode: 'PROVIDER_TIMEOUT',
    })],
    ['deadLetter', () => new FailClosedBalanceSyncJobPort().deadLetter({
      envelope: ENVELOPE,
      failureCode: 'PERMANENT_PROVIDER_FAILURE',
      reason: 'NON_RETRYABLE_FAILURE',
    })],
  ] as const)('%s rejects with one fixed no-detail error and performs no disposition', async (_name, work) => {
    await expect(work()).rejects.toEqual(new BalanceSyncJobDispositionNotApprovedError());
    await expect(work()).rejects.toMatchObject({
      code: BALANCE_SYNC_JOB_DISPOSITION_NOT_APPROVED,
      message: BALANCE_SYNC_JOB_DISPOSITION_NOT_APPROVED,
    });
    try {
      await work();
    } catch (error) {
      expect(String(error)).not.toContain(ENVELOPE.id);
    }
  });
});
