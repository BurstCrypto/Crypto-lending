import { Buffer } from 'node:buffer';

import type * as AwsSqs from '@aws-sdk/client-sqs';
import { ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { fromHttp } from '@aws-sdk/credential-provider-http';
import type { Pool } from 'pg';

import type { BalanceConsumerInfrastructureConfig } from '../../infrastructure/config/infrastructure.config';
import { createPostgresPool } from '../../infrastructure/database/runtime-postgres-pool';
import { applicationObservability } from '../../infrastructure/observability';
import {
  createWalletRegistrationKey,
  createWalletRegistrationKeyRing,
} from '../../wallets/infrastructure/crypto/wallet-registration-crypto';
import type { EnabledBalanceConsumerConfig } from '../infrastructure/config/balance-consumer.config';
import {
  createDormantBalanceSyncConsumerLifecycleCoordinator,
  type BalanceSyncConsumerLifecycleEvent,
} from './balance-sync-consumer.lifecycle';
import {
  createDormantBalanceSyncConsumerResource,
  type DormantBalanceSyncConsumerResourceDependencies,
} from './balance-sync-consumer.resource';

jest.mock('../../infrastructure/database/runtime-postgres-pool', () => ({
  createPostgresPool: jest.fn(),
}));
jest.mock('@aws-sdk/client-sqs', () => ({
  ...jest.requireActual<typeof AwsSqs>('@aws-sdk/client-sqs'),
  SQSClient: jest.fn(),
}));
jest.mock('@aws-sdk/credential-provider-http', () => ({ fromHttp: jest.fn() }));

const mockedCreatePostgresPool = jest.mocked(createPostgresPool);
const MockedSqsClient = jest.mocked(SQSClient);
const mockedFromHttp = jest.mocked(fromHttp);
const poolEnd = jest.fn();
const poolQuery = jest.fn();
const poolConnect = jest.fn();
const clientSend = jest.fn();
const clientDestroy = jest.fn();
const pool = {
  end: poolEnd,
  query: poolQuery,
  connect: poolConnect,
} as unknown as Pool;
const client = {
  send: clientSend,
  destroy: clientDestroy,
} as unknown as SQSClient;

const METADATA_KEY_RING = createWalletRegistrationKeyRing('metadata-seal', 1, [
  createWalletRegistrationKey(
    'metadata-seal',
    1,
    Buffer.alloc(32, 11).toString('base64url'),
    'balance-consumer-compatibility-v1',
  ),
]);

function infrastructureConfig(): BalanceConsumerInfrastructureConfig {
  return {
    workload: 'balance-consumer',
    database: {
      connectionString:
        'postgresql://crypto_balance_consumer_login_test:test-placeholder@localhost:5432/crypto_lending',
      connectionTimeoutMs: 2_500,
      idleTimeoutMs: 45_000,
      lockTimeoutMs: 4_000,
      maxLifetimeSeconds: 900,
      poolMax: 4,
      statementTimeoutMs: 8_000,
      ssl: false,
      sessionRole: 'crypto_balance_consumer_runtime',
    },
    sqs: {
      region: 'us-east-1',
      endpoint: 'http://127.0.0.1:4566',
      requestTimeoutMs: 15_000,
      sdkMaxAttempts: 3,
      maxReceiveCount: 3,
      visibilityTimeoutSeconds: 30,
      retryBaseDelaySeconds: 5,
      retryMaxDelaySeconds: 60,
      balanceQueueUrl: 'http://127.0.0.1:4566/000000000000/crypto-lending-test-balance-sync',
      balanceDeadLetterQueueUrl:
        'http://127.0.0.1:4566/000000000000/crypto-lending-test-balance-sync-dlq',
    },
  };
}

function balanceConsumerConfig(): EnabledBalanceConsumerConfig {
  return Object.freeze({ mode: 'enabled', walletMetadataSealKeys: METADATA_KEY_RING });
}

function dependencies(): DormantBalanceSyncConsumerResourceDependencies {
  return {
    infrastructureConfig: infrastructureConfig(),
    balanceConsumerConfig: balanceConsumerConfig(),
    observability: applicationObservability,
    ethereumTransport: { exchange: jest.fn() },
    solanaTransport: { exchange: jest.fn() },
    clock: { now: jest.fn(() => new Date('2026-09-05T12:00:00.000Z')) },
    metrics: { record: jest.fn(), alert: jest.fn() },
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
  }
  throw new Error('Condition did not settle');
}

describe('dormant balance-sync consumer real-capsule compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    poolEnd.mockResolvedValue(undefined);
    clientDestroy.mockReturnValue(undefined);
    clientSend.mockResolvedValue({});
    mockedCreatePostgresPool.mockReturnValue(pool);
    MockedSqsClient.mockImplementation(() => client);
  });

  it('composes the actual child capsules without database, queue, credential, or RPC work', async () => {
    const configured = dependencies();

    const resource = await createDormantBalanceSyncConsumerResource(configured);

    expect(Reflect.ownKeys(resource)).toEqual(['run', 'close']);
    expect(Object.getPrototypeOf(resource)).toBeNull();
    expect(Object.isFrozen(resource)).toBe(true);
    expect(mockedCreatePostgresPool).toHaveBeenCalledTimes(1);
    expect(MockedSqsClient).toHaveBeenCalledTimes(1);
    expect(mockedFromHttp).not.toHaveBeenCalled();
    expect(poolConnect).not.toHaveBeenCalled();
    expect(poolQuery).not.toHaveBeenCalled();
    expect(poolEnd).not.toHaveBeenCalled();
    expect(clientSend).not.toHaveBeenCalled();
    expect(clientDestroy).not.toHaveBeenCalled();
    expect(configured.ethereumTransport.exchange).not.toHaveBeenCalled();
    expect(configured.solanaTransport.exchange).not.toHaveBeenCalled();

    await resource.close();
  });

  it('propagates lifecycle cancellation through the real aggregate and closes in order', async () => {
    const external = new AbortController();
    let requestSignal: AbortSignal | undefined;
    clientSend.mockImplementation(
      (command: unknown, options?: Readonly<{ abortSignal?: AbortSignal }>) => {
        expect(command).toBeInstanceOf(ReceiveMessageCommand);
        requestSignal = options?.abortSignal;
        if (requestSignal === undefined) {
          return Promise.reject(new Error('Expected a locally mocked request signal'));
        }
        return new Promise<never>((_resolve, reject) => {
          const rejectOnAbort = (): void => {
            reject(new Error('Locally mocked SQS receive aborted'));
          };
          if (requestSignal?.aborted) rejectOnAbort();
          else requestSignal?.addEventListener('abort', rejectOnAbort, { once: true });
        });
      },
    );
    const resource = await createDormantBalanceSyncConsumerResource(dependencies());
    const events: BalanceSyncConsumerLifecycleEvent['event'][] = [];
    const coordinator = createDormantBalanceSyncConsumerLifecycleCoordinator({
      resource,
      signal: external.signal,
      operatorEvents: {
        record: (event) => {
          events.push(event.event);
        },
      },
    });

    const running = coordinator.run();
    await waitUntil(() => clientSend.mock.calls.length === 1);
    expect(requestSignal).toBeDefined();
    expect(requestSignal).not.toBe(external.signal);
    external.abort(new Error('caller-private-stop-reason'));

    await expect(running).resolves.toBeUndefined();
    expect(clientSend).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(true);
    expect(poolConnect).not.toHaveBeenCalled();
    expect(poolQuery).not.toHaveBeenCalled();
    expect(events).toEqual(['STARTED', 'STOPPED']);
    expect(clientDestroy).toHaveBeenCalledTimes(1);
    expect(poolEnd).toHaveBeenCalledTimes(1);
    expect(clientDestroy.mock.invocationCallOrder[0]).toBeLessThan(
      poolEnd.mock.invocationCallOrder[0] as number,
    );
    expect(resource.close()).toBe(resource.close());
  });
});
