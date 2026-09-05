import {
  createRedisSessionRevocationClient,
  REDIS_SESSION_REVOCATION_NETWORK_SCOPE,
  REDIS_SESSION_REVOCATION_WORKLOAD,
  type RedisSessionRevocationClient,
  type RedisSessionRevocationClientFactory,
  runRedisSessionRevocation,
} from './redis-session-revocation';

function environment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): NodeJS.ProcessEnv {
  const value: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    APP_ENV: 'staging-blue',
    APPLICATION_WORKLOAD: REDIS_SESSION_REVOCATION_WORKLOAD,
    PRODUCT_NETWORK_SCOPE: REDIS_SESSION_REVOCATION_NETWORK_SCOPE,
    REDIS_CREDENTIAL_PHASE: 'B_ONLY',
    REDIS_HOST: 'cache.internal.example',
    REDIS_PORT: '6379',
    REDIS_TLS: 'true',
    REDIS_OPERATOR_USERNAME: 'crypto_operator_staging-blue',
    REDIS_OPERATOR_PASSWORD: 'operator-password-not-logged',
  };
  for (const [name, configured] of Object.entries(overrides)) {
    if (configured === undefined) delete value[name];
    else value[name] = configured;
  }
  return value;
}

function fakeClient(response: unknown): {
  readonly client: RedisSessionRevocationClient;
  readonly connect: jest.Mock;
  readonly call: jest.Mock;
  readonly disconnect: jest.Mock;
} {
  const connect = jest.fn(async () => undefined);
  const call = jest.fn(async () => response);
  const disconnect = jest.fn(() => undefined);
  return {
    client: { connect, call, disconnect } as RedisSessionRevocationClient,
    connect,
    call,
    disconnect,
  };
}

