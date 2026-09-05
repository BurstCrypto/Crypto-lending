import { Buffer } from 'node:buffer';

import type { PostgresService } from '../../../infrastructure/database/postgres.service';
import {
  createBalanceSyncExecutionContext,
  INERT_BALANCE_SYNC_EXECUTION_CONTEXT,
  reviewBalanceSyncExecutionContext,
  type BalanceSyncScope,
} from '../../application/ports/balance-sync.ports';
import {
  createWalletRegistrationKey,
  createWalletRegistrationKeyRing,
  sealWalletRegistrationValue,
  type WalletRegistrationDigest,
} from '../../../wallets/infrastructure/crypto/wallet-registration-crypto';
import type { BalanceConsumerConfig } from '../config/balance-consumer.config';
import {
  BalanceSyncWalletAddressResolutionError,
  PostgresBalanceSyncWalletAddressResolver,
} from './postgres-balance-sync-wallet-address.resolver';

const ACCOUNT_ID = '123e4567-e89b-42d3-a456-426614174000';
const WALLET_ID = '223e4567-e89b-42d3-a456-426614174001';
const CHALLENGE_ID = '323e4567-e89b-42d3-a456-426614174002';
const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const EVM_ADDRESS = '0x1111111111111111111111111111111111111111';
const SOLANA_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const DIGEST = 'ab'.repeat(32) as WalletRegistrationDigest<'address'>;
const OLD_KEY = createWalletRegistrationKey(
  'metadata-seal',
  1,
  Buffer.alloc(32, 1).toString('base64url'),
  'consumer-metadata-v1',
);
const CURRENT_KEY = createWalletRegistrationKey(
  'metadata-seal',
  2,
  Buffer.alloc(32, 2).toString('base64url'),
  'consumer-metadata-v2',
);
const CONFIG: BalanceConsumerConfig = Object.freeze({
  mode: 'enabled',
  walletMetadataSealKeys: createWalletRegistrationKeyRing('metadata-seal', 2, [
    OLD_KEY,
    CURRENT_KEY,
  ]),
});

interface ResolverRow {
  readonly resolved_wallet_id: string;
  readonly resolved_account_id: string;
  readonly resolved_challenge_id: string;
  readonly resolved_network_id: typeof ETHEREUM | typeof SOLANA;
  readonly resolved_address_digest_version: number;
  readonly resolved_address_digest: Buffer;
  readonly resolved_address_key_version: number;
  readonly resolved_address_ciphertext: Buffer;
  readonly resolved_address_iv: Buffer;
  readonly resolved_address_auth_tag: Buffer;
}

function row(
  networkId: typeof ETHEREUM | typeof SOLANA,
  address: string,
  key = OLD_KEY,
): ResolverRow {
  const sealed = sealWalletRegistrationValue(
    key,
    {
      field: 'address',
      walletId: WALLET_ID,
      challengeId: CHALLENGE_ID,
      accountId: ACCOUNT_ID,
      networkId,
      addressDigest: { version: 1, value: DIGEST },
    },
    address,
  );
  return {
    resolved_wallet_id: WALLET_ID,
    resolved_account_id: ACCOUNT_ID,
    resolved_challenge_id: CHALLENGE_ID,
    resolved_network_id: networkId,
    resolved_address_digest_version: 1,
    resolved_address_digest: Buffer.from(DIGEST, 'hex'),
    resolved_address_key_version: sealed.keyVersion,
    resolved_address_ciphertext: Buffer.from(sealed.ciphertext, 'base64url'),
    resolved_address_iv: Buffer.from(sealed.iv, 'base64url'),
    resolved_address_auth_tag: Buffer.from(sealed.authTag, 'base64url'),
  };
}

