import { Buffer } from 'node:buffer';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';

import { BALANCE_CONSUMER_SOURCE_ACTIVATION } from './balance-sync-consumer.activation';
import {
  BALANCE_CONSUMER_NETWORK_SCOPE,
  BALANCE_CONSUMER_SOURCE_APPROVAL,
  evaluateBalanceSyncConsumerCliMode,
  runBalanceSyncConsumerCli,
} from './balance-sync-consumer.cli-mode';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'balance-consumer-cli-'));
const validCaPath = join(temporaryDirectory, 'rds-ca.pem');
const validCa = rootCertificates[0];
if (!validCa) throw new Error('Node did not expose a root certificate for the CLI test');
writeFileSync(validCaPath, validCa, 'utf8');

afterAll(() => {
  rmSync(temporaryDirectory, { force: true, recursive: true });
});

function metadataKeyRing(): string {
  return JSON.stringify({
    activeWriteVersion: 1,
    keys: [
      {
        keyId: 'balance-consumer-metadata-v1',
        purpose: 'metadata-seal',
        version: 1,
        material: Buffer.alloc(32, 7).toString('base64url'),
      },
    ],
  });
}

function enabledEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    APP_ENV: 'test',
    APPLICATION_WORKLOAD: 'balance-consumer',
    BALANCE_CONSUMER_MODE: 'enabled',
    BALANCE_CONSUMER_NETWORK: BALANCE_CONSUMER_NETWORK_SCOPE,
    BALANCE_CONSUMER_SOURCE_APPROVAL: BALANCE_CONSUMER_SOURCE_APPROVAL,
    BALANCE_CONSUMER_WALLET_METADATA_KEY_RING_JSON: metadataKeyRing(),
    DATABASE_RUNTIME_URL:
      'postgresql://crypto_balance_consumer_login_a:not-exported@127.0.0.1:5432/crypto_lending',
    DATABASE_RUNTIME_SSL_MODE: 'verify-full',
    NODE_EXTRA_CA_CERTS: validCaPath,
    AWS_REGION: 'us-east-1',
    AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/balance-consumer',
    SQS_BALANCE_QUEUE_URL:
      'https://sqs.us-east-1.amazonaws.com/000000000000/crypto-lending-test-balance-sync',
    SQS_BALANCE_DEAD_LETTER_QUEUE_URL:
      'https://sqs.us-east-1.amazonaws.com/000000000000/crypto-lending-test-balance-sync-dlq',
    ...overrides,
  };
}

