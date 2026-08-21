import { createHash, randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';

import type { InfrastructureConfig } from '../../src/infrastructure/config/infrastructure.config';
import { createRedisClient } from '../../src/infrastructure/redis/redis.module';
import { RedisService } from '../../src/infrastructure/redis/redis.service';

const runLiveIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithInfrastructure = runLiveIntegration ? describe : describe.skip;

const LOCAL_OPERATOR_USERNAME = 'local_acl_operator';
const LOCAL_OPERATOR_PASSWORD = 'local-acl-operator';

function requireLoopback(hostname: string): void {
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase())) {
    throw new Error('KAN-233 ACL mutations require a loopback Redis endpoint');
  }
}

function credentialDigest(password: string): string {
  return `#${createHash('sha256').update(password).digest('hex')}`;
}

function client(host: string, port: number, username?: string, password?: string): Redis {
  const connection = new Redis({
    host,
    port,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    lazyConnect: true,
    enableReadyCheck: false,
    disableClientInfo: true,
    db: 0,
    connectTimeout: 2_000,
    commandTimeout: 2_000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  connection.on('error', () => undefined);
  return connection;
}

function apiAclRules(enabled: boolean, password: string): string[] {
  return [
    'reset',
    enabled ? 'on' : 'off',
    'sanitize-payload',
    credentialDigest(password),
    'resetkeys',
    'resetchannels',
    '-@all',
    '+ping',
    '+quit',
  ];
}

function apiInfrastructureConfig(
  host: string,
  port: number,
  username: string,
  password: string,
): InfrastructureConfig {
  const authorityHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return {
    workload: 'api',
    database: {
      connectionString: 'postgresql://unused',
      connectionTimeoutMs: 100,
      idleTimeoutMs: 1_000,
      lockTimeoutMs: 100,
      maxLifetimeSeconds: 60,
      poolMax: 1,
      statementTimeoutMs: 1_000,
      ssl: false,
    },
    redis: {
      url: `redis://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${authorityHost}:${port}/`,
      username,
      connectTimeoutMs: 2_000,
      commandTimeoutMs: 2_000,
    },
    sqs: {
      region: 'us-east-1',
      queueUrl: 'http://127.0.0.1:4566/000000000000/unused',
      deadLetterQueueUrl: 'http://127.0.0.1:4566/000000000000/unused-dlq',
      requestTimeoutMs: 1_000,
      sdkMaxAttempts: 1,
      maxReceiveCount: 3,
      visibilityTimeoutSeconds: 30,
      retryBaseDelaySeconds: 1,
      retryMaxDelaySeconds: 60,
    },
  };
}

async function expectDenied(action: () => Promise<unknown>): Promise<void> {
  await expect(action()).rejects.toThrow(/NOPERM/iu);
}

describeWithInfrastructure('Redis health-only ACL least privilege and rotation', () => {
  jest.setTimeout(30_000);

  it('allows only application lifecycle commands and revokes one slot without disrupting the next', async () => {
    const host = process.env.REDIS_HOST ?? '127.0.0.1';
    const port = Number(process.env.REDIS_PORT ?? '6379');
    requireLoopback(host);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
      throw new Error('REDIS_PORT must be an integer between 1 and 65535');
    }

    const nonce = randomUUID().replaceAll('-', '').slice(0, 16);
    const usernameA = `kan233_a_${nonce}`;
    const usernameB = `kan233_b_${nonce}`;
    const passwordA = `kan233-a-${nonce}`;
    const passwordB = `kan233-b-${nonce}`;
    const wrongPassword = `kan233-wrong-${nonce}`;
    const ownLookingKey = `crypto-lending:local:api:v1:kan233:${nonce}:owned`;
    const crossServiceKey = `crypto-lending:local:worker:v1:kan233:${nonce}:owned`;
    const unprefixedKey = `kan233:${nonce}:unprefixed`;

    const operator = client(
      host,
      port,
      LOCAL_OPERATOR_USERNAME,
      process.env.TEST_REDIS_OPERATOR_PASSWORD ?? LOCAL_OPERATOR_PASSWORD,
    );
    const clients: Redis[] = [];
    const createdUsers: string[] = [];
    let applicationClient: Redis | undefined;

    try {
      await operator.ping();
      await operator.call('ACL', 'SETUSER', usernameA, ...apiAclRules(true, passwordA));
      createdUsers.push(usernameA);
      await operator.call('ACL', 'SETUSER', usernameB, ...apiAclRules(false, passwordB));
      createdUsers.push(usernameB);

      const disabledStandby = client(host, port, usernameB, passwordB);
      clients.push(disabledStandby);
      await expect(disabledStandby.ping()).rejects.toThrow(/WRONGPASS|invalid username-password/iu);

      applicationClient = createRedisClient(
        apiInfrastructureConfig(host, port, usernameA, passwordA),
      );
      const applicationRedis = new RedisService(applicationClient);
      await expect(applicationRedis.healthCheck()).resolves.toBeUndefined();
      await expect(applicationRedis.onApplicationShutdown()).resolves.toBeUndefined();

      const cleanLifecycleLog = JSON.stringify(await operator.call('ACL', 'LOG', '100'));
      expect(cleanLifecycleLog).not.toContain(usernameA);
      expect(cleanLifecycleLog).not.toContain(passwordA);

      const apiA = client(host, port, usernameA, passwordA);
      clients.push(apiA);
      await expect(apiA.ping()).resolves.toBe('PONG');

      for (const [command, args] of [
        ['GET', [ownLookingKey]],
        ['GET', [crossServiceKey]],
        ['GET', [unprefixedKey]],
        ['SET', [ownLookingKey, 'value']],
        ['DEL', [ownLookingKey]],
        ['DEL', [ownLookingKey, crossServiceKey]],
        ['MGET', [ownLookingKey, crossServiceKey]],
        ['MSET', [ownLookingKey, 'value', crossServiceKey, 'value']],
        ['EXISTS', [ownLookingKey]],
        ['EXPIRE', [ownLookingKey, '60']],
        ['TTL', [ownLookingKey]],
        ['INCR', [ownLookingKey]],
        ['UNLINK', [ownLookingKey]],
        ['INFO', []],
        ['COMMAND', ['INFO', 'GET']],
        ['KEYS', ['*']],
        ['SCAN', ['0']],
        ['ACL', ['WHOAMI']],
        ['CONFIG', ['GET', '*']],
        ['CLIENT', ['LIST']],
        ['PUBLISH', ['channel', 'message']],
        ['SUBSCRIBE', ['channel']],
        ['PSUBSCRIBE', ['channel:*']],
        ['SSUBSCRIBE', ['channel']],
        ['SPUBLISH', ['channel', 'message']],
        ['EVAL', ['return 1', '0']],
        ['EVAL_RO', ['return 1', '0']],
        ['EVALSHA', ['0000000000000000000000000000000000000000', '0']],
        ['EVALSHA_RO', ['0000000000000000000000000000000000000000', '0']],
        ['SCRIPT', ['EXISTS', '0000000000000000000000000000000000000000']],
        ['FUNCTION', ['LIST']],
        ['FCALL', ['missing_function', '0']],
        ['FCALL_RO', ['missing_function', '0']],
        ['MODULE', ['LIST']],
        ['MULTI', []],
        ['EXEC', []],
        ['DISCARD', []],
        ['WATCH', [ownLookingKey]],
        ['UNWATCH', []],
        ['FLUSHDB', []],
        ['FLUSHALL', []],
        ['SELECT', ['1']],
        ['MIGRATE', ['127.0.0.1', '1', ownLookingKey, '0', '1']],
        ['RESTORE', [ownLookingKey, '0', 'not-a-dump']],
      ] as const) {
        await expectDenied(() => apiA.call(command, ...args));
      }

      const anonymous = client(host, port);
      const wrongCredential = client(host, port, usernameA, wrongPassword);
      clients.push(anonymous, wrongCredential);
      await expect(anonymous.ping()).rejects.toThrow(/NOAUTH/iu);
      await expect(wrongCredential.ping()).rejects.toThrow(/WRONGPASS|invalid username-password/iu);

      await operator.call('ACL', 'SETUSER', usernameB, ...apiAclRules(true, passwordB));
      const candidateB = client(host, port, usernameB, passwordB);
      clients.push(candidateB);
      await expect(candidateB.ping()).resolves.toBe('PONG');

      // Roll back the candidate before forward cutover. Exact-user revocation
      // must terminate B while the current A slot remains healthy.
      await operator.call('ACL', 'SETUSER', usernameB, 'off');
      await operator.call('CLIENT', 'KILL', 'USER', usernameB, 'SKIPME', 'YES');
      await expect(candidateB.ping()).rejects.toThrow();
      const rolledBackB = client(host, port, usernameB, passwordB);
      clients.push(rolledBackB);
      await expect(rolledBackB.ping()).rejects.toThrow(/WRONGPASS|invalid username-password/iu);
      await expect(apiA.ping()).resolves.toBe('PONG');

      // Re-establish overlap and complete the forward cutover.
      await operator.call('ACL', 'SETUSER', usernameB, ...apiAclRules(true, passwordB));
      const apiB = client(host, port, usernameB, passwordB);
      clients.push(apiB);
      await expect(apiB.ping()).resolves.toBe('PONG');

      await operator.call('ACL', 'SETUSER', usernameA, 'off');
      await operator.call('CLIENT', 'KILL', 'USER', usernameA, 'SKIPME', 'YES');
      await expect(apiA.ping()).rejects.toThrow();
      const revokedA = client(host, port, usernameA, passwordA);
      clients.push(revokedA);
      await expect(revokedA.ping()).rejects.toThrow(/WRONGPASS|invalid username-password/iu);
      await expect(apiB.ping()).resolves.toBe('PONG');

      const evidence = JSON.stringify(await operator.call('ACL', 'LOG', '100'));
      expect(evidence).toContain(usernameA);
      expect(evidence).not.toContain(passwordA);
      expect(evidence).not.toContain(passwordB);
      expect(evidence).not.toContain(wrongPassword);
    } finally {
      applicationClient?.disconnect(false);
      for (const connection of clients) connection.disconnect(false);
      for (const username of createdUsers) {
        await operator.call('ACL', 'SETUSER', username, 'off').catch(() => undefined);
        await operator
          .call('CLIENT', 'KILL', 'USER', username, 'SKIPME', 'YES')
          .catch(() => undefined);
      }
      if (createdUsers.length > 0) {
        await operator.call('ACL', 'DELUSER', ...createdUsers).catch(() => undefined);
      }
      if (operator.status !== 'end') {
        await operator.quit().catch(() => operator.disconnect(false));
      }
      operator.disconnect(false);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  });
});
