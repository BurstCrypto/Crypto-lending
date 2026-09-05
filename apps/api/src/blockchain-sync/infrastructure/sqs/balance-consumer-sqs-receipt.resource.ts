import { performance } from 'node:perf_hooks';

import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { fromHttp } from '@aws-sdk/credential-provider-http';

import {
  assertBalanceConsumerSqsReceiptRedrivePolicy,
  type RuntimeInfrastructureConfig,
} from '../../../infrastructure/config/infrastructure.config';
import { parseJobEnvelope, type JobEnvelope } from '../../../infrastructure/outbox/job-envelope';
import type { PinnedSqsQueueReceiptPort } from '../../../infrastructure/sqs/sqs-queue-receipt.port';
import type { ReceivedQueueMessage } from '../../../infrastructure/sqs/sqs.types';

const LOCAL_SQS_CREDENTIALS = Object.freeze({
  accessKeyId: 'local-emulator',
  secretAccessKey: 'local-emulator',
});
const LOCAL_SQS_HOSTNAMES = new Set(['127.0.0.1', '[::1]', '::1', 'localhost', 'localstack']);
const SQS_APPROXIMATE_RECEIVE_COUNT = /^[1-9][0-9]{0,15}$/u;
const COMMERCIAL_AWS_REGION =
  /^(?!(?:us-(?:gov|iso|isob|isof)|eu-isoe)-)(?:af|ap|ca|eu|il|me|mx|sa|us)-(?:[a-z]+-)?[a-z]+-[1-9][0-9]*$/u;
const BALANCE_CONSUMER_QUEUE_PATH =
  /^\/\d{12}\/crypto-lending-(?:dev|test|qa|sandbox|staging)(?:-[a-z0-9]+)*-balance-sync$/u;
const TRUSTED_INPUT_ERRORS = new WeakSet<object>();

interface ReviewedBalanceConsumerSqsReceiptConfiguration {
  readonly region: string;
  readonly endpoint?: string;
  readonly credentialRelativeUri?: string;
  readonly requestTimeoutMs: number;
  readonly sdkMaxAttempts: number;
  readonly visibilityTimeoutSeconds: number;
  readonly balanceQueueUrl: string;
}

export interface BalanceConsumerSqsReceiptResource {
  readonly receipt: Readonly<PinnedSqsQueueReceiptPort>;
  readonly close: () => Promise<void>;
}

class BalanceConsumerSqsReceiptConfigurationError extends Error {
  readonly code = 'BALANCE_CONSUMER_SQS_RECEIPT_CONFIGURATION_INVALID' as const;

  constructor() {
    super('Balance consumer SQS receipt configuration is invalid');
    this.name = 'BalanceConsumerSqsReceiptConfigurationError';
  }
}

class BalanceConsumerSqsReceiptConstructionError extends Error {
  readonly code = 'BALANCE_CONSUMER_SQS_RECEIPT_CONSTRUCTION_FAILED' as const;

  constructor() {
    super('Balance consumer SQS receipt construction failed');
    this.name = 'BalanceConsumerSqsReceiptConstructionError';
  }
}

class BalanceConsumerSqsReceiptCloseError extends Error {
  readonly code = 'BALANCE_CONSUMER_SQS_RECEIPT_CLOSE_FAILED' as const;

  constructor() {
    super('Balance consumer SQS receipt close failed');
    this.name = 'BalanceConsumerSqsReceiptCloseError';
  }
}

class BalanceConsumerSqsReceiptClosedError extends Error {
  readonly code = 'BALANCE_CONSUMER_SQS_RECEIPT_CLOSED' as const;

  constructor() {
    super('Balance consumer SQS receipt is closed');
    this.name = 'BalanceConsumerSqsReceiptClosedError';
  }
}

class BalanceConsumerSqsReceiptInputError extends Error {
  readonly code = 'BALANCE_CONSUMER_SQS_RECEIPT_INPUT_INVALID' as const;

  constructor() {
    super('Balance consumer SQS receipt input is invalid');
    this.name = 'BalanceConsumerSqsReceiptInputError';
    TRUSTED_INPUT_ERRORS.add(this);
  }
}

class BalanceConsumerSqsReceiptOperationError extends Error {
  readonly code = 'BALANCE_CONSUMER_SQS_RECEIPT_OPERATION_FAILED' as const;

