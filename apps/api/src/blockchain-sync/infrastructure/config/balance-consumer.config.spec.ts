import { Buffer } from 'node:buffer';

import {
  BalanceConsumerConfigurationError,
  loadBalanceConsumerConfig,
} from './balance-consumer.config';

function material(byte: number): string {
  return Buffer.alloc(32, byte).toString('base64url');
}

function ring(
  entries: readonly [number, number][],
  activeWriteVersion = entries.at(-1)?.[0],
): string {
  return JSON.stringify({
    activeWriteVersion,
    keys: entries.map(([version, byte]) => ({
      keyId: `balance-consumer-metadata-v${version}`,
      purpose: 'metadata-seal',
      version,
      material: material(byte),
    })),
  });
}

describe('balance consumer configuration', () => {
  it('is disabled by default and rejects an orphaned consumer secret', () => {
    expect(loadBalanceConsumerConfig({})).toEqual({ mode: 'disabled' });
    expect(() =>
      loadBalanceConsumerConfig({
        BALANCE_CONSUMER_WALLET_METADATA_KEY_RING_JSON: ring([[1, 1]]),
      }),
    ).toThrow(BalanceConsumerConfigurationError);
  });

  it('loads a bounded metadata-only rotation ring', () => {
    const config = loadBalanceConsumerConfig({
      BALANCE_CONSUMER_MODE: 'enabled',
      BALANCE_CONSUMER_WALLET_METADATA_KEY_RING_JSON: ring([
        [1, 1],
        [2, 2],
      ]),
    });
    expect(config.mode).toBe('enabled');
    if (config.mode !== 'enabled') throw new Error('enabled fixture expected');
    expect(config.walletMetadataSealKeys).toMatchObject({
      purpose: 'metadata-seal',
      activeWriteVersion: 2,
      keys: [
        { keyId: 'balance-consumer-metadata-v1', purpose: 'metadata-seal', version: 1 },
        { keyId: 'balance-consumer-metadata-v2', purpose: 'metadata-seal', version: 2 },
      ],
    });
    expect(JSON.stringify(config)).not.toContain(material(1));
    expect(JSON.stringify(config)).not.toContain(material(2));
  });

  it.each([
    ['unknown mode', { BALANCE_CONSUMER_MODE: 'live' }],
    [
      'noncanonical JSON',
      {
        BALANCE_CONSUMER_MODE: 'enabled',
        BALANCE_CONSUMER_WALLET_METADATA_KEY_RING_JSON: `${ring([[1, 1]])} `,
      },
    ],
    [
      'wrong purpose',
      {
        BALANCE_CONSUMER_MODE: 'enabled',
        BALANCE_CONSUMER_WALLET_METADATA_KEY_RING_JSON: JSON.stringify({
          activeWriteVersion: 1,
          keys: [
            {
              keyId: 'balance-consumer-metadata-v1',
              purpose: 'identity-hmac',
              version: 1,
              material: material(1),
            },
          ],
        }),
      },
    ],
    [
      'unknown active version',
      {
        BALANCE_CONSUMER_MODE: 'enabled',
        BALANCE_CONSUMER_WALLET_METADATA_KEY_RING_JSON: ring([[1, 1]], 2),
      },
    ],
    [
      'duplicate material',
      {
        BALANCE_CONSUMER_MODE: 'enabled',
        BALANCE_CONSUMER_WALLET_METADATA_KEY_RING_JSON: JSON.stringify({
          activeWriteVersion: 2,
          keys: [
            {
              keyId: 'balance-consumer-metadata-v1',
              purpose: 'metadata-seal',
              version: 1,
              material: material(1),
            },
            {
              keyId: 'balance-consumer-metadata-v2',
              purpose: 'metadata-seal',
              version: 2,
              material: material(1),
            },
          ],
        }),
      },
    ],
  ])('fails closed for %s', (_name, environment) => {
    expect(() => loadBalanceConsumerConfig(environment)).toThrow(BalanceConsumerConfigurationError);
  });

  it('does not read or expose the API wallet/auth key contract', () => {
    const accessed = new Set<string>();
    const values: NodeJS.ProcessEnv = {
      BALANCE_CONSUMER_MODE: 'enabled',
      BALANCE_CONSUMER_WALLET_METADATA_KEY_RING_JSON: ring([[1, 1]]),
      WALLET_METADATA_SEAL_KEY: material(9),
      AUTH_SESSION_HMAC_KEY: material(8),
    };
    const environment = new Proxy(values, {
      get(target, property, receiver) {
        if (typeof property === 'string') accessed.add(property);
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    expect(loadBalanceConsumerConfig(environment).mode).toBe('enabled');
    expect([...accessed].sort()).toEqual([
      'BALANCE_CONSUMER_MODE',
      'BALANCE_CONSUMER_WALLET_METADATA_KEY_RING_JSON',
    ]);
  });
});
