import { Buffer } from 'node:buffer';

import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { PostgresService } from '../../../infrastructure/database/postgres.service';
import { parseWalletAddress } from '../../../wallets/domain/wallet-identity';
import {
  openWalletRegistrationValue,
  walletRegistrationKeyForVersion,
  type WalletRegistrationDigest,
} from '../../../wallets/infrastructure/crypto/wallet-registration-crypto';
import type {
  BalanceSyncExecutionContext,
  BalanceSyncScope,
  BalanceSyncWalletAddressResolverPort,
} from '../../application/ports/balance-sync.ports';
import { reviewBalanceSyncExecutionContext } from '../../application/ports/balance-sync.ports';
import {
  BALANCE_CONSUMER_CONFIG,
  type BalanceConsumerConfig,
} from '../config/balance-consumer.config';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const RESULT_COLUMNS = Object.freeze([
  'resolved_wallet_id',
  'resolved_account_id',
  'resolved_challenge_id',
  'resolved_network_id',
  'resolved_address_digest_version',
  'resolved_address_digest',
  'resolved_address_key_version',
  'resolved_address_ciphertext',
  'resolved_address_iv',
  'resolved_address_auth_tag',
] as const);

interface ResolvedAddressRow extends QueryResultRow {
  resolved_wallet_id: string;
  resolved_account_id: string;
  resolved_challenge_id: string;
  resolved_network_id: string;
  resolved_address_digest_version: number;
  resolved_address_digest: Buffer;
  resolved_address_key_version: number;
  resolved_address_ciphertext: Buffer;
  resolved_address_iv: Buffer;
  resolved_address_auth_tag: Buffer;
}

export class BalanceSyncWalletAddressResolutionError extends Error {
  readonly code = 'BALANCE_SYNC_WALLET_ADDRESS_RESOLUTION_FAILED' as const;

  constructor() {
    super('Balance sync wallet address resolution failed');
    this.name = 'BalanceSyncWalletAddressResolutionError';
  }
}

function fail(): never {
  throw new BalanceSyncWalletAddressResolutionError();
}

function activeExecutionSignal(context: unknown): AbortSignal {
  const reviewed = reviewBalanceSyncExecutionContext(context);
  if (reviewed === null || reviewed.abortKind !== null) return fail();
  return reviewed.signal;
}

function exactScope(value: unknown): Readonly<{
  accountId: string;
  walletId: string;
  networkId: typeof ETHEREUM | typeof SOLANA;
}> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== 3 ||
      keys.some(
        (key) => typeof key !== 'string' || !['accountId', 'walletId', 'networkId'].includes(key),
      )
    ) {
      return fail();
    }
    for (const key of ['accountId', 'walletId', 'networkId'] as const) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
    }
    const accountId = descriptors.accountId?.value as unknown;
    const walletId = descriptors.walletId?.value as unknown;
    const networkId = descriptors.networkId?.value as unknown;
    if (
      typeof accountId !== 'string' ||
      !UUID_V4.test(accountId) ||
      typeof walletId !== 'string' ||
      !UUID_V4.test(walletId) ||
      (networkId !== ETHEREUM && networkId !== SOLANA)
    ) {
      return fail();
    }
    return Object.freeze({ accountId, walletId, networkId });
  } catch (error) {
    if (error instanceof BalanceSyncWalletAddressResolutionError) throw error;
    return fail();
  }
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return fail();
  return value;
}

function smallint(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 32_767) {
    return fail();
  }
  return value as number;
}

function bytes(value: unknown, minimum: number, maximum: number): Buffer {
  if (!Buffer.isBuffer(value) || value.length < minimum || value.length > maximum) return fail();
  return Buffer.from(value);
}

function exactRow(value: unknown): ResolvedAddressRow {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== RESULT_COLUMNS.length ||
      keys.some(
        (key) => typeof key !== 'string' || !(RESULT_COLUMNS as readonly string[]).includes(key),
      )
    ) {
      return fail();
    }
    const result = Object.create(null) as ResolvedAddressRow;
    for (const column of RESULT_COLUMNS) {
      const descriptor = descriptors[column];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
      result[column] = descriptor.value as never;
    }
    return result;
  } catch (error) {
    if (error instanceof BalanceSyncWalletAddressResolutionError) throw error;
    return fail();
  }
}

/**
 * Dormant resolver for a future dedicated balance consumer. The database
 * function returns one exact sealed address; this adapter opens it in memory
 * and returns only a canonically validated Ethereum or Solana address.
 */
@Injectable()
export class PostgresBalanceSyncWalletAddressResolver implements BalanceSyncWalletAddressResolverPort {
  constructor(
    private readonly postgres: PostgresService,
    @Inject(BALANCE_CONSUMER_CONFIG) private readonly config: BalanceConsumerConfig,
  ) {}

  async resolveActiveAddress(
    scopeInput: BalanceSyncScope,
    context: BalanceSyncExecutionContext,
  ): Promise<unknown> {
    try {
      const signal = activeExecutionSignal(context);
      if (this.config.mode !== 'enabled') return fail();
      const scope = exactScope(scopeInput);
      const result = await this.postgres.queryWithCancellation<ResolvedAddressRow>(
        `SELECT *
         FROM resolve_active_wallet_address_ciphertext($1::uuid, $2::uuid, $3::text)`,
        [scope.accountId, scope.walletId, scope.networkId],
        signal,
      );
      activeExecutionSignal(context);
      if (result.rows.length !== 1) return fail();
      const row = exactRow(result.rows[0]);
      const walletId = uuid(row.resolved_wallet_id);
      const accountId = uuid(row.resolved_account_id);
      const challengeId = uuid(row.resolved_challenge_id);
      if (
        walletId !== scope.walletId ||
        accountId !== scope.accountId ||
        row.resolved_network_id !== scope.networkId
      ) {
        return fail();
      }
      const digestVersion = smallint(row.resolved_address_digest_version);
      const digest = bytes(row.resolved_address_digest, 32, 32).toString('hex');
      const keyVersion = smallint(row.resolved_address_key_version);
      const plaintext = openWalletRegistrationValue(
        walletRegistrationKeyForVersion(this.config.walletMetadataSealKeys, keyVersion),
        {
          field: 'address',
          walletId,
          challengeId,
          accountId,
          networkId: scope.networkId,
          addressDigest: Object.freeze({
            version: digestVersion,
            value: digest as WalletRegistrationDigest<'address'>,
          }),
        },
        Object.freeze({
          keyVersion,
          ciphertext: bytes(row.resolved_address_ciphertext, 1, 128).toString('base64url'),
          iv: bytes(row.resolved_address_iv, 12, 12).toString('base64url'),
          authTag: bytes(row.resolved_address_auth_tag, 16, 16).toString('base64url'),
        }),
      );
      const canonicalAddress = parseWalletAddress(scope.networkId, plaintext);
      if (canonicalAddress !== plaintext) return fail();
      return canonicalAddress;
    } catch (error) {
      if (error instanceof BalanceSyncWalletAddressResolutionError) throw error;
      return fail();
    }
  }
}