function fixture(
  rows: readonly ResolverRow[],
  config = CONFIG,
): Readonly<{
  query: ReturnType<typeof jest.fn>;
  resolver: PostgresBalanceSyncWalletAddressResolver;
}> {
  const query = jest.fn().mockResolvedValue({ rows });
  const postgres = { queryWithCancellation: query } as unknown as PostgresService;
  return {
    query,
    resolver: new PostgresBalanceSyncWalletAddressResolver(postgres, config),
  };
}

function resolveAddress(
  resolver: PostgresBalanceSyncWalletAddressResolver,
  scope: BalanceSyncScope,
): Promise<unknown> {
  return resolver.resolveActiveAddress(scope, INERT_BALANCE_SYNC_EXECUTION_CONTEXT);
}

describe('PostgresBalanceSyncWalletAddressResolver', () => {
  it.each(['DEADLINE', 'SHUTDOWN'] as const)(
    'rejects a pre-aborted %s context before issuing SQL',
    async (kind) => {
      const execution = createBalanceSyncExecutionContext();
      execution.abort(kind);
      const test = fixture([row(ETHEREUM, EVM_ADDRESS)]);

      await expect(
        test.resolver.resolveActiveAddress(
          { accountId: ACCOUNT_ID, walletId: WALLET_ID, networkId: ETHEREUM },
          execution.context,
        ),
      ).rejects.toEqual(new BalanceSyncWalletAddressResolutionError());
      expect(test.query).not.toHaveBeenCalled();
    },
  );

  it('rejects when the exact context aborts while an awaited query settles', async () => {
    const execution = createBalanceSyncExecutionContext();
    const test = fixture([row(ETHEREUM, EVM_ADDRESS)]);
    test.query.mockImplementation(async () => {
      execution.abort('SHUTDOWN');
      return { rows: [row(ETHEREUM, EVM_ADDRESS)] };
    });

    await expect(
      test.resolver.resolveActiveAddress(
        { accountId: ACCOUNT_ID, walletId: WALLET_ID, networkId: ETHEREUM },
        execution.context,
      ),
    ).rejects.toEqual(new BalanceSyncWalletAddressResolutionError());
    expect(test.query.mock.calls[0]?.[2]).toBe(
      reviewBalanceSyncExecutionContext(execution.context)?.signal,
    );
  });

  it.each([
    [ETHEREUM, EVM_ADDRESS],
    [SOLANA, SOLANA_ADDRESS],
  ] as const)(
    'opens a version-selected sealed %s address and returns it canonically',
    async (networkId, address) => {
      const { query, resolver } = fixture([row(networkId, address)]);
      await expect(
        resolveAddress(resolver, { accountId: ACCOUNT_ID, walletId: WALLET_ID, networkId }),
      ).resolves.toBe(address);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('resolve_active_wallet_address_ciphertext'),
        [ACCOUNT_ID, WALLET_ID, networkId],
        reviewBalanceSyncExecutionContext(INERT_BALANCE_SYNC_EXECUTION_CONTEXT)?.signal,
      );
    },
  );

  it('supports the current key while retaining bounded predecessor decryption', async () => {
    const currentRow = row(ETHEREUM, EVM_ADDRESS, CURRENT_KEY);
    const { resolver } = fixture([currentRow]);
    await expect(
      resolveAddress(resolver, {
        accountId: ACCOUNT_ID,
        walletId: WALLET_ID,
        networkId: ETHEREUM,
      }),
    ).resolves.toBe(EVM_ADDRESS);
  });

  it.each([
    ['no active row', []],
    ['ambiguous rows', [row(ETHEREUM, EVM_ADDRESS), row(ETHEREUM, EVM_ADDRESS)]],
    ['scope mismatch', [{ ...row(ETHEREUM, EVM_ADDRESS), resolved_account_id: CHALLENGE_ID }]],
    ['unknown key version', [{ ...row(ETHEREUM, EVM_ADDRESS), resolved_address_key_version: 3 }]],
    [
      'tampered ciphertext',
      [
        {
          ...row(ETHEREUM, EVM_ADDRESS),
          resolved_address_ciphertext: Buffer.alloc(20, 7),
        },
      ],
    ],
    ['unexpected returned field', [{ ...row(ETHEREUM, EVM_ADDRESS), raw_address: EVM_ADDRESS }]],
  ])('fails closed with one sanitized error for %s', async (_name, rows) => {
    const { resolver } = fixture(rows as readonly ResolverRow[]);
    const operation = resolveAddress(resolver, {
      accountId: ACCOUNT_ID,
      walletId: WALLET_ID,
      networkId: ETHEREUM,
    });
    await expect(operation).rejects.toEqual(new BalanceSyncWalletAddressResolutionError());
    await expect(operation).rejects.not.toHaveProperty('cause');
  });

  it('rejects noncanonical plaintext after successful authenticated decryption', async () => {
    const { resolver } = fixture([row(ETHEREUM, '0x52908400098527886E0F7030069857D2E4169EE7')]);
    await expect(
      resolveAddress(resolver, {
        accountId: ACCOUNT_ID,
        walletId: WALLET_ID,
        networkId: ETHEREUM,
      }),
    ).rejects.toEqual(new BalanceSyncWalletAddressResolutionError());
  });

  it('rejects accessor and custom-prototype database rows without invoking them', async () => {
    const getter = jest.fn(() => WALLET_ID);
    const accessor = row(ETHEREUM, EVM_ADDRESS);
    Object.defineProperty(accessor, 'resolved_wallet_id', {
      enumerable: true,
      configurable: true,
      get: getter,
    });
    const accessorFixture = fixture([accessor]);
    await expect(
      resolveAddress(accessorFixture.resolver, {
        accountId: ACCOUNT_ID,
        walletId: WALLET_ID,
        networkId: ETHEREUM,
      }),
    ).rejects.toEqual(new BalanceSyncWalletAddressResolutionError());
    expect(getter).not.toHaveBeenCalled();

    const inherited = Object.assign(Object.create({ poisoned: true }) as object, {
      ...row(ETHEREUM, EVM_ADDRESS),
    }) as ResolverRow;
    const prototypeFixture = fixture([inherited]);
    await expect(
      resolveAddress(prototypeFixture.resolver, {
        accountId: ACCOUNT_ID,
        walletId: WALLET_ID,
        networkId: ETHEREUM,
      }),
    ).rejects.toEqual(new BalanceSyncWalletAddressResolutionError());
  });

  it('does not query when disabled or when the requested scope is malformed', async () => {
    const disabled = fixture([row(ETHEREUM, EVM_ADDRESS)], { mode: 'disabled' });
    await expect(
      resolveAddress(disabled.resolver, {
        accountId: ACCOUNT_ID,
        walletId: WALLET_ID,
        networkId: ETHEREUM,
      }),
    ).rejects.toEqual(new BalanceSyncWalletAddressResolutionError());
    expect(disabled.query).not.toHaveBeenCalled();

    const enabled = fixture([row(ETHEREUM, EVM_ADDRESS)]);
    await expect(
      resolveAddress(enabled.resolver, {
        accountId: ACCOUNT_ID,
        walletId: WALLET_ID,
        networkId: 'eip155:8453',
      }),
    ).rejects.toEqual(new BalanceSyncWalletAddressResolutionError());
    expect(enabled.query).not.toHaveBeenCalled();
  });

  it('maps database failures to the same non-sensitive error', async () => {
    const query = jest.fn().mockRejectedValue(new Error(`driver leaked ${EVM_ADDRESS}`));
    const resolver = new PostgresBalanceSyncWalletAddressResolver(
      { queryWithCancellation: query } as unknown as PostgresService,
      CONFIG,
    );
    const operation = resolveAddress(resolver, {
      accountId: ACCOUNT_ID,
      walletId: WALLET_ID,
      networkId: ETHEREUM,
    });
    await expect(operation).rejects.toEqual(new BalanceSyncWalletAddressResolutionError());
    await expect(operation).rejects.not.toHaveProperty('cause');
  });
});