  constructor() {
    super('Balance consumer SQS receipt operation failed');
    this.name = 'BalanceConsumerSqsReceiptOperationError';
  }
}

function invalidConfiguration(): never {
  throw new BalanceConsumerSqsReceiptConfigurationError();
}

function selectedDataRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return invalidConfiguration();
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return invalidConfiguration();

    const result = Object.create(null) as Record<string, unknown>;
    for (const key of requiredKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return invalidConfiguration();
      result[key] = descriptor.value;
    }
    for (const key of optionalKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) continue;
      if (!descriptor.enumerable || !('value' in descriptor)) return invalidConfiguration();
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return invalidConfiguration();
  }
}

function boundedInteger(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    return invalidConfiguration();
  }
  return value as number;
}

function canonicalRegion(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 64 ||
    value.trim() !== value ||
    !COMMERCIAL_AWS_REGION.test(value)
  ) {
    return invalidConfiguration();
  }
  return value;
}

function canonicalLocalEndpoint(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 2_048 ||
    value.trim() !== value
  ) {
    return invalidConfiguration();
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'http:' ||
      !LOCAL_SQS_HOSTNAMES.has(parsed.hostname.toLowerCase()) ||
      parsed.port !== '4566' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      parsed.origin !== value
    ) {
      return invalidConfiguration();
    }
    return parsed.origin;
  } catch {
    return invalidConfiguration();
  }
}

function canonicalCredentialRelativeUri(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    !/^\/v2\/credentials\/[A-Za-z0-9_-]{1,200}$/u.test(value)
  ) {
    return invalidConfiguration();
  }
  return value;
}

function canonicalBalanceQueueUrl(
  value: unknown,
  region: string,
  endpoint: string | undefined,
): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 2_048 ||
    value.trim() !== value
  ) {
    return invalidConfiguration();
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.toString() !== value ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      !BALANCE_CONSUMER_QUEUE_PATH.test(parsed.pathname)
    ) {
      return invalidConfiguration();
    }

    if (endpoint !== undefined) {
      if (parsed.protocol !== 'http:' || parsed.origin !== endpoint) {
        return invalidConfiguration();
      }
      return value;
    }

    if (
      parsed.protocol !== 'https:' ||
      parsed.port !== '' ||
      parsed.hostname !== `sqs.${region}.amazonaws.com`
    ) {
      return invalidConfiguration();
    }
    return value;
  } catch {
    return invalidConfiguration();
  }
}

function reviewedConfiguration(
  infrastructureConfig: RuntimeInfrastructureConfig,
): Readonly<ReviewedBalanceConsumerSqsReceiptConfiguration> {
  try {
    const infrastructure = selectedDataRecord(infrastructureConfig, ['workload', 'sqs']);
    if (infrastructure.workload !== 'balance-consumer') return invalidConfiguration();
    const sqs = selectedDataRecord(
      infrastructure.sqs,
      [
        'region',
        'requestTimeoutMs',
        'sdkMaxAttempts',
        'maxReceiveCount',
        'visibilityTimeoutSeconds',
        'retryBaseDelaySeconds',
        'retryMaxDelaySeconds',
        'balanceQueueUrl',
      ],
      ['endpoint', 'credentialRelativeUri'],
    );

    const region = canonicalRegion(sqs.region);
    const endpoint = canonicalLocalEndpoint(sqs.endpoint);
    const credentialRelativeUri = canonicalCredentialRelativeUri(sqs.credentialRelativeUri);
    if ((endpoint === undefined) === (credentialRelativeUri === undefined)) {
      return invalidConfiguration();
    }

    const requestTimeoutMs = boundedInteger(sqs.requestTimeoutMs, 60_000);
    const sdkMaxAttempts = boundedInteger(sqs.sdkMaxAttempts, 10);
    const maxReceiveCount = boundedInteger(sqs.maxReceiveCount, 100);
    const visibilityTimeoutSeconds = boundedInteger(sqs.visibilityTimeoutSeconds, 43_200);
    const retryBaseDelaySeconds = boundedInteger(sqs.retryBaseDelaySeconds, 900);
    const retryMaxDelaySeconds = boundedInteger(sqs.retryMaxDelaySeconds, 900);
    assertBalanceConsumerSqsReceiptRedrivePolicy({
      maxReceiveCount,
      retryBaseDelaySeconds,
      retryMaxDelaySeconds,
    });
    const balanceQueueUrl = canonicalBalanceQueueUrl(sqs.balanceQueueUrl, region, endpoint);

    return Object.freeze({
      region,
      ...(endpoint === undefined ? {} : { endpoint }),
      ...(credentialRelativeUri === undefined ? {} : { credentialRelativeUri }),
      requestTimeoutMs,
      sdkMaxAttempts,
      visibilityTimeoutSeconds,
      balanceQueueUrl,
    });
  } catch {
    return invalidConfiguration();
  }
}

