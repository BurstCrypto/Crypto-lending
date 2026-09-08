import { isProxy } from 'node:util/types';

import type {
  ProviderPositionAdmissionClock,
  ProviderPositionAdmissionDeadlineRunner,
  ProviderPositionAdmissionDeadlineRunRequestV1,
} from '../application/provider-position-admission.coordinator';

const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CORRELATION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const SOURCE_FAMILY_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const TARGET_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,190}[A-Za-z0-9])?$/u;
const MAX_DEADLINE_MILLISECONDS = 30_000;

const ABORT_SIGNAL_ABORTED_GETTER = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
)?.get;
const EVENT_TARGET_ADD_EVENT_LISTENER = Object.getOwnPropertyDescriptor(
  EventTarget.prototype,
  'addEventListener',
)?.value as EventTarget['addEventListener'] | undefined;
const EVENT_TARGET_REMOVE_EVENT_LISTENER = Object.getOwnPropertyDescriptor(
  EventTarget.prototype,
  'removeEventListener',
)?.value as EventTarget['removeEventListener'] | undefined;
const DATE_GET_TIME = Object.getOwnPropertyDescriptor(Date.prototype, 'getTime')?.value as
  ((this: Date) => number) | undefined;
const DATE_TO_ISO_STRING = Object.getOwnPropertyDescriptor(Date.prototype, 'toISOString')?.value as
  ((this: Date) => string) | undefined;
const DATE_PARSE = Date.parse;
const SYSTEM_SET_TIMEOUT = globalThis.setTimeout;
const SYSTEM_CLEAR_TIMEOUT = globalThis.clearTimeout;

export type ProviderPositionAdmissionDeadlineRunnerErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_REQUEST'
  | 'ADMISSION_ABORTED'
  | 'DEADLINE_EXCEEDED'
  | 'OPERATION_FAILED'
  | 'RUNTIME_UNAVAILABLE'
  | 'INVALID_ABORT_CAPABILITY';

export class ProviderPositionAdmissionDeadlineRunnerError extends Error {
  constructor(readonly code: ProviderPositionAdmissionDeadlineRunnerErrorCode) {
    super('Provider-position admission deadline execution is unavailable.');
    this.name = 'ProviderPositionAdmissionDeadlineRunnerError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Injectable only so deadline behavior can be verified without real waiting. */
export interface ProviderPositionAdmissionDeadlineTimerRuntime {
  schedule(callback: () => void, milliseconds: number): unknown;
  cancel(handle: unknown): void;
}

const SYSTEM_TIMER_RUNTIME: ProviderPositionAdmissionDeadlineTimerRuntime = Object.freeze({
  schedule(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout> {
    const handle = SYSTEM_SET_TIMEOUT(callback, milliseconds);
    handle.unref?.();
    return handle;
  },
  cancel(handle: unknown): void {
    SYSTEM_CLEAR_TIMEOUT(handle as ReturnType<typeof setTimeout>);
  },
});

interface ReviewedAbortSignal {
  aborted(): boolean;
  add(listener: EventListener): void;
  remove(listener: EventListener): void;
}

interface ParsedDeadlineRunRequest {
  readonly deadlineMilliseconds: number;
  readonly signal: ReviewedAbortSignal;
  readonly abortAdmission: () => void;
}

interface OperationSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

interface OperationFailure {
  readonly ok: false;
}

type OperationOutcome<T> = OperationSuccess<T> | OperationFailure;

function fail(code: ProviderPositionAdmissionDeadlineRunnerErrorCode): never {
  throw new ProviderPositionAdmissionDeadlineRunnerError(code);
}

function stableDataMember(value: unknown, key: PropertyKey): unknown {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    isProxy(value)
  ) {
    return undefined;
  }
  let current: object | null = value;
  for (let depth = 0; current !== null && depth < 8; depth += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor !== undefined) return 'value' in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function exactDataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || isProxy(value) || Array.isArray(value)) {
      return fail('INVALID_REQUEST');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail('INVALID_REQUEST');
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail('INVALID_REQUEST');
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return fail('INVALID_REQUEST');
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch (error) {
    if (error instanceof ProviderPositionAdmissionDeadlineRunnerError) throw error;
    return fail('INVALID_REQUEST');
  }
}

function reviewAbortSignal(value: unknown): ReviewedAbortSignal {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value) ||
      ABORT_SIGNAL_ABORTED_GETTER === undefined ||
      typeof EVENT_TARGET_ADD_EVENT_LISTENER !== 'function' ||
      typeof EVENT_TARGET_REMOVE_EVENT_LISTENER !== 'function'
    ) {
      return fail('INVALID_REQUEST');
    }
    const signal = value as AbortSignal;
    Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, signal, []);
    return Object.freeze({
      aborted: (): boolean => Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, signal, []) as boolean,
      add: (listener: EventListener): void => {
        Reflect.apply(EVENT_TARGET_ADD_EVENT_LISTENER, signal, ['abort', listener, { once: true }]);
      },
      remove: (listener: EventListener): void => {
        Reflect.apply(EVENT_TARGET_REMOVE_EVENT_LISTENER, signal, ['abort', listener]);
      },
    });
  } catch (error) {
    if (error instanceof ProviderPositionAdmissionDeadlineRunnerError) throw error;
    return fail('INVALID_REQUEST');
  }
}

