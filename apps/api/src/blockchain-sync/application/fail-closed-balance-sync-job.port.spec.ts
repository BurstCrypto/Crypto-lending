import type { BalanceSyncJobEnvelope } from '../domain/balance-sync';
import type { BalanceSyncJobPort } from './ports/balance-sync.ports';
import {
  BALANCE_SYNC_JOB_DISPOSITION_NOT_APPROVED,
  BalanceSyncJobDispositionNotApprovedError,
  FailClosedBalanceSyncJobPort,
  balanceSyncReceiptRetryMinimumDelaySeconds,
} from './fail-closed-balance-sync-job.port';

const PRIVATE_DETAIL = 'contains-provider-private-detail';
const ENVELOPE = Object.freeze({ id: PRIVATE_DETAIL }) as unknown as BalanceSyncJobEnvelope;

type RetryInput = Parameters<BalanceSyncJobPort['scheduleRetry']>[0];

function retryInput(delaySeconds: number): RetryInput {
  return Object.freeze({
    envelope: ENVELOPE,
    delaySeconds,
    failureCode: 'PROVIDER_TIMEOUT',
  });
}

async function rejectedValue(work: () => Promise<void>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error('expected rejection');
}

function expectFixedNoDetailError(error: unknown): void {
  expect(error).toMatchObject({
    code: BALANCE_SYNC_JOB_DISPOSITION_NOT_APPROVED,
    message: BALANCE_SYNC_JOB_DISPOSITION_NOT_APPROVED,
    name: 'BalanceSyncJobDispositionNotApprovedError',
  });
  expect(String(error)).not.toContain(PRIVATE_DETAIL);
  expect(JSON.stringify(error)).not.toContain(PRIVATE_DETAIL);
}

describe('FailClosedBalanceSyncJobPort', () => {
  it.each([5, 30, 60])(
    'attaches a trusted %i-second receipt minimum only to the exact schedule failure',
    async (delaySeconds) => {
      const error = await rejectedValue(() =>
        new FailClosedBalanceSyncJobPort().scheduleRetry(retryInput(delaySeconds)),
      );

      expectFixedNoDetailError(error);
      expect(balanceSyncReceiptRetryMinimumDelaySeconds(error)).toBe(delaySeconds);
      expect(balanceSyncReceiptRetryMinimumDelaySeconds({ ...(error as object) })).toBeUndefined();
      expect(balanceSyncReceiptRetryMinimumDelaySeconds(new Proxy(error as object, {}))).toBe(
        undefined,
      );
    },
  );

  it.each([4, 61, 5.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid retry delay %p with the same unmarked failure',
    async (delaySeconds) => {
      const error = await rejectedValue(() =>
        new FailClosedBalanceSyncJobPort().scheduleRetry(retryInput(delaySeconds)),
      );

      expectFixedNoDetailError(error);
      expect(balanceSyncReceiptRetryMinimumDelaySeconds(error)).toBeUndefined();
    },
  );

  it('never invokes an accessor-backed delay or retains its detail', async () => {
    let reads = 0;
    const input = {
      envelope: ENVELOPE,
      failureCode: 'PROVIDER_TIMEOUT',
    } as unknown as Record<string, unknown>;
    Object.defineProperty(input, 'delaySeconds', {
      enumerable: true,
      get: () => {
        reads += 1;
        throw new Error(PRIVATE_DETAIL);
      },
    });

    const error = await rejectedValue(() =>
      new FailClosedBalanceSyncJobPort().scheduleRetry(input as unknown as RetryInput),
    );

    expect(reads).toBe(0);
    expectFixedNoDetailError(error);
    expect(balanceSyncReceiptRetryMinimumDelaySeconds(error)).toBeUndefined();
  });

  it('fails closed on a hostile proxy without leaking or trusting proxy detail', async () => {
    const input = new Proxy(retryInput(30), {
      getOwnPropertyDescriptor: () => {
        throw new Error(PRIVATE_DETAIL);
      },
    });

    const error = await rejectedValue(() =>
      new FailClosedBalanceSyncJobPort().scheduleRetry(input),
    );

    expectFixedNoDetailError(error);
    expect(balanceSyncReceiptRetryMinimumDelaySeconds(error)).toBeUndefined();
  });

  it('does not trust lookalikes, dead-letter failures, primitives, or hostile proxies', async () => {
    const deadLetterError = await rejectedValue(() =>
      new FailClosedBalanceSyncJobPort().deadLetter({
        envelope: ENVELOPE,
        failureCode: 'PERMANENT_PROVIDER_FAILURE',
        reason: 'NON_RETRYABLE_FAILURE',
      }),
    );
    const lookalike = {
      code: BALANCE_SYNC_JOB_DISPOSITION_NOT_APPROVED,
      message: BALANCE_SYNC_JOB_DISPOSITION_NOT_APPROVED,
      name: 'BalanceSyncJobDispositionNotApprovedError',
    };
    let trapCalls = 0;
    const proxy = new Proxy(lookalike, {
      get: () => {
        trapCalls += 1;
        throw new Error(PRIVATE_DETAIL);
      },
      getPrototypeOf: () => {
        trapCalls += 1;
        throw new Error(PRIVATE_DETAIL);
      },
    });

    expectFixedNoDetailError(deadLetterError);
    for (const candidate of [
      deadLetterError,
      new BalanceSyncJobDispositionNotApprovedError(),
      lookalike,
      proxy,
      undefined,
      null,
      30,
      PRIVATE_DETAIL,
    ]) {
      expect(balanceSyncReceiptRetryMinimumDelaySeconds(candidate)).toBeUndefined();
    }
    expect(trapCalls).toBe(0);
  });
});