function createRawSqsClient(
  config: Readonly<ReviewedBalanceConsumerSqsReceiptConfiguration>,
): SQSClient {
  const credentialRelativeUri = config.credentialRelativeUri;
  const credentials =
    config.endpoint !== undefined
      ? LOCAL_SQS_CREDENTIALS
      : credentialRelativeUri === undefined
        ? (() => {
            throw new BalanceConsumerSqsReceiptConstructionError();
          })()
        : fromHttp({
            awsContainerCredentialsRelativeUri: credentialRelativeUri,
            awsContainerCredentialsFullUri: '',
            awsContainerAuthorizationToken: '',
            awsContainerAuthorizationTokenFile: '',
            maxRetries: 2,
            timeout: 1_000,
          });
  return new SQSClient({
    region: config.region,
    maxAttempts: config.sdkMaxAttempts,
    defaultsMode: 'standard',
    retryMode: 'standard',
    useFipsEndpoint: false,
    useDualstackEndpoint: false,
    useQueueUrlAsEndpoint: false,
    ignoreConfiguredEndpointUrls: true,
    credentials,
    ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
  });
}

interface RequestAbortScope {
  readonly signal: AbortSignal;
  close(): void;
}

interface ReviewedAbortSignal {
  readonly aborted: () => boolean;
  readonly addAbortListener: (listener: () => void) => void;
  readonly removeAbortListener: (listener: () => void) => void;
}

function reviewedAbortSignal(value: AbortSignal | undefined): ReviewedAbortSignal | undefined {
  if (value === undefined) return undefined;
  try {
    const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
    if (!abortedGetter) throw new BalanceConsumerSqsReceiptInputError();
    const aborted = (): boolean => abortedGetter.call(value) as boolean;
    aborted();
    return Object.freeze({
      aborted,
      addAbortListener: (listener: () => void): void => {
        EventTarget.prototype.addEventListener.call(value, 'abort', listener, { once: true });
      },
      removeAbortListener: (listener: () => void): void => {
        EventTarget.prototype.removeEventListener.call(value, 'abort', listener);
      },
    });
  } catch {
    throw new BalanceConsumerSqsReceiptInputError();
  }
}