describe('balance sync consumer CLI mode', () => {
  it('keeps the immutable checked-in activation gate disabled', () => {
    expect(BALANCE_CONSUMER_SOURCE_ACTIVATION).toEqual({ enabled: false });
    expect(Object.isFrozen(BALANCE_CONSUMER_SOURCE_ACTIVATION)).toBe(true);
  });

  it('refuses a fully canonical invocation solely at the source gate', () => {
    expect(evaluateBalanceSyncConsumerCliMode([], enabledEnvironment())).toEqual({
      status: 'refused',
      exitCode: 1,
      blockers: ['SOURCE_ACTIVATION_DISABLED'],
    });
  });

  it('never loads or constructs the runtime while source activation is disabled', async () => {
    const runtimeLoader = jest.fn(async () => ({
      startBalanceSyncConsumerRuntime: jest.fn(async () => undefined),
    }));

    const result = await runBalanceSyncConsumerCli([], enabledEnvironment(), runtimeLoader);

    expect(result.blockers).toEqual(['SOURCE_ACTIVATION_DISABLED']);
    expect(runtimeLoader).not.toHaveBeenCalled();
  });

  it.each([
    ['RPC endpoint', { ETHEREUM_RPC_URL: 'rpc-canary' }],
    ['provider credential', { ALCHEMY_API_KEY: 'provider-canary' }],
    ['auth credential', { AUTH_CLIENT_SECRET: 'auth-canary' }],
    ['general wallet input', { WALLET_ADDRESS: 'wallet-canary' }],
    ['wallet connector input', { WALLETCONNECT_PROJECT_ID: 'connector-canary' }],
    ['host proxy input', { HTTPS_PROXY: 'proxy-canary' }],
    ['ambient PostgreSQL credential', { PGPASSWORD: 'postgres-canary' }],
    ['Redis input', { REDIS_URL: 'redis-canary' }],
    ['signing material', { TRANSACTION_SIGNING_PRIVATE_KEY: 'signing-canary' }],
    ['admin credential', { DATABASE_ADMIN_PASSWORD: 'admin-canary' }],
    ['legacy database input', { DATABASE_URL: 'legacy-canary' }],
    ['demo input', { LOCAL_DEMO_IDENTITY: 'demo-canary' }],
    ['testnet input', { SOLANA_TESTNET_URL: 'testnet-canary' }],
    ['Base input', { BASE_RPC_URL: 'base-canary' }],
    ['unknown consumer input', { BALANCE_CONSUMER_RPC_ENDPOINT: 'consumer-canary' }],
  ])('rejects %s without reflecting its name or value', (_description, injected) => {
    const result = evaluateBalanceSyncConsumerCliMode([], enabledEnvironment(injected));
    const serialized = JSON.stringify(result);

    expect(result.blockers).toContain('FORBIDDEN_ENVIRONMENT');
    expect(serialized).not.toContain(Object.keys(injected)[0]);
    expect(serialized).not.toContain(Object.values(injected)[0]);
  });

  it('rejects accessors without invoking them', () => {
    const environment = enabledEnvironment();
    const accessor = jest.fn(() => 'must-not-be-read');
    Object.defineProperty(environment, 'ETHEREUM_RPC_URL', { enumerable: true, get: accessor });

    const result = evaluateBalanceSyncConsumerCliMode([], environment);

    expect(result.blockers).toContain('ENVIRONMENT_SHAPE_INVALID');
    expect(accessor).not.toHaveBeenCalled();
  });

  it('requires no CLI arguments, exact production identity, approval, network, and enabled config', () => {
    const result = evaluateBalanceSyncConsumerCliMode(
      ['--force'],
      enabledEnvironment({
        NODE_ENV: 'test',
        APPLICATION_WORKLOAD: 'worker',
        BALANCE_CONSUMER_SOURCE_APPROVAL: 'approved',
        BALANCE_CONSUMER_NETWORK: 'base-mainnet',
        BALANCE_CONSUMER_MODE: 'disabled',
        BALANCE_CONSUMER_WALLET_METADATA_KEY_RING_JSON: undefined,
      }),
    );

    expect(result.blockers).toEqual([
      'SOURCE_ACTIVATION_DISABLED',
      'ARGUMENTS_INVALID',
      'NON_PRODUCTION_RUNTIME',
      'WORKLOAD_IDENTITY_INVALID',
      'SOURCE_APPROVAL_INVALID',
      'NETWORK_SCOPE_INVALID',
      'BALANCE_CONFIGURATION_NOT_ENABLED',
    ]);
  });

  it('collapses malformed configuration to fixed codes', () => {
    const secret = 'configuration-canary';
    const result = evaluateBalanceSyncConsumerCliMode(
      [],
      enabledEnvironment({ BALANCE_CONSUMER_WALLET_METADATA_KEY_RING_JSON: secret }),
    );
    const output = JSON.stringify(result);

    expect(result.blockers).toContain('BALANCE_CONFIGURATION_INVALID');
    expect(output).toBe(
      '{"status":"refused","exitCode":1,"blockers":["SOURCE_ACTIVATION_DISABLED","BALANCE_CONFIGURATION_INVALID"]}',
    );
    expect(output).not.toContain(secret);
  });

  it.each(['SQS_QUEUE_URL', 'SQS_DEAD_LETTER_QUEUE_URL', 'SQS_PUBLISH_TOKEN'])(
    'refuses the generic or unknown SQS input %s without reflecting it',
    (name) => {
      const value = 'sqs-configuration-canary';
      const result = evaluateBalanceSyncConsumerCliMode([], enabledEnvironment({ [name]: value }));
      const output = JSON.stringify(result);

      expect(result.blockers).toEqual([
        'SOURCE_ACTIVATION_DISABLED',
        'INFRASTRUCTURE_CONFIGURATION_INVALID',
      ]);
      expect(output).not.toContain(name);
      expect(output).not.toContain(value);
    },
  );
});