describe('Redis session revocation', () => {
  it.each([
    ['B_ONLY', 'a', 'crypto_api_staging-blue_a'],
    ['A_ONLY', 'b', 'crypto_api_staging-blue_b'],
  ])(
    'derives the inactive %s slot and issues only the exact CLIENT KILL operation',
    async (phase, inactiveSlot, targetUsername) => {
      const fake = fakeClient(3);
      const factory = jest.fn<
        ReturnType<RedisSessionRevocationClientFactory>,
        Parameters<RedisSessionRevocationClientFactory>
      >(() => fake.client);

      const result = await runRedisSessionRevocation(
        [],
        environment({ REDIS_CREDENTIAL_PHASE: phase }),
        factory,
      );

      expect(result).toEqual({
        exitCode: 0,
        inactiveSlot,
        killedClientCount: 3,
        status: 'completed',
      });
      expect(fake.connect).toHaveBeenCalledTimes(1);
      expect(fake.call).toHaveBeenCalledTimes(1);
      expect(fake.call).toHaveBeenCalledWith(
        'CLIENT',
        'KILL',
        'USER',
        targetUsername,
        'SKIPME',
        'YES',
      );
      expect(fake.disconnect).toHaveBeenCalledWith(false);
      expect(factory).toHaveBeenCalledTimes(1);
      expect(factory.mock.calls[0]?.[0]).toMatchObject({
        inactiveSlot,
        operatorUsername: 'crypto_operator_staging-blue',
        targetUsername,
      });
    },
  );

  it.each([
    ['NODE_ENV', 'development'],
    ['NODE_ENV', undefined],
    ['APP_ENV', 'production'],
    ['APP_ENV', 'staging Blue'],
    ['APPLICATION_WORKLOAD', 'api'],
    ['PRODUCT_NETWORK_SCOPE', 'ethereum-solana-base-mainnet'],
    ['PRODUCT_NETWORK_SCOPE', 'ethereum-mainnet'],
    ['REDIS_CREDENTIAL_PHASE', 'BOTH_USE_A'],
    ['REDIS_CREDENTIAL_PHASE', 'BOTH_USE_B'],
    ['REDIS_CREDENTIAL_PHASE', 'C_ONLY'],
    ['REDIS_HOST', 'CACHE.internal.example'],
    ['REDIS_HOST', '127.0.0.1'],
    ['REDIS_HOST', 'cache.internal.example.'],
    ['REDIS_PORT', '6380'],
    ['REDIS_TLS', 'false'],
    ['REDIS_OPERATOR_USERNAME', 'crypto_api_staging-blue_b'],
    ['REDIS_OPERATOR_USERNAME', 'crypto_operator_staging'],
    ['REDIS_OPERATOR_PASSWORD', ''],
    ['REDIS_OPERATOR_PASSWORD', 'bad\npassword'],
  ])('fails closed before client creation for invalid %s', async (name, value) => {
    const factory = jest.fn(() => fakeClient(0).client);
    await expect(
      runRedisSessionRevocation([], environment({ [name]: value }), factory),
    ).resolves.toEqual({
      code: 'CONFIGURATION_INVALID',
      exitCode: 1,
      status: 'refused',
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it.each(['REDIS_URL', 'REDIS_USERNAME', 'REDIS_PASSWORD', 'REDIS_COMMAND'])(
    'rejects unreviewed Redis input %s before client creation',
    async (name) => {
      const factory = jest.fn(() => fakeClient(0).client);
      const result = await runRedisSessionRevocation(
        [],
        environment({ [name]: 'attacker-controlled' }),
        factory,
      );
      expect(result).toMatchObject({ code: 'CONFIGURATION_INVALID', exitCode: 1 });
      expect(factory).not.toHaveBeenCalled();
    },
  );

  it('rejects process-wide TLS verification weakening', async () => {
    const factory = jest.fn(() => fakeClient(0).client);
    const result = await runRedisSessionRevocation(
      [],
      environment({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }),
      factory,
    );
    expect(result).toMatchObject({ code: 'CONFIGURATION_INVALID', exitCode: 1 });
    expect(factory).not.toHaveBeenCalled();
  });

  it('rejects arguments instead of accepting a command or target override', async () => {
    const factory = jest.fn(() => fakeClient(0).client);
    await expect(
      runRedisSessionRevocation(['CLIENT', 'KILL', 'USER', 'someone-else'], environment(), factory),
    ).resolves.toEqual({ code: 'ARGUMENTS_INVALID', exitCode: 1, status: 'refused' });
    expect(factory).not.toHaveBeenCalled();
  });

  it('rejects accessor-bearing and symbol-bearing environment objects', async () => {
    const accessorEnvironment = environment();
    Object.defineProperty(accessorEnvironment, 'REDIS_HOST', {
      configurable: true,
      enumerable: true,
      get: () => 'cache.internal.example',
    });
    const symbolEnvironment = environment() as NodeJS.ProcessEnv & { [key: symbol]: string };
    symbolEnvironment[Symbol('hidden')] = 'value';
    const factory = jest.fn(() => fakeClient(0).client);

    await expect(
      runRedisSessionRevocation([], accessorEnvironment, factory),
    ).resolves.toMatchObject({
      code: 'CONFIGURATION_INVALID',
    });
    await expect(runRedisSessionRevocation([], symbolEnvironment, factory)).resolves.toMatchObject({
      code: 'CONFIGURATION_INVALID',
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '1', -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects malformed killed-client reply %p and closes the client',
    async (response) => {
      const fake = fakeClient(response);
      const result = await runRedisSessionRevocation([], environment(), () => fake.client);
      expect(result).toEqual({ code: 'RESULT_INVALID', exitCode: 1, status: 'refused' });
      expect(fake.disconnect).toHaveBeenCalledWith(false);
    },
  );

  it.each(['connect', 'call'] as const)(
    'sanitizes a sensitive %s failure and closes the client',
    async (operation) => {
      const fake = fakeClient(0);
      const sensitiveDetails = [
        'rediss:/',
        '/crypto_operator_staging-blue:',
        'operator-password-not-logged',
        '@cache.internal.example',
      ].join('');
      fake[operation].mockRejectedValueOnce(new Error(sensitiveDetails));
      const result = await runRedisSessionRevocation([], environment(), () => fake.client);
      expect(result).toEqual({ code: 'OPERATION_FAILED', exitCode: 1, status: 'refused' });
      expect(JSON.stringify(result)).not.toMatch(/password|cache\.internal|crypto_operator/u);
      expect(fake.disconnect).toHaveBeenCalledWith(false);
    },
  );

  it('sanitizes client construction failure without attempting a connection', async () => {
    const result = await runRedisSessionRevocation([], environment(), () => {
      throw new Error('operator-password-not-logged');
    });
    expect(result).toEqual({ code: 'OPERATION_FAILED', exitCode: 1, status: 'refused' });
    expect(JSON.stringify(result)).not.toContain('operator-password-not-logged');
  });

  it('does not replace a successful command result with socket teardown details', async () => {
    const fake = fakeClient(2);
    fake.disconnect.mockImplementationOnce(() => {
      throw new Error('operator-password-not-logged');
    });
    await expect(runRedisSessionRevocation([], environment(), () => fake.client)).resolves.toEqual({
      exitCode: 0,
      inactiveSlot: 'a',
      killedClientCount: 2,
      status: 'completed',
    });
  });

  it('constructs a lazy, retry-free, database-zero client with certificate verification', () => {
    const client = createRedisSessionRevocationClient({
      host: 'cache.internal.example',
      inactiveSlot: 'a',
      operatorPassword: 'not-exported',
      operatorUsername: 'crypto_operator_staging-blue',
      targetUsername: 'crypto_api_staging-blue_a',
    }) as unknown as {
      options: Record<string, unknown>;
      disconnect(reconnect?: boolean): void;
    };
    try {
      expect(client.options).toMatchObject({
        host: 'cache.internal.example',
        port: 6379,
        username: 'crypto_operator_staging-blue',
        password: 'not-exported',
        db: 0,
        lazyConnect: true,
        enableReadyCheck: false,
        enableOfflineQueue: false,
        disableClientInfo: true,
        autoResendUnfulfilledCommands: false,
        autoResubscribe: false,
        connectTimeout: 5000,
        commandTimeout: 5000,
        maxRetriesPerRequest: 0,
        retryStrategy: null,
        tls: { rejectUnauthorized: true },
      });
    } finally {
      client.disconnect(false);
    }
  });
});