function canonicalDeadline(value: unknown): number {
  if (
    typeof value !== 'string' ||
    !CANONICAL_TIMESTAMP.test(value) ||
    DATE_TO_ISO_STRING === undefined
  ) {
    return fail('INVALID_REQUEST');
  }
  const milliseconds = Reflect.apply(DATE_PARSE, Date, [value]) as number;
  if (!Number.isSafeInteger(milliseconds)) return fail('INVALID_REQUEST');
  try {
    if (Reflect.apply(DATE_TO_ISO_STRING, new Date(milliseconds), []) !== value) {
      return fail('INVALID_REQUEST');
    }
  } catch {
    return fail('INVALID_REQUEST');
  }
  return milliseconds;
}

function parseRunRequest(value: unknown): ParsedDeadlineRunRequest {
  const record = exactDataRecord(value, [
    'deadlineAt',
    'correlationId',
    'sourceFamilyId',
    'targetId',
    'signal',
    'abortAdmission',
  ]);
  if (
    typeof record.correlationId !== 'string' ||
    !CORRELATION_ID.test(record.correlationId) ||
    typeof record.sourceFamilyId !== 'string' ||
    !SOURCE_FAMILY_ID.test(record.sourceFamilyId) ||
    typeof record.targetId !== 'string' ||
    !TARGET_ID.test(record.targetId) ||
    typeof record.abortAdmission !== 'function'
  ) {
    return fail('INVALID_REQUEST');
  }
  return Object.freeze({
    deadlineMilliseconds: canonicalDeadline(record.deadlineAt),
    signal: reviewAbortSignal(record.signal),
    abortAdmission: record.abortAdmission as () => void,
  });
}

/**
 * Dormant Node deadline implementation. Deadline or abort changes the logical
 * result immediately, but this method deliberately waits for already-started
 * work to settle before returning so physical work cannot escape its caller.
 */
export class NodeProviderPositionAdmissionDeadlineRunner implements ProviderPositionAdmissionDeadlineRunner {
  private readonly readClock!: () => unknown;
  private readonly scheduleTimer!: (callback: () => void, milliseconds: number) => unknown;
  private readonly cancelTimer!: (handle: unknown) => void;

  constructor(
    clock: ProviderPositionAdmissionClock,
    timerRuntime: ProviderPositionAdmissionDeadlineTimerRuntime = SYSTEM_TIMER_RUNTIME,
  ) {
    const now = stableDataMember(clock, 'now');
    const schedule = stableDataMember(timerRuntime, 'schedule');
    const cancel = stableDataMember(timerRuntime, 'cancel');
    if (
      typeof now !== 'function' ||
      typeof schedule !== 'function' ||
      typeof cancel !== 'function'
    ) {
      return fail('INVALID_CONFIGURATION');
    }
    this.readClock = () => Reflect.apply(now, clock, []);
    this.scheduleTimer = (callback, milliseconds) =>
      Reflect.apply(schedule, timerRuntime, [callback, milliseconds]) as unknown;
    this.cancelTimer = (handle) => {
      Reflect.apply(cancel, timerRuntime, [handle]);
    };
  }

  async run<T>(
    requestInput: ProviderPositionAdmissionDeadlineRunRequestV1,
    operation: () => Promise<T>,
  ): Promise<T> {
    const request = parseRunRequest(requestInput);
    if (typeof operation !== 'function') return fail('INVALID_REQUEST');
    if (request.signal.aborted()) return fail('ADMISSION_ABORTED');

    let startedAt: number;
    try {
      startedAt = this.clockMilliseconds();
    } catch {
      this.abortOrFail(request);
      return fail('RUNTIME_UNAVAILABLE');
    }
    const remaining = request.deadlineMilliseconds - startedAt;
    if (remaining <= 0) {
      this.abortOrFail(request);
      return fail('DEADLINE_EXCEEDED');
    }
    if (remaining > MAX_DEADLINE_MILLISECONDS) {
      this.abortOrFail(request);
      return fail('INVALID_REQUEST');
    }

    return this.runStarted(request, operation, startedAt, remaining);
  }