function requestAbortScope(
  suppliedSignal: AbortSignal | undefined,
  lifecycleSignal: AbortSignal,
  timeoutMs: number,
): RequestAbortScope {
  const supplied = reviewedAbortSignal(suppliedSignal);
  const lifecycle = reviewedAbortSignal(lifecycleSignal);
  if (lifecycle === undefined) throw new BalanceConsumerSqsReceiptInputError();
  const signals = supplied === undefined ? [lifecycle] : [supplied, lifecycle];
  const controller = new AbortController();
  const listening: ReviewedAbortSignal[] = [];
  let timeout: NodeJS.Timeout | undefined;
  const onAbort = (): void => {
    controller.abort(new Error('SQS request aborted'));
  };
  try {
    for (const signal of signals) {
      if (signal.aborted()) {
        onAbort();
        break;
      }
      signal.addAbortListener(onAbort);
      listening.push(signal);
      if (signal.aborted()) onAbort();
    }
    timeout = setTimeout(
      () => controller.abort(new Error(`SQS request timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    timeout.unref();
  } catch {
    if (timeout !== undefined) clearTimeout(timeout);
    for (const signal of listening) {
      try {
        signal.removeAbortListener(onAbort);
      } catch {
        // The fixed input error below remains the only construction detail.
      }
    }
    throw new BalanceConsumerSqsReceiptInputError();
  }
  return {
    signal: controller.signal,
    close: () => {
      if (!controller.signal.aborted) {
        controller.abort(new Error('SQS request scope closed'));
      }
      if (timeout !== undefined) clearTimeout(timeout);
      for (const signal of listening) signal.removeAbortListener(onAbort);
    },
  };
}

function parseApproximateReceiveCount(value: unknown): number {
  if (typeof value !== 'string' || !SQS_APPROXIMATE_RECEIVE_COUNT.test(value)) {
    throw new BalanceConsumerSqsReceiptInputError();
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new BalanceConsumerSqsReceiptInputError();
  }
  return parsed;
}

function receiptHandleSnapshot(message: ReceivedQueueMessage): string {
  try {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      throw new BalanceConsumerSqsReceiptInputError();
    }
    const prototype = Object.getPrototypeOf(message) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new BalanceConsumerSqsReceiptInputError();
    }
    const descriptor = Object.getOwnPropertyDescriptor(message, 'receiptHandle');
    if (
      !descriptor?.enumerable ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string' ||
      descriptor.value.length < 1 ||
      descriptor.value.length > 16_384 ||
      descriptor.value.trim() !== descriptor.value ||
      /[\0\r\n]/u.test(descriptor.value)
    ) {
      throw new BalanceConsumerSqsReceiptInputError();
    }
    return descriptor.value;
  } catch {
    throw new BalanceConsumerSqsReceiptInputError();
  }
}

function dataProperty(value: object, name: string, required: true): unknown;
function dataProperty(value: object, name: string, required: false): unknown | undefined;
function dataProperty(value: object, name: string, required: boolean): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (descriptor === undefined) {
    if (required) throw new BalanceConsumerSqsReceiptInputError();
    return undefined;
  }
  if (!descriptor.enumerable || !('value' in descriptor)) {
    throw new BalanceConsumerSqsReceiptInputError();
  }
  return descriptor.value;
}

function receivedMessages(
  response: unknown,
  maximumMessages: number,
  receivedAtMonotonicMs: number,
): ReceivedQueueMessage[] {
  try {
    if (
      typeof response !== 'object' ||
      response === null ||
      Array.isArray(response) ||
      !Number.isFinite(receivedAtMonotonicMs) ||
      receivedAtMonotonicMs < 0
    ) {
      throw new BalanceConsumerSqsReceiptInputError();
    }
    const responsePrototype = Object.getPrototypeOf(response) as unknown;
    if (responsePrototype !== Object.prototype && responsePrototype !== null) {
      throw new BalanceConsumerSqsReceiptInputError();
    }
    const rawMessages = dataProperty(response, 'Messages', false);
    if (rawMessages === undefined) return Object.freeze([]) as unknown as ReceivedQueueMessage[];
    if (!Array.isArray(rawMessages)) throw new BalanceConsumerSqsReceiptInputError();
    const lengthDescriptor = Object.getOwnPropertyDescriptor(rawMessages, 'length');
    const length = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : -1;
    if (
      !Number.isSafeInteger(length) ||
      (length as number) < 0 ||
      (length as number) > maximumMessages ||
      (length as number) > 10
    ) {
      throw new BalanceConsumerSqsReceiptInputError();
    }

    const parsed: ReceivedQueueMessage[] = [];
    for (let index = 0; index < (length as number); index += 1) {
      const rawMessage = dataProperty(rawMessages, String(index), true);
      if (typeof rawMessage !== 'object' || rawMessage === null || Array.isArray(rawMessage)) {
        throw new BalanceConsumerSqsReceiptInputError();
      }
      const messagePrototype = Object.getPrototypeOf(rawMessage) as unknown;
      if (messagePrototype !== Object.prototype && messagePrototype !== null) {
        throw new BalanceConsumerSqsReceiptInputError();
      }
      const messageId = dataProperty(rawMessage, 'MessageId', true);
      const receiptHandle = dataProperty(rawMessage, 'ReceiptHandle', true);
      const body = dataProperty(rawMessage, 'Body', true);
      const attributes = dataProperty(rawMessage, 'Attributes', true);
      if (
        typeof messageId !== 'string' ||
        messageId.length < 1 ||
        messageId.length > 128 ||
        messageId.trim() !== messageId ||
        typeof receiptHandle !== 'string' ||
        receiptHandle.length < 1 ||
        receiptHandle.length > 16_384 ||
        receiptHandle.trim() !== receiptHandle ||
        /[\0\r\n]/u.test(receiptHandle) ||
        typeof body !== 'string' ||
        typeof attributes !== 'object' ||
        attributes === null ||
        Array.isArray(attributes)
      ) {
        throw new BalanceConsumerSqsReceiptInputError();
      }
      const attributesPrototype = Object.getPrototypeOf(attributes) as unknown;
      if (attributesPrototype !== Object.prototype && attributesPrototype !== null) {
        throw new BalanceConsumerSqsReceiptInputError();
      }
      const receiveCount = parseApproximateReceiveCount(
        dataProperty(attributes, 'ApproximateReceiveCount', true),
      );
      parsed.push(
        frozenNullPrototype<ReceivedQueueMessage>({
          messageId,
          receiptHandle,
          body,
          receiveCount,
          receivedAtMonotonicMs,
        }) as ReceivedQueueMessage,
      );
    }
    return Object.freeze(parsed) as unknown as ReceivedQueueMessage[];
  } catch {
    throw new BalanceConsumerSqsReceiptInputError();
  }
}

class BalanceConsumerSqsReceiptTransport implements PinnedSqsQueueReceiptPort {
  readonly #client: SQSClient;
  readonly #lifecycleSignal: AbortSignal;
  readonly #queueUrl: string;
  readonly #requestTimeoutMs: number;
  readonly #visibilityTimeoutSeconds: number;

  constructor(
    client: SQSClient,
    config: Readonly<ReviewedBalanceConsumerSqsReceiptConfiguration>,
    lifecycleSignal: AbortSignal,
  ) {
    if (typeof client.send !== 'function' || typeof client.destroy !== 'function') {
      throw new BalanceConsumerSqsReceiptConstructionError();
    }
    this.#client = client;
    this.#lifecycleSignal = lifecycleSignal;
    this.#queueUrl = config.balanceQueueUrl;
    this.#requestTimeoutMs = config.requestTimeoutMs;
    this.#visibilityTimeoutSeconds = config.visibilityTimeoutSeconds;
  }

  async receive(
    maxMessages = 1,
    waitTimeSeconds = 10,
    abortSignal?: AbortSignal,
  ): Promise<ReceivedQueueMessage[]> {
    if (!Number.isSafeInteger(maxMessages) || maxMessages < 1 || maxMessages > 10) {
      throw new BalanceConsumerSqsReceiptInputError();
    }
    if (!Number.isSafeInteger(waitTimeSeconds) || waitTimeSeconds < 0 || waitTimeSeconds > 20) {
      throw new BalanceConsumerSqsReceiptInputError();
    }

    const receivedAtMonotonicMs = performance.now();
    const request = requestAbortScope(
      abortSignal,
      this.#lifecycleSignal,
      Math.max(this.#requestTimeoutMs, waitTimeSeconds * 1_000 + 5_000),
    );
    let response;
    try {
      response = await this.#client.send(
        new ReceiveMessageCommand({
          QueueUrl: this.#queueUrl,
          MaxNumberOfMessages: maxMessages,
          WaitTimeSeconds: waitTimeSeconds,
          VisibilityTimeout: this.#visibilityTimeoutSeconds,
          MessageSystemAttributeNames: ['ApproximateReceiveCount'],
        }),
        { abortSignal: request.signal },
      );
    } finally {
      request.close();
    }

    return receivedMessages(response, maxMessages, receivedAtMonotonicMs);
  }

  async delete(message: ReceivedQueueMessage, abortSignal?: AbortSignal): Promise<void> {
    const receiptHandle = receiptHandleSnapshot(message);
    const request = requestAbortScope(abortSignal, this.#lifecycleSignal, this.#requestTimeoutMs);
    try {
      await this.#client.send(
        new DeleteMessageCommand({
          QueueUrl: this.#queueUrl,
          ReceiptHandle: receiptHandle,
        }),
        { abortSignal: request.signal },
      );
    } finally {
      request.close();
    }
  }

  async changeVisibility(
    message: ReceivedQueueMessage,
    visibilityTimeoutSeconds: number,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    if (
      !Number.isSafeInteger(visibilityTimeoutSeconds) ||
      visibilityTimeoutSeconds < 0 ||
      visibilityTimeoutSeconds > 43_200
    ) {
      throw new BalanceConsumerSqsReceiptInputError();
    }
    const receiptHandle = receiptHandleSnapshot(message);
    const request = requestAbortScope(abortSignal, this.#lifecycleSignal, this.#requestTimeoutMs);
    try {
      await this.#client.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: this.#queueUrl,
          ReceiptHandle: receiptHandle,
          VisibilityTimeout: visibilityTimeoutSeconds,
        }),
        { abortSignal: request.signal },
      );
    } finally {
      request.close();
    }
  }

  parseEnvelope<Payload = unknown>(body: string): JobEnvelope<Payload> {
    try {
      if (typeof body !== 'string') throw new BalanceConsumerSqsReceiptInputError();
      return parseJobEnvelope<Payload>(JSON.parse(body) as unknown);
    } catch {
      throw new BalanceConsumerSqsReceiptInputError();
    }
  }
}

function frozenNullPrototype<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

function destroyClient(
  client: SQSClient,
  failure: () => BalanceConsumerSqsReceiptConstructionError | BalanceConsumerSqsReceiptCloseError,
): Promise<void> {
  return Promise.resolve()
    .then(() => client.destroy())
    .then(
      () => undefined,
      () => {
        throw failure();
      },
    );
}

/** Builds an inert, source-pinned receipt capsule without starting any SQS work. */
export async function createDormantBalanceConsumerSqsReceiptResource(
  infrastructureConfig: RuntimeInfrastructureConfig,
): Promise<Readonly<BalanceConsumerSqsReceiptResource>> {
  const reviewed = reviewedConfiguration(infrastructureConfig);
  let client: SQSClient | undefined;
  let lifecycle: AbortController | undefined;

  try {
    client = createRawSqsClient(reviewed);
    lifecycle = new AbortController();
    const transport = new BalanceConsumerSqsReceiptTransport(client, reviewed, lifecycle.signal);
    let closed = false;
    const inFlight = new Set<Promise<void>>();
    const whileOpen = <Result>(operation: () => Promise<Result>): Promise<Result> => {
      if (closed) return Promise.reject(new BalanceConsumerSqsReceiptClosedError());
      let settleGate: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        settleGate = resolve;
      });
      inFlight.add(gate);
      let result: Promise<Result>;
      try {
        result = operation();
      } catch (error) {
        result = Promise.reject(error);
      }
      return result
        .catch((error: unknown) => {
          if (typeof error === 'object' && error !== null && TRUSTED_INPUT_ERRORS.has(error)) {
            throw error;
          }
          throw new BalanceConsumerSqsReceiptOperationError();
        })
        .finally(() => {
          inFlight.delete(gate);
          settleGate();
        });
    };
    const parseEnvelope = <Payload = unknown>(body: string): JobEnvelope<Payload> => {
      if (closed) throw new BalanceConsumerSqsReceiptClosedError();
      return transport.parseEnvelope<Payload>(body);
    };
    const receipt = frozenNullPrototype<PinnedSqsQueueReceiptPort>({
      receive: (maxMessages, waitTimeSeconds, abortSignal) =>
        whileOpen(() => transport.receive(maxMessages, waitTimeSeconds, abortSignal)),
      delete: (message, abortSignal) => whileOpen(() => transport.delete(message, abortSignal)),
      changeVisibility: (message, visibilityTimeoutSeconds, abortSignal) =>
        whileOpen(() => transport.changeVisibility(message, visibilityTimeoutSeconds, abortSignal)),
      parseEnvelope,
    });
    const resourceClient = client;
    const resourceLifecycle = lifecycle;
    let closePromise: Promise<void> | undefined;
    const close = (): Promise<void> => {
      closed = true;
      if (closePromise !== undefined) return closePromise;
      const acceptedOperationGates = [...inFlight];
      let startClose: () => void = () => undefined;
      closePromise = new Promise<void>((resolve) => {
        startClose = resolve;
      }).then(async () => {
        await Promise.allSettled(acceptedOperationGates);
        await destroyClient(resourceClient, () => new BalanceConsumerSqsReceiptCloseError());
      });
      try {
        resourceLifecycle.abort(new BalanceConsumerSqsReceiptClosedError());
      } finally {
        startClose();
      }
      return closePromise;
    };

    return frozenNullPrototype<BalanceConsumerSqsReceiptResource>({ receipt, close });
  } catch {
    lifecycle?.abort(new BalanceConsumerSqsReceiptConstructionError());
    if (client !== undefined) {
      await destroyClient(client, () => new BalanceConsumerSqsReceiptConstructionError()).catch(
        () => undefined,
      );
    }
    throw new BalanceConsumerSqsReceiptConstructionError();
  }
}
