import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LEGACY_CORRELATION_PATTERN = /^legacy:[a-f0-9]{64}$/u;
const LOG_REFERENCE_PATTERN = /^(?:job|message):[a-f0-9]{64}$/u;
const MAX_OPAQUE_REFERENCE_INPUT_LENGTH = 4_096;

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

const CONTEXT_KEYS = [
  'correlationId',
  'requestId',
  'initiatorActorId',
  'jobId',
  'intentId',
  'quoteId',
  'transactionId',
  'ledgerEventId',
] as const;

export type LogContextExtension = Partial<LogCorrelationContext>;

export function isCanonicalUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

export function isSafeCorrelationId(value: unknown): value is string {
  return (
    isCanonicalUuidV4(value) ||
    (typeof value === 'string' && LEGACY_CORRELATION_PATTERN.test(value))
  );
}

export function isSafeLogReference(value: unknown): value is string {
  return typeof value === 'string' && LOG_REFERENCE_PATTERN.test(value);
}

/**
 * Converts opaque provider/job identifiers into domain-separated diagnostic
 * references. Raw identifiers never cross the logging boundary.
 */
export function createSafeLogReference(
  namespace: 'job' | 'message',
  value: unknown,
): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > MAX_OPAQUE_REFERENCE_INPUT_LENGTH
  ) {
    return undefined;
  }
  try {
    const digest = createHash('sha256')
      .update(`crypto-lending:log-reference:${namespace}:`)
      .update(value)
      .digest('hex');
    return `${namespace}:${digest}`;
  } catch {
    return undefined;
  }
}

export function createSafeLegacyCorrelationId(
  namespace: 'job' | 'message',
  value: unknown,
): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > MAX_OPAQUE_REFERENCE_INPUT_LENGTH
  ) {
    return undefined;
  }
  try {
    const digest = createHash('sha256')
      .update(`crypto-lending:legacy-correlation:${namespace}:`)
      .update(value)
      .digest('hex');
    return `legacy:${digest}`;
  } catch {
    return undefined;
  }
}

function assertContextValue(value: string, name: keyof LogCorrelationContext): void {
  const valid =
    name === 'correlationId'
      ? isSafeCorrelationId(value)
      : name === 'jobId'
        ? isSafeLogReference(value) && value.startsWith('job:')
        : isCanonicalUuidV4(value);
  if (!valid) {
    throw new TypeError(`${name} must use its canonical diagnostic identifier format`);
  }
}

function contextDescriptors(value: unknown): PropertyDescriptorMap {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Logging context must be a plain data record');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Logging context must be a plain data record');
    }
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new TypeError('Logging context must be a plain data record');
  }
}

function dataValue(descriptors: PropertyDescriptorMap, name: keyof LogCorrelationContext): unknown {
  const descriptor = Object.hasOwn(descriptors, name) ? descriptors[name] : undefined;
  if (!descriptor) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError(`${name} must be an own data property`);
  }
  return descriptor.value;
}

function emptyMutableContext(): MutableLogCorrelationContext {
  return Object.create(null) as MutableLogCorrelationContext;
}

function validateContext(context: LogCorrelationContext): MutableLogCorrelationContext {
  const descriptors = contextDescriptors(context);
  const correlationId = dataValue(descriptors, 'correlationId');
  if (typeof correlationId !== 'string') {
    throw new TypeError('correlationId must be an own data property');
  }
  assertContextValue(correlationId, 'correlationId');
  const validated = emptyMutableContext();
  validated.correlationId = correlationId;
  for (const name of CONTEXT_KEYS.slice(1)) {
    const value = dataValue(descriptors, name);
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      throw new TypeError(`${name} must use its canonical diagnostic identifier format`);
    }
    assertContextValue(value, name);
    validated[name] = value;
  }
  if (validated.requestId !== undefined && validated.requestId !== correlationId) {
    throw new TypeError('requestId must equal the root correlationId');
  }
  if (
    correlationId.startsWith('legacy:') &&
    CONTEXT_KEYS.slice(1).some((name) => name !== 'jobId' && validated[name] !== undefined)
  ) {
    throw new TypeError('Legacy correlation contexts cannot carry optional identifiers');
  }
  return validated;
}

function validateExtension(extension: LogContextExtension): Partial<MutableLogCorrelationContext> {
  const descriptors = contextDescriptors(extension);
  const validated = Object.create(null) as Partial<MutableLogCorrelationContext>;
  for (const name of CONTEXT_KEYS) {
    const value = dataValue(descriptors, name);
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      throw new TypeError(`${name} must use its canonical diagnostic identifier format`);
    }
    assertContextValue(value, name);
    validated[name] = value;
  }
  return validated;
}

function copyContext(
  source: Readonly<Partial<MutableLogCorrelationContext>>,
): MutableLogCorrelationContext {
  const copy = emptyMutableContext();
  for (const name of CONTEXT_KEYS) {
    const value = source[name];
    if (value !== undefined) copy[name] = value;
  }
  if (!copy.correlationId) throw new Error('A correlationId is required');
  return copy;
}

/** Creates a server-authoritative root context; caller-supplied headers are not accepted. */
export function createRootLogContext(): LogCorrelationContext {
  const requestId = randomUUID();
  const context = emptyMutableContext();
  context.correlationId = requestId;
  context.requestId = requestId;
  return Object.freeze(context);
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
    const validatedExtension = validateExtension(extension);
    if (
      current &&
      validatedExtension.correlationId !== undefined &&
      validatedExtension.correlationId !== current.correlationId
    ) {
      throw new Error('Logging context root correlation cannot be replaced');
    }
    if (current) {
      for (const name of CONTEXT_KEYS.slice(1)) {
        const replacement = validatedExtension[name];
        const existing = current[name];
        if (replacement !== undefined && existing !== undefined && replacement !== existing) {
          throw new Error(`Logging context ${name} cannot be replaced`);
        }
      }
    }
    const correlationId = validatedExtension.correlationId ?? current?.correlationId;
    if (!correlationId) {
      throw new Error('A correlationId is required to start a logging context');
    }
    const merged = emptyMutableContext();
    if (current) {
      for (const name of CONTEXT_KEYS) {
        const value = current[name];
        if (value !== undefined) merged[name] = value;
      }
    }
    for (const name of CONTEXT_KEYS) {
      const value = validatedExtension[name];
      if (value !== undefined) merged[name] = value;
    }
    merged.correlationId = correlationId;
    return this.storage.run(validateContext(merged), work);
  }

  current(): Readonly<LogCorrelationContext> | undefined {
    const current = this.storage.getStore();
    return current ? Object.freeze(copyContext(current)) : undefined;
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
    assertContextValue(actorId, 'initiatorActorId');
    const current = this.storage.getStore();
    if (!current) return false;
    if (current.correlationId.startsWith('legacy:')) {
      throw new Error('Legacy correlation contexts cannot bind an initiating actor');
    }
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