  private async runStarted<T>(
    request: ParsedDeadlineRunRequest,
    operation: () => Promise<T>,
    startedAt: number,
    remaining: number,
  ): Promise<T> {
    let cause: ProviderPositionAdmissionDeadlineRunnerErrorCode | null = null;
    let timer: unknown;
    let timerCreated = false;
    let listening = false;
    const abortWith = (nextCause: ProviderPositionAdmissionDeadlineRunnerErrorCode): void => {
      cause ??= nextCause;
      try {
        this.abortOrFail(request);
      } catch {
        cause = 'INVALID_ABORT_CAPABILITY';
      }
    };
    const onAbort = (): void => {
      cause ??= 'ADMISSION_ABORTED';
    };

    try {
      request.signal.add(onAbort);
      listening = true;
      if (request.signal.aborted()) onAbort();
      if (cause !== null) return fail(cause);

      try {
        timer = this.scheduleTimer(() => {
          if (cause !== null) return;
          const observedAt = this.tryClockMilliseconds();
          abortWith(
            observedAt === null || observedAt < startedAt
              ? 'RUNTIME_UNAVAILABLE'
              : observedAt < request.deadlineMilliseconds
                ? 'RUNTIME_UNAVAILABLE'
                : 'DEADLINE_EXCEEDED',
          );
        }, remaining);
        timerCreated = true;
      } catch {
        abortWith('RUNTIME_UNAVAILABLE');
        return fail(cause ?? 'RUNTIME_UNAVAILABLE');
      }

      if (request.signal.aborted()) onAbort();
      if (cause !== null) return fail(cause);

      const outcome: OperationOutcome<T> = await Promise.resolve()
        .then(() => {
          if (request.signal.aborted()) {
            onAbort();
            return fail(cause ?? 'ADMISSION_ABORTED');
          }
          return operation();
        })
        .then<OperationOutcome<T>, OperationOutcome<T>>(
          (value) => Object.freeze({ ok: true, value }),
          () => Object.freeze({ ok: false }),
        );

      if (!outcome.ok && cause === null) abortWith('OPERATION_FAILED');
      const completedAt = this.tryClockMilliseconds();
      if (completedAt === null || completedAt < startedAt) {
        abortWith('RUNTIME_UNAVAILABLE');
      } else if (
        cause !== 'INVALID_ABORT_CAPABILITY' &&
        completedAt >= request.deadlineMilliseconds
      ) {
        cause = 'DEADLINE_EXCEEDED';
        try {
          this.abortOrFail(request);
        } catch {
          cause = 'INVALID_ABORT_CAPABILITY';
        }
      } else if (request.signal.aborted() && cause === null) {
        cause = 'ADMISSION_ABORTED';
      }

      if (cause !== null) return fail(cause);
      if (!outcome.ok) return fail('OPERATION_FAILED');
      return outcome.value;
    } finally {
      let cleanupFailed = false;
      if (timerCreated) {
        try {
          this.cancelTimer(timer);
        } catch {
          cleanupFailed = true;
        }
      }
      if (listening) {
        try {
          request.signal.remove(onAbort);
        } catch {
          cleanupFailed = true;
        }
      }
      if (cleanupFailed) {
        try {
          this.abortOrFail(request);
        } catch {
          // The sanitized runtime failure below remains authoritative.
        }
        fail('RUNTIME_UNAVAILABLE');
      }
    }
  }

  private abortOrFail(request: ParsedDeadlineRunRequest): void {
    try {
      Reflect.apply(request.abortAdmission, undefined, []);
    } catch {
      return fail('INVALID_ABORT_CAPABILITY');
    }
    if (!request.signal.aborted()) return fail('INVALID_ABORT_CAPABILITY');
  }

  private clockMilliseconds(): number {
    if (DATE_GET_TIME === undefined) return fail('RUNTIME_UNAVAILABLE');
    const value = this.readClock();
    if (
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Date.prototype
    ) {
      return fail('RUNTIME_UNAVAILABLE');
    }
    try {
      const milliseconds = Reflect.apply(DATE_GET_TIME, value, []) as number;
      if (!Number.isSafeInteger(milliseconds)) return fail('RUNTIME_UNAVAILABLE');
      return milliseconds;
    } catch {
      return fail('RUNTIME_UNAVAILABLE');
    }
  }

  private tryClockMilliseconds(): number | null {
    try {
      return this.clockMilliseconds();
    } catch {
      return null;
    }
  }
}
