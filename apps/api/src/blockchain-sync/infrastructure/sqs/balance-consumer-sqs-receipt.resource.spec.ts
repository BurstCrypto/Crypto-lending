import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

import type * as AwsSqs from '@aws-sdk/client-sqs';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { fromHttp } from '@aws-sdk/credential-provider-http';

import type {
  BalanceConsumerInfrastructureConfig,
  RuntimeInfrastructureConfig,
} from '../../../infrastructure/config/infrastructure.config';
import type { ReceivedQueueMessage } from '../../../infrastructure/sqs/sqs.types';
import { createDormantBalanceConsumerSqsReceiptResource } from './balance-consumer-sqs-receipt.resource';

jest.mock('@aws-sdk/client-sqs', () => ({
  ...jest.requireActual<typeof AwsSqs>('@aws-sdk/client-sqs'),
  SQSClient: jest.fn(),
}));
jest.mock('@aws-sdk/credential-provider-http', () => ({ fromHttp: jest.fn() }));

const MockedSqsClient = jest.mocked(SQSClient);
const mockedFromHttp = jest.mocked(fromHttp);
const clientSend = jest.fn();
const clientDestroy = jest.fn();
const credentialProvider = jest.fn(async () => ({
  accessKeyId: 'task-role-access-key',
  secretAccessKey: 'task-role-secret-key',
}));
const client = {
  send: clientSend,
  destroy: clientDestroy,
} as unknown as SQSClient;

const LOCAL_ENDPOINT = 'http://127.0.0.1:4566';
const LOCAL_SOURCE_QUEUE = 'http://127.0.0.1:4566/000000000000/crypto-lending-test-balance-sync';
const AWS_SOURCE_QUEUE =
  'https://sqs.us-east-1.amazonaws.com/123456789012/crypto-lending-staging-blue-balance-sync';
const ATTACKER_QUEUE =
  'https://sqs.us-east-1.amazonaws.com/999999999999/crypto-lending-test-balance-sync';

const MESSAGE: ReceivedQueueMessage = Object.freeze({
  messageId: 'message-1',
  receiptHandle: 'receipt-1',
  body: '{}',
  receiveCount: 1,
  receivedAtMonotonicMs: 1,
});

const VALID_ENVELOPE_BODY = JSON.stringify({
  id: '9de4a78f-9c5c-46fd-a1df-fc8f82de8395',
  kind: 'blockchain.balance-sync',
  version: 1,
  occurredAt: '2026-09-05T00:00:00.000Z',
  correlation: { correlationId: 'f264bfb9-a95a-4600-92a0-e905ccb62426' },
  payload: { accountId: 'account-1' },
});

function localConfig(
  overrides: Partial<BalanceConsumerInfrastructureConfig['sqs']> = {},
): BalanceConsumerInfrastructureConfig {
  return {
    workload: 'balance-consumer',
    database: {
      connectionString: 'postgresql://unused',
      connectionTimeoutMs: 1,
      idleTimeoutMs: 1,
      lockTimeoutMs: 1,
      maxLifetimeSeconds: 1,
      poolMax: 1,
      statementTimeoutMs: 1,
      ssl: false,
    },
    sqs: {
      region: 'us-east-1',
      endpoint: LOCAL_ENDPOINT,
      requestTimeoutMs: 15_000,
      sdkMaxAttempts: 3,
      maxReceiveCount: 3,
      visibilityTimeoutSeconds: 30,
      retryBaseDelaySeconds: 5,
      retryMaxDelaySeconds: 60,
      balanceQueueUrl: LOCAL_SOURCE_QUEUE,
      balanceDeadLetterQueueUrl:
        'http://127.0.0.1:4566/000000000000/crypto-lending-test-balance-sync-dlq',
      ...overrides,
    },
  };
}

function ecsConfig(): BalanceConsumerInfrastructureConfig {
  const config = localConfig({
    balanceQueueUrl: AWS_SOURCE_QUEUE,
    credentialRelativeUri: '/v2/credentials/balance-consumer-task',
  });
  delete config.sqs.endpoint;
  return config;
}

async function capturedRejection(
  action: () => Promise<unknown>,
): Promise<Error & { readonly code?: string }> {
  try {
    await action();
  } catch (error) {
    return error as Error & { readonly code?: string };
  }
  throw new Error('Expected action to reject');
}

