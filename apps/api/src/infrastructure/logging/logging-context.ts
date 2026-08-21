import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const CORRELATION_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export interface LogCorrelationContext {
  readonly correlationId: string;
  readonly requestId?: string;
  /** Verified initiating principal; never the worker/runtime executor identity. */
  readonly initiatorActorId?: string;
  readonly jobId?: string;
  readonly intentId?: string;
  readonly quoteId?: string;
  readonly transactionId?: string;
  readonly ledgerEventId?: string;
}

interface MutableLogCorrelationContext {
  correlationId: string;
  requestId?: string;
  initiatorActorId?: string;
  jobId?: string;
  intentId?: string;
  quoteId?: string;
  transactionId?: string;
  ledgerEventId?: string;
}

export type LogContextExtension = Partial<LogCorrelationContext>;

function assertCorrelationValue(value: string, name: string): void {
  if (!CORRELATION_VALUE_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a bounded opaque identifier`);
  }
}

function validateContext(context: LogCorrelationContext): MutableLogCorrelationContext {
  assertCorrelationValue(context.correlationId, 'correlationId');
  const validated: MutableLogCorrelationContext = { correlationId: context.correlationId };
  for (const name of [
    'requestId',
    'initiatorActorId',
    'jobId',
    'intentId',
    'quoteId',
    'transactionId',
    'ledgerEventId',
  ] as const) {
    const value = context[name];
    if (value === undefined) continue;
    assertCorrelationValue(value, name);
    validated[name] = value;
  }
  return validated;
}

/** Creates a server-authoritative root context; caller-supplied headers are not accepted. */
export function createRootLogContext(): LogCorrelationContext {
  const requestId = randomUUID();
  return Object.freeze({ correlationId: requestId, requestId });
}

/**
 * Carries bounded identifiers across asynchronous application work without
 * request-scoped dependency-injection overhead.
 */
export class LoggingContext {
  private readonly storage = new AsyncLocalStorage<MutableLogCorrelationContext>();

  run<T>(context: LogCorrelationContext, work: () => T): T {
    return this.storage.run(validateContext(context), work);
  }

  runWith<T>(extension: LogContextExtension, work: () => T): T {
    const current = this.storage.getStore();
    const correlationId = extension.correlationId ?? current?.correlationId;
    if (!correlationId) {
      throw new Error('A correlationId is required to start a logging context');
    }
    return this.run({ ...current, ...extension, correlationId }, work);
  }

  current(): Readonly<LogCorrelationContext> | undefined {
    const current = this.storage.getStore();
    return current ? Object.freeze({ ...current }) : undefined;
  }

  requireCurrent(): Readonly<LogCorrelationContext> {
    const current = this.current();
    if (!current) {
      throw new Error('No logging correlation context is active');
    }
    return current;
  }

  /** Captures the current store for callbacks fired by an older async resource. */
  capture(): <T>(work: () => T) => T {
    const current = this.storage.getStore();
    return <T>(work: () => T): T => (current ? this.storage.run(current, work) : work());
  }

  /** Binds only a principal already verified by the authentication boundary. */
  bindActorId(actorId: string): boolean {
    assertCorrelationValue(actorId, 'initiatorActorId');
    const current = this.storage.getStore();
    if (!current) return false;
    if (current.initiatorActorId && current.initiatorActorId !== actorId) {
      throw new Error('Logging context actor cannot be rebound');
    }
    current.initiatorActorId = actorId;
    return true;
  }

  clearActorId(): void {
    const current = this.storage.getStore();
    if (current) delete current.initiatorActorId;
  }
}

export const loggingContext = new LoggingContext();