function expectFixedError(
  error: Error & { readonly code?: string },
  kind: 'Configuration' | 'Construction' | 'Close' | 'Closed' | 'Input' | 'Operation',
): void {
  const suffixes = {
    Configuration: ['CONFIGURATION_INVALID', 'configuration is invalid'],
    Construction: ['CONSTRUCTION_FAILED', 'construction failed'],
    Close: ['CLOSE_FAILED', 'close failed'],
    Closed: ['CLOSED', 'is closed'],
    Input: ['INPUT_INVALID', 'input is invalid'],
    Operation: ['OPERATION_FAILED', 'operation failed'],
  } as const;
  const [codeSuffix, messageSuffix] = suffixes[kind];
  expect(error).toMatchObject({
    name: `BalanceConsumerSqsReceipt${kind}Error`,
    code: `BALANCE_CONSUMER_SQS_RECEIPT_${codeSuffix}`,
    message: `Balance consumer SQS receipt ${messageSuffix}`,
  });
  expect(error).not.toHaveProperty('cause');
}

describe('createDormantBalanceConsumerSqsReceiptResource', () => {
  beforeEach(() => {
    clientSend.mockReset().mockResolvedValue({});
    clientDestroy.mockReset().mockReturnValue(undefined);
    credentialProvider.mockClear();
    mockedFromHttp.mockReset().mockReturnValue(credentialProvider as ReturnType<typeof fromHttp>);
    MockedSqsClient.mockReset().mockImplementation(() => client);
  });

  it('constructs a dormant local client with fixed credentials and pinned ambient options', async () => {
    const timeoutSpy = jest.spyOn(global, 'setTimeout');

    const resource = await createDormantBalanceConsumerSqsReceiptResource(localConfig());

    expect(MockedSqsClient).toHaveBeenCalledTimes(1);
    expect(MockedSqsClient).toHaveBeenCalledWith({
      region: 'us-east-1',
      maxAttempts: 3,
      defaultsMode: 'standard',
      retryMode: 'standard',
      useFipsEndpoint: false,
      useDualstackEndpoint: false,
      useQueueUrlAsEndpoint: false,
      ignoreConfiguredEndpointUrls: true,
      credentials: {
        accessKeyId: 'local-emulator',
        secretAccessKey: 'local-emulator',
      },
      endpoint: LOCAL_ENDPOINT,
    });
    expect(mockedFromHttp).not.toHaveBeenCalled();
    expect(credentialProvider).not.toHaveBeenCalled();
    expect(clientSend).not.toHaveBeenCalled();
    expect(clientDestroy).not.toHaveBeenCalled();
    expect(timeoutSpy).not.toHaveBeenCalled();

    timeoutSpy.mockRestore();
    await resource.close();
  });

  it('pins production credentials to the reviewed ECS-relative provider only', async () => {
    const resource = await createDormantBalanceConsumerSqsReceiptResource(ecsConfig());

    expect(mockedFromHttp).toHaveBeenCalledWith({
      awsContainerCredentialsRelativeUri: '/v2/credentials/balance-consumer-task',
      awsContainerCredentialsFullUri: '',
      awsContainerAuthorizationToken: '',
      awsContainerAuthorizationTokenFile: '',
      maxRetries: 2,
      timeout: 1_000,
    });
    expect(MockedSqsClient).toHaveBeenCalledWith({
      region: 'us-east-1',
      maxAttempts: 3,
      defaultsMode: 'standard',
      retryMode: 'standard',
      useFipsEndpoint: false,
      useDualstackEndpoint: false,
      useQueueUrlAsEndpoint: false,
      ignoreConfiguredEndpointUrls: true,
      credentials: credentialProvider,
    });
    expect(credentialProvider).not.toHaveBeenCalled();
    expect(clientSend).not.toHaveBeenCalled();
    await resource.close();
  });

  it('exposes only exact frozen null-prototype receipt and close facades', async () => {
    const resource = await createDormantBalanceConsumerSqsReceiptResource(localConfig());

    expect(Reflect.ownKeys(resource)).toEqual(['receipt', 'close']);
    expect(Reflect.ownKeys(resource.receipt)).toEqual([
      'receive',
      'delete',
      'changeVisibility',
      'parseEnvelope',
    ]);
    for (const facade of [resource, resource.receipt]) {
      expect(Object.getPrototypeOf(facade)).toBeNull();
      expect(Object.isFrozen(facade)).toBe(true);
    }
    for (const capability of [
      'client',
      'transport',
      'config',
      'queueUrl',
      'send',
      'sendJob',
      'publish',
      'publishBatch',
      'healthCheck',
      'getQueueAttributes',
      'deadLetterQueueUrl',
    ]) {
      expect(resource).not.toHaveProperty(capability);
      expect(resource.receipt).not.toHaveProperty(capability);
    }

    const envelope = resource.receipt.parseEnvelope.call(null, VALID_ENVELOPE_BODY);
    expect(envelope).toMatchObject({ kind: 'blockchain.balance-sync', version: 1 });
    await resource.close.call(null);
  });

  it('uses only the pinned source for receive, delete, and visibility commands', async () => {
    const config = localConfig();
    let sendObservedAt = 0;
    clientSend.mockImplementation(async (command: unknown) => {
      sendObservedAt = performance.now();
      if (command instanceof ReceiveMessageCommand) {
        return {
          Messages: [
            {
              MessageId: 'message-1',
              ReceiptHandle: 'receipt-1',
              Body: VALID_ENVELOPE_BODY,
              Attributes: { ApproximateReceiveCount: '3' },
            },
          ],
        };
      }
      return {};
    });
    const beforeReceive = performance.now();
    const resource = await createDormantBalanceConsumerSqsReceiptResource(config);
    config.sqs.balanceQueueUrl = ATTACKER_QUEUE;
    config.sqs.visibilityTimeoutSeconds = 9_999;
    const callerSignal = new AbortController().signal;

    const messages = await resource.receipt.receive(2, 7, callerSignal);
    await resource.receipt.delete(messages[0]!, callerSignal);
    await resource.receipt.changeVisibility(messages[0]!, 45, callerSignal);

    const receiveCommand = clientSend.mock.calls[0]?.[0];
    const deleteCommand = clientSend.mock.calls[1]?.[0];
    const visibilityCommand = clientSend.mock.calls[2]?.[0];
    expect(receiveCommand).toBeInstanceOf(ReceiveMessageCommand);
    expect((receiveCommand as ReceiveMessageCommand).input).toEqual({
      QueueUrl: LOCAL_SOURCE_QUEUE,
      MaxNumberOfMessages: 2,
      WaitTimeSeconds: 7,
      VisibilityTimeout: 30,
      MessageSystemAttributeNames: ['ApproximateReceiveCount'],
    });
    expect(deleteCommand).toBeInstanceOf(DeleteMessageCommand);
    expect((deleteCommand as DeleteMessageCommand).input).toEqual({
      QueueUrl: LOCAL_SOURCE_QUEUE,
      ReceiptHandle: 'receipt-1',
    });
    expect(visibilityCommand).toBeInstanceOf(ChangeMessageVisibilityCommand);
    expect((visibilityCommand as ChangeMessageVisibilityCommand).input).toEqual({
      QueueUrl: LOCAL_SOURCE_QUEUE,
      ReceiptHandle: 'receipt-1',
      VisibilityTimeout: 45,
    });
    for (const call of clientSend.mock.calls) {
      const options = call[1] as { abortSignal?: AbortSignal } | undefined;
      expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
      expect(options?.abortSignal).not.toBe(callerSignal);
      expect(options?.abortSignal?.aborted).toBe(true);
      expect(JSON.stringify(call[0])).not.toContain(ATTACKER_QUEUE);
    }
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      messageId: 'message-1',
      receiptHandle: 'receipt-1',
      body: VALID_ENVELOPE_BODY,
      receiveCount: 3,
      receivedAtMonotonicMs: expect.any(Number),
    });
    expect(messages[0]!.receivedAtMonotonicMs).toBeGreaterThanOrEqual(beforeReceive);
    expect(messages[0]!.receivedAtMonotonicMs).toBeLessThanOrEqual(sendObservedAt);
    expect(Object.isFrozen(messages)).toBe(true);
    expect(Object.getPrototypeOf(messages[0])).toBeNull();
    expect(Object.isFrozen(messages[0])).toBe(true);
    await resource.close();
  });

  it('snapshots a hostile receipt handle once before building delete and visibility commands', async () => {
    const resource = await createDormantBalanceConsumerSqsReceiptResource(localConfig());
    const target = { ...MESSAGE };
    let descriptorReads = 0;
    let ordinaryReads = 0;
    const statefulMessage = new Proxy(target, {
      get: () => {
        ordinaryReads += 1;
        throw new Error('sensitive getter detail');
      },
      getOwnPropertyDescriptor: (current, property) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(current, property);
        if (property !== 'receiptHandle' || descriptor === undefined) return descriptor;
        descriptorReads += 1;
        return { ...descriptor, value: descriptorReads === 1 ? 'receipt-first' : 'receipt-later' };
      },
    });

    await resource.receipt.delete(statefulMessage);
    expect((clientSend.mock.calls[0]?.[0] as DeleteMessageCommand).input.ReceiptHandle).toBe(
      'receipt-first',
    );
    expect(descriptorReads).toBe(1);
    expect(ordinaryReads).toBe(0);

    descriptorReads = 0;
    await resource.receipt.changeVisibility(statefulMessage, 0);
    expect(
      (clientSend.mock.calls[1]?.[0] as ChangeMessageVisibilityCommand).input.ReceiptHandle,
    ).toBe('receipt-first');
    expect(descriptorReads).toBe(1);
    expect(ordinaryReads).toBe(0);
    await resource.close();
  });

  it.each([
    ['zero', '0'],
    ['leading zero', '01'],
    ['negative', '-1'],
    ['decimal', '1.0'],
    ['unsafe', '9007199254740992'],
    ['number', 1],
    ['missing', undefined],
  ] as const)(
    'rejects a %s approximate receive count with a fixed input error',
    async (_label, value) => {
      clientSend.mockResolvedValueOnce({
        Messages: [
          {
            MessageId: 'message-1',
            ReceiptHandle: 'receipt-1',
            Body: '{}',
            Attributes: { ApproximateReceiveCount: value },
          },
        ],
      });
      const resource = await createDormantBalanceConsumerSqsReceiptResource(localConfig());

      const error = await capturedRejection(() => resource.receipt.receive());

      expectFixedError(error, 'Input');
      await resource.close();
    },
  );

  it('accepts the largest safe canonical receive count', async () => {
    clientSend.mockResolvedValueOnce({
      Messages: [
        {
          MessageId: 'message-1',
          ReceiptHandle: 'receipt-1',
          Body: '{}',
          Attributes: { ApproximateReceiveCount: '9007199254740991' },
        },
      ],
    });
    const resource = await createDormantBalanceConsumerSqsReceiptResource(localConfig());

    await expect(resource.receipt.receive()).resolves.toMatchObject([
      { receiveCount: Number.MAX_SAFE_INTEGER },
    ]);
    await resource.close();
  });

  it('rejects holey, over-limit, accessor-backed, and malformed receive responses', async () => {
    let accessorInvocations = 0;
    const accessorResponse = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessorResponse, 'Messages', {
      enumerable: true,
      get: () => {
        accessorInvocations += 1;
        return [];
      },
    });
    const messageAccessor = {
      ReceiptHandle: 'receipt-1',
      Body: '{}',
      Attributes: { ApproximateReceiveCount: '1' },
    } as Record<string, unknown>;
    Object.defineProperty(messageAccessor, 'MessageId', {
      enumerable: true,
      get: () => {
        accessorInvocations += 1;
        return 'message-1';
      },
    });
    const countAccessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(countAccessor, 'ApproximateReceiveCount', {
      enumerable: true,
      get: () => {
        accessorInvocations += 1;
        return '1';
      },
    });
    const cases: unknown[] = [
      { Messages: new Array(1) },
      { Messages: [{}, {}] },
      accessorResponse,
      { Messages: [messageAccessor] },
      {
        Messages: [
          {
            MessageId: 'message-1',
            ReceiptHandle: 'receipt-1',
            Body: '{}',
            Attributes: countAccessor,
          },
        ],
      },
      { Messages: null },
      null,
    ];
    const resource = await createDormantBalanceConsumerSqsReceiptResource(localConfig());

    for (const response of cases) {
      clientSend.mockResolvedValueOnce(response);
      const error = await capturedRejection(() => resource.receipt.receive(1));
      expectFixedError(error, 'Input');
    }
    expect(accessorInvocations).toBe(0);
    await resource.close();
  });

  it('returns an exact frozen empty result when SQS omits Messages', async () => {
    clientSend.mockResolvedValueOnce({});
    const resource = await createDormantBalanceConsumerSqsReceiptResource(localConfig());

    const messages = await resource.receipt.receive();

    expect(messages).toEqual([]);
    expect(Object.isFrozen(messages)).toBe(true);
    await resource.close();
  });

  it('rejects all numeric bounds and hostile abort or receipt inputs before sending', async () => {
    const resource = await createDormantBalanceConsumerSqsReceiptResource(localConfig());
    const timeoutSpy = jest.spyOn(global, 'setTimeout');
    const invalidOperations: Array<() => Promise<unknown>> = [
      () => resource.receipt.receive(0),
      () => resource.receipt.receive(11),
      () => resource.receipt.receive(1.5),
      () => resource.receipt.receive(Number.NaN),
      () => resource.receipt.receive(Number.POSITIVE_INFINITY),
      () => resource.receipt.receive(1, -1),
      () => resource.receipt.receive(1, 21),
      () => resource.receipt.receive(1, 0.5),
      () => resource.receipt.changeVisibility(MESSAGE, -1),
      () => resource.receipt.changeVisibility(MESSAGE, 43_201),
      () => resource.receipt.changeVisibility(MESSAGE, 0.5),
      () => resource.receipt.changeVisibility(MESSAGE, Number.NaN),
      () => resource.receipt.delete({} as ReceivedQueueMessage),
      () => resource.receipt.receive(1, 0, {} as AbortSignal),
    ];

    for (const operation of invalidOperations) {
      const error = await capturedRejection(operation);
      expectFixedError(error, 'Input');
    }
    expect(clientSend).not.toHaveBeenCalled();
    expect(timeoutSpy).not.toHaveBeenCalled();
    timeoutSpy.mockRestore();
    await resource.close();
  });

  it('clears an allocated timer and returns a fixed input error when scope setup fails', async () => {
    const timer = {
      unref: (): never => {
        throw new Error('sensitive timer failure');
      },
    } as unknown as NodeJS.Timeout;
    const timeoutSpy = jest.spyOn(global, 'setTimeout').mockReturnValue(timer);
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    const resource = await createDormantBalanceConsumerSqsReceiptResource(localConfig());

    const error = await capturedRejection(() => resource.receipt.receive());

    expectFixedError(error, 'Input');
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
    expect(clientSend).not.toHaveBeenCalled();
    timeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
    await resource.close();
  });

  it('uses fixed input errors for malformed envelope bodies without exposing parser detail', async () => {
    const resource = await createDormantBalanceConsumerSqsReceiptResource(localConfig());

    for (const body of ['{"secret":', '{}', undefined]) {
      let error: (Error & { readonly code?: string }) | undefined;
      try {
        resource.receipt.parseEnvelope(body as string);
      } catch (reason) {
        error = reason as Error & { readonly code?: string };
      }
      if (!error) throw new Error('Expected parsing to fail');
      expectFixedError(error, 'Input');
      expect(String(error)).not.toContain('secret');
    }
    await resource.close();
  });

  it('sanitizes rejected SDK operations, including hostile rejection objects', async () => {
    const hostileFailure = new Proxy(Object.create(null) as object, {
      getPrototypeOf: () => {
        throw new Error('sensitive rejection trap');
      },
    });
    const resource = await createDormantBalanceConsumerSqsReceiptResource(localConfig());

    for (const failure of [new Error(`private ${LOCAL_SOURCE_QUEUE}`), hostileFailure]) {
      clientSend.mockRejectedValueOnce(failure);
      const error = await capturedRejection(() => resource.receipt.receive());
      expectFixedError(error, 'Operation');
      expect(String(error)).not.toContain('private');
      expect(String(error)).not.toContain(LOCAL_SOURCE_QUEUE);
    }
    await resource.close();
  });

  it('never reads or forwards a hostile caller abort reason to the SDK signal', async () => {
    let requestSignal: AbortSignal | undefined;
    let inspectedSdkReason: unknown;
    clientSend.mockImplementation(
      (_command: unknown, options: { abortSignal?: AbortSignal } | undefined) =>
        new Promise<unknown>((_resolve, reject) => {
          requestSignal = options?.abortSignal;
          requestSignal?.addEventListener(
            'abort',
            () => {
              const reason = requestSignal?.reason;
              inspectedSdkReason = reason;
              const detail = reason instanceof Error ? reason.message : String(reason);
              reject(new Error(detail));
            },
            { once: true },
          );
        }),
    );
    let hostileReasonInspections = 0;
    const hostileReason = new Proxy(Object.create(null) as object, {
      get: () => {
        hostileReasonInspections += 1;
        throw new Error('sensitive abort-reason getter');
      },
      getPrototypeOf: () => {
        hostileReasonInspections += 1;
        throw new Error('sensitive abort-reason prototype');
      },
    });
    const caller = new AbortController();
    const resource = await createDormantBalanceConsumerSqsReceiptResource(localConfig());
    const operation = resource.receipt.receive(1, 0, caller.signal);

    expect(() => caller.abort(hostileReason)).not.toThrow();

    expect(requestSignal?.aborted).toBe(true);
    expect(inspectedSdkReason).toMatchObject({ message: 'SQS request aborted' });
    expect(inspectedSdkReason).not.toBe(hostileReason);
    expect(hostileReasonInspections).toBe(0);
    const error = await capturedRejection(() => operation);
    expectFixedError(error, 'Operation');
    await resource.close();
  });

  it.each([
    ['wrong workload', { ...localConfig(), workload: 'worker' }],
    [
      'no credential mode',
      (() => {
        const config = localConfig();
        delete config.sqs.endpoint;
        return config;
      })(),
    ],
    ['both credential modes', localConfig({ credentialRelativeUri: '/v2/credentials/task' })],
    ['remote local endpoint', localConfig({ endpoint: 'http://attacker.invalid:4566' })],
    ['noncanonical local endpoint', localConfig({ endpoint: `${LOCAL_ENDPOINT}/` })],
    [
      'malformed ECS URI',
      (() => {
        const config = ecsConfig();
        config.sqs.credentialRelativeUri = 'http://169.254.170.2/credentials';
        return config;
      })(),
    ],
    [
      'unbranded queue',
      localConfig({ balanceQueueUrl: `${LOCAL_ENDPOINT}/000000000000/balance-sync` }),
    ],
    [
      'jobs queue',
      localConfig({
        balanceQueueUrl: `${LOCAL_ENDPOINT}/000000000000/crypto-lending-test-jobs`,
      }),
    ],
    ['cross-origin queue', localConfig({ balanceQueueUrl: ATTACKER_QUEUE })],
    ['query-bearing queue', localConfig({ balanceQueueUrl: `${LOCAL_SOURCE_QUEUE}?secret=x` })],
    [
      'wrong AWS region',
      (() => {
        const config = ecsConfig();
        config.sqs.balanceQueueUrl = AWS_SOURCE_QUEUE.replace('us-east-1', 'us-west-2');
        return config;
      })(),
    ],
    [
      'cross-partition China suffix',
      (() => {
        const config = ecsConfig();
        config.sqs.balanceQueueUrl = AWS_SOURCE_QUEUE.replace('amazonaws.com', 'amazonaws.com.cn');
        return config;
      })(),
    ],
    [
      'cross-partition isolated suffix',
      (() => {
        const config = ecsConfig();
        config.sqs.balanceQueueUrl = AWS_SOURCE_QUEUE.replace('amazonaws.com', 'c2s.ic.gov');
        return config;
      })(),
    ],
    [
      'China region',
      (() => {
        const config = ecsConfig();
        config.sqs.region = 'cn-north-1';
        config.sqs.balanceQueueUrl = AWS_SOURCE_QUEUE.replace(
          'sqs.us-east-1.amazonaws.com',
          'sqs.cn-north-1.amazonaws.com.cn',
        );
        return config;
      })(),
    ],
    [
      'GovCloud region',
      (() => {
        const config = ecsConfig();
        config.sqs.region = 'us-gov-west-1';
        config.sqs.balanceQueueUrl = AWS_SOURCE_QUEUE.replace('us-east-1', 'us-gov-west-1');
        return config;
      })(),
    ],
    ['redrive count drift', localConfig({ maxReceiveCount: 4 })],
    ['redrive base drift', localConfig({ retryBaseDelaySeconds: 4 })],
    ['redrive maximum drift', localConfig({ retryMaxDelaySeconds: 61 })],
  ] as const)('rejects %s before allocating a client', async (_label, candidate) => {
    const error = await capturedRejection(() =>
      createDormantBalanceConsumerSqsReceiptResource(
        candidate as unknown as RuntimeInfrastructureConfig,
      ),
    );

    expectFixedError(error, 'Configuration');
    expect(MockedSqsClient).not.toHaveBeenCalled();
    expect(mockedFromHttp).not.toHaveBeenCalled();
  });

  it.each([
    ['requestTimeoutMs', 0],
    ['requestTimeoutMs', 60_001],
    ['requestTimeoutMs', 1.5],
    ['requestTimeoutMs', Number.NaN],
    ['requestTimeoutMs', Number.POSITIVE_INFINITY],
    ['sdkMaxAttempts', 0],
    ['sdkMaxAttempts', 11],
    ['sdkMaxAttempts', 1.5],
    ['visibilityTimeoutSeconds', 0],
    ['visibilityTimeoutSeconds', 43_201],
    ['visibilityTimeoutSeconds', 1.5],
  ] as const)('rejects out-of-bounds %s=%p before client allocation', async (name, value) => {
    const error = await capturedRejection(() =>
      createDormantBalanceConsumerSqsReceiptResource(localConfig({ [name]: value })),
    );

    expectFixedError(error, 'Configuration');
    expect(MockedSqsClient).not.toHaveBeenCalled();
  });

  it('reads configuration data descriptors without invoking hostile property access', async () => {
    let ordinaryReads = 0;
    const infrastructure = new Proxy(localConfig(), {
      get: () => {
        ordinaryReads += 1;
        throw new Error('sensitive configuration getter');
      },
    });

    const resource = await createDormantBalanceConsumerSqsReceiptResource(infrastructure);

    expect(ordinaryReads).toBe(0);
    expect(MockedSqsClient).toHaveBeenCalledTimes(1);
    await resource.close();
  });

  it('rejects workload and SQS accessors without invoking them before allocation', async () => {
    let accessorInvocations = 0;
    const workloadAccessor = localConfig();
    Object.defineProperty(workloadAccessor, 'workload', {
      enumerable: true,
      get: () => {
        accessorInvocations += 1;
        return 'balance-consumer';
      },
    });
    const regionAccessor = localConfig();
    Object.defineProperty(regionAccessor.sqs, 'region', {
      enumerable: true,
      get: () => {
        accessorInvocations += 1;
        return 'us-east-1';
      },
    });

    for (const candidate of [workloadAccessor, regionAccessor]) {
      const error = await capturedRejection(() =>
        createDormantBalanceConsumerSqsReceiptResource(candidate),
      );
      expectFixedError(error, 'Configuration');
    }
    expect(accessorInvocations).toBe(0);
    expect(MockedSqsClient).not.toHaveBeenCalled();
  });

  it('never reads or retains the balance dead-letter queue configuration', async () => {
    const config = localConfig();
    let deadLetterAccessorInvocations = 0;
    const inspectedDescriptors: PropertyKey[] = [];
    Object.defineProperty(config.sqs, 'balanceDeadLetterQueueUrl', {
      enumerable: true,
      get: () => {
        deadLetterAccessorInvocations += 1;
        throw new Error('private dead-letter coordinate');
      },
    });
    const sqs = new Proxy(config.sqs, {
      getOwnPropertyDescriptor: (target, property) => {
        inspectedDescriptors.push(property);
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    config.sqs = sqs;

    const resource = await createDormantBalanceConsumerSqsReceiptResource(config);
    await resource.receipt.receive();

    expect(deadLetterAccessorInvocations).toBe(0);
    expect(inspectedDescriptors).not.toContain('balanceDeadLetterQueueUrl');
    expect(JSON.stringify(MockedSqsClient.mock.calls)).not.toContain('balance-sync-dlq');
    expect(JSON.stringify(clientSend.mock.calls)).not.toContain('balance-sync-dlq');
    await resource.close();
  });

  it('snapshots stateful configuration descriptors once and ignores later mutation', async () => {
    const config = localConfig();
    const sqsTarget = config.sqs;
    let queueDescriptorReads = 0;
    config.sqs = new Proxy(sqsTarget, {
      getOwnPropertyDescriptor: (target, property) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (property !== 'balanceQueueUrl' || descriptor === undefined) return descriptor;
        queueDescriptorReads += 1;
        return {
          ...descriptor,
          value: queueDescriptorReads === 1 ? LOCAL_SOURCE_QUEUE : ATTACKER_QUEUE,
        };
      },
    });

    const construction = createDormantBalanceConsumerSqsReceiptResource(config);
    sqsTarget.balanceQueueUrl = ATTACKER_QUEUE;
    sqsTarget.visibilityTimeoutSeconds = 9_999;
    config.workload = 'worker' as never;
    const resource = await construction;
    await resource.receipt.receive();

    const command = clientSend.mock.calls[0]?.[0] as ReceiveMessageCommand;
    expect(queueDescriptorReads).toBe(1);
    expect(command.input.QueueUrl).toBe(LOCAL_SOURCE_QUEUE);
    expect(command.input.VisibilityTimeout).toBe(30);
    await resource.close();
  });

  it('closes a partially built client once and sanitizes construction and cleanup failures', async () => {
    const partialClient = {
      get send(): never {
        throw new Error('sensitive client surface detail');
      },
      destroy: clientDestroy,
    } as unknown as SQSClient;
    clientDestroy.mockRejectedValueOnce(new Error('sensitive cleanup detail'));
    MockedSqsClient.mockImplementationOnce(() => partialClient);

    const error = await capturedRejection(() =>
      createDormantBalanceConsumerSqsReceiptResource(localConfig()),
    );

    expectFixedError(error, 'Construction');
    expect(String(error)).not.toContain('sensitive');
    expect(clientDestroy).toHaveBeenCalledTimes(1);
  });

  it('marks every receipt operation closed synchronously and memoizes deferred destruction', async () => {
    const resource = await createDormantBalanceConsumerSqsReceiptResource(localConfig());

    const first = resource.close();
    const repeated = resource.close();
    const operations = [
      resource.receipt.receive(),
      resource.receipt.delete(MESSAGE),
      resource.receipt.changeVisibility(MESSAGE, 0),
    ];
    let parseError: (Error & { readonly code?: string }) | undefined;
    try {
      resource.receipt.parseEnvelope(VALID_ENVELOPE_BODY);
    } catch (error) {
      parseError = error as Error & { readonly code?: string };
    }

    expect(repeated).toBe(first);
    expect(clientDestroy).not.toHaveBeenCalled();
    expect(clientSend).not.toHaveBeenCalled();
    if (!parseError) throw new Error('Expected parse to be gated after close');
    expectFixedError(parseError, 'Closed');
    for (const operation of operations) {
      const error = await capturedRejection(() => operation);
      expectFixedError(error, 'Closed');
    }
    await first;
    expect(resource.close()).toBe(first);
    expect(clientDestroy).toHaveBeenCalledTimes(1);
  });

  it('aborts and drains an accepted operation before destroying the client', async () => {
    let requestSignal: AbortSignal | undefined;
    clientSend.mockImplementation(
      (_command: unknown, options: { abortSignal?: AbortSignal } | undefined) =>
        new Promise<unknown>((_resolve, reject) => {
          requestSignal = options?.abortSignal;
          requestSignal?.addEventListener(
            'abort',
            () => reject(new Error(`private pending request for ${LOCAL_SOURCE_QUEUE}`)),
            { once: true },
          );
        }),
    );
    const resource = await createDormantBalanceConsumerSqsReceiptResource(localConfig());

    const operation = resource.receipt.receive();
    const closing = resource.close();

    expect(requestSignal?.aborted).toBe(true);
    expect(clientDestroy).not.toHaveBeenCalled();
    const operationError = await capturedRejection(() => operation);
    expectFixedError(operationError, 'Operation');
    await closing;
    expect(clientDestroy).toHaveBeenCalledTimes(1);
  });

  it('memoizes close before a send implementation can re-enter it', async () => {
    const resource = await createDormantBalanceConsumerSqsReceiptResource(localConfig());
    let reentrantClose: Promise<void> | undefined;
    clientSend.mockImplementationOnce(() => {
      reentrantClose = resource.close();
      return Promise.reject(new Error('private request failure'));
    });

    const operation = resource.receipt.receive();
    const closing = resource.close();

    expect(reentrantClose).toBeDefined();
    expect(closing).toBe(reentrantClose);
    const operationError = await capturedRejection(() => operation);
    expectFixedError(operationError, 'Operation');
    await closing;
    expect(clientDestroy).toHaveBeenCalledTimes(1);
  });

  it.each(['throws', 'rejects'] as const)(
    'memoizes and sanitizes a destroy that %s, including destroy-time reentrancy',
    async (failureMode) => {
      const resource = await createDormantBalanceConsumerSqsReceiptResource(localConfig());
      let reentrantClose: Promise<void> | undefined;
      if (failureMode === 'throws') {
        clientDestroy.mockImplementationOnce(() => {
          reentrantClose = resource.close();
          throw new Error('private destroy detail');
        });
      } else {
        clientDestroy.mockImplementationOnce(() => {
          reentrantClose = resource.close();
          return Promise.reject(new Error('private destroy detail'));
        });
      }

      const first = resource.close();
      const repeated = resource.close();
      const error = await capturedRejection(() => first);

      expect(repeated).toBe(first);
      expect(reentrantClose).toBe(first);
      expectFixedError(error, 'Close');
      expect(String(error)).not.toContain('private');
      expect(clientDestroy).toHaveBeenCalledTimes(1);
      expect(resource.close()).toBe(first);
    },
  );

  it('stays unexported, dormant, decorator-free, and free of broader SQS commands', () => {
    const source = readFileSync(
      resolve(__dirname, 'balance-consumer-sqs-receipt.resource.ts'),
      'utf8',
    );
    const blockchainSyncIndex = readFileSync(resolve(__dirname, '../../index.ts'), 'utf8');
    const launchSources = [
      '../../application/balance-sync-consumer.runtime.ts',
      '../../application/balance-sync-consumer.cli.ts',
      '../../application/balance-sync-consumer.composition.ts',
      '../../blockchain-sync.module.ts',
      '../../index.ts',
      '../../../app.module.ts',
      '../../../main.ts',
      '../../../local-development-app.module.ts',
      '../../../infrastructure/sqs/sqs.module.ts',
      '../../../infrastructure/outbox/outbox-worker.cli.ts',
      '../../../infrastructure/outbox/outbox-worker-health.cli.ts',
      '../../../infrastructure/redis/redis-session-revocation.cli.ts',
      '../../../infrastructure/database/migration.cli.ts',
    ].map((relativePath) => readFileSync(resolve(__dirname, relativePath), 'utf8'));

    expect(source).not.toMatch(
      /@nestjs|SqsService|SqsModule|SendMessage|GetQueueAttributes|process\.env|healthCheck/u,
    );
    expect(source).not.toContain('balanceDeadLetterQueueUrl');
    expect(source).not.toMatch(/\.reason\b/u);
    expect(source).not.toMatch(
      /export\s+(?:class|function)\s+(?:createRawSqsClient|BalanceConsumerSqsReceiptTransport)/u,
    );
    expect(blockchainSyncIndex).not.toContain('balance-consumer-sqs-receipt.resource');
    for (const launchSource of launchSources) {
      expect(launchSource).not.toContain('createDormantBalanceConsumerSqsReceiptResource');
      expect(launchSource).not.toContain('balance-consumer-sqs-receipt.resource');
    }
  });
});
