import { Buffer } from 'node:buffer';

import type { QueryResultRow } from 'pg';

import { parseAccountId } from '../../../accounts/domain/account-profile';
import type { PostgresService } from '../../../infrastructure/database/postgres.service';
import { isCanonicalUuidV4 } from '../../../infrastructure/logging';
import type {
  CompleteWalletMetadataRewrapRequest,
  CompleteWalletMetadataRewrapResult,
  PrepareWalletMetadataRewrapResult,
  WalletMetadataRewrapRepositoryPort,
  WalletMetadataRewrapScope,
  WalletMetadataSealKeyRetirementReadiness,
} from '../../application/ports/wallet-metadata-rewrap-repository.port';
import { parseWalletChainId } from '../../domain/wallet-identity';
import type {
  SealedWalletRegistrationValue,
  WalletRegistrationDigest,
  WalletRegistrationDigestReference,
} from '../crypto/wallet-registration-crypto';

const LOWER_HEX_SHA256 = /^[0-9a-f]{64}$/u;
const PREPARE_COLUMNS = Object.freeze([
  'rewrap_outcome',
  'prepared_command_id',
  'prepared_account_id',
  'prepared_wallet_id',
  'prepared_challenge_id',
  'prepared_chain_namespace',
  'prepared_chain_reference',
  'prepared_registry_environment',
  'prepared_registry_version',
  'prepared_registry_fingerprint_sha256',
  'prepared_address_digest_version',
  'prepared_address_digest',
  'prepared_verification_digest_version',
  'prepared_verification_digest',
  'prepared_address_key_version',
  'prepared_address_ciphertext',
  'prepared_address_iv',
  'prepared_address_auth_tag',
  'prepared_metadata_key_version',
  'prepared_metadata_ciphertext',
  'prepared_metadata_iv',
  'prepared_metadata_auth_tag',
  'prepared_state_sha256',
  'prepared_expires_at',
] as const);

interface PrepareRow extends QueryResultRow {
  rewrap_outcome: unknown;
  prepared_command_id: unknown;
  prepared_account_id: unknown;
  prepared_wallet_id: unknown;
  prepared_challenge_id: unknown;
  prepared_chain_namespace: unknown;
  prepared_chain_reference: unknown;
  prepared_registry_environment: unknown;
  prepared_registry_version: unknown;
  prepared_registry_fingerprint_sha256: unknown;
  prepared_address_digest_version: unknown;
  prepared_address_digest: unknown;
  prepared_verification_digest_version: unknown;
  prepared_verification_digest: unknown;
  prepared_address_key_version: unknown;
  prepared_address_ciphertext: unknown;
  prepared_address_iv: unknown;
  prepared_address_auth_tag: unknown;
  prepared_metadata_key_version: unknown;
  prepared_metadata_ciphertext: unknown;
  prepared_metadata_iv: unknown;
  prepared_metadata_auth_tag: unknown;
  prepared_state_sha256: unknown;
  prepared_expires_at: unknown;
}

interface CompleteRow extends QueryResultRow {
  rewrap_outcome: unknown;
}

interface ReadinessRow extends QueryResultRow {
  key_version: unknown;
  registered_address_count: unknown;
  registered_metadata_count: unknown;
  retained_challenge_count: unknown;
  unexpired_challenge_count: unknown;
  open_rewrap_command_count: unknown;
  ready: unknown;
}

export class WalletMetadataRewrapPersistenceError extends Error {
  readonly code = 'WALLET_METADATA_REWRAP_PERSISTENCE_FAILED' as const;

  constructor() {
    super('Wallet metadata rewrap persistence operation failed');
    this.name = 'WalletMetadataRewrapPersistenceError';
  }
}

function fail(): never {
  throw new WalletMetadataRewrapPersistenceError();
}

function exactRow<Row extends QueryResultRow>(value: unknown, columns: readonly string[]): Row {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== columns.length ||
      keys.some((key) => typeof key !== 'string' || !columns.includes(key))
    ) {
      return fail();
    }
    const result = Object.create(null) as Row;
    for (const column of columns) {
      const descriptor = descriptors[column];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
      (result as Record<string, unknown>)[column] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof WalletMetadataRewrapPersistenceError) throw error;
    return fail();
  }
}

function uuid(value: unknown): string {
  if (!isCanonicalUuidV4(value)) return fail();
  return value;
}

function smallint(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 32_767) {
    return fail();
  }
  return value as number;
}

function sha256(value: unknown): string {
  if (typeof value !== 'string' || !LOWER_HEX_SHA256.test(value)) return fail();
  return value;
}

function bytes(value: unknown, minimum: number, maximum: number): Buffer {
  if (!Buffer.isBuffer(value) || value.length < minimum || value.length > maximum) return fail();
  return Buffer.from(value);
}

function digest(version: unknown, value: unknown): WalletRegistrationDigestReference<'address'> {
  return Object.freeze({
    version: smallint(version),
    value: bytes(value, 32, 32).toString('hex') as WalletRegistrationDigest<'address'>,
  });
}

function sealed(
  keyVersion: unknown,
  ciphertext: unknown,
  iv: unknown,
  authTag: unknown,
  maximum: number,
): SealedWalletRegistrationValue {
  return Object.freeze({
    keyVersion: smallint(keyVersion),
    ciphertext: bytes(ciphertext, 1, maximum).toString('base64url'),
    iv: bytes(iv, 12, 12).toString('base64url'),
    authTag: bytes(authTag, 16, 16).toString('base64url'),
  });
}

function sealedParams(
  value: SealedWalletRegistrationValue,
  maximum: number,
): readonly [number, Buffer, Buffer, Buffer] {
  try {
    const decode = (segment: unknown, minimum: number, maximumLength: number): Buffer => {
      if (typeof segment !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(segment)) return fail();
      const decoded = Buffer.from(segment, 'base64url');
      if (
        decoded.length < minimum ||
        decoded.length > maximumLength ||
        decoded.toString('base64url') !== segment
      ) {
        return fail();
      }
      return decoded;
    };
    return Object.freeze([
      smallint(value.keyVersion),
      decode(value.ciphertext, 1, maximum),
      decode(value.iv, 12, 12),
      decode(value.authTag, 16, 16),
    ]);
  } catch (error) {
    if (error instanceof WalletMetadataRewrapPersistenceError) throw error;
    return fail();
  }
}

function exactCount(value: unknown): number {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,14})$/u.test(value)) return fail();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fail();
  return parsed;
}

function allNullExceptOutcome(row: PrepareRow): boolean {
  return PREPARE_COLUMNS.every((column) => column === 'rewrap_outcome' || row[column] === null);
}

/**
 * Dormant adapter for explicit schema-owner tooling/tests only. Migration 0024
 * grants no API, worker, legacy, or migration-runtime role access to its SQL
 * functions, and this class is absent from every Nest module.
 */
export class PostgresWalletMetadataRewrapRepository implements WalletMetadataRewrapRepositoryPort {
  constructor(private readonly postgres: PostgresService) {}

  async prepare(scope: WalletMetadataRewrapScope): Promise<PrepareWalletMetadataRewrapResult> {
    try {
      const accountId = parseAccountId(scope.accountId);
      const commandId = uuid(scope.commandId);
      const walletId = uuid(scope.walletId);
      const targetKeyVersion = smallint(scope.targetKeyVersion);
      const result = await this.postgres.query<PrepareRow>(
        `SELECT * FROM prepare_wallet_metadata_rewrap($1::uuid, $2::uuid, $3::uuid, $4::smallint)`,
        [commandId, accountId, walletId, targetKeyVersion],
      );
      if (result.rows.length !== 1) return fail();
      const row = exactRow<PrepareRow>(result.rows[0], PREPARE_COLUMNS);
      if (row.rewrap_outcome === 'COMPLETED' || row.rewrap_outcome === 'INVALID') {
        if (!allNullExceptOutcome(row)) return fail();
        return Object.freeze({
          status: row.rewrap_outcome === 'COMPLETED' ? 'completed' : 'invalid',
        });
      }
      if (row.rewrap_outcome !== 'PREPARED') return fail();
      const returnedAccountId = parseAccountId(row.prepared_account_id);
      const returnedCommandId = uuid(row.prepared_command_id);
      const returnedWalletId = uuid(row.prepared_wallet_id);
      if (
        returnedAccountId !== accountId ||
        returnedCommandId !== commandId ||
        returnedWalletId !== walletId ||
        row.prepared_registry_environment !== 'MAINNET' ||
        row.prepared_registry_version !== 1 ||
        typeof row.prepared_chain_namespace !== 'string' ||
        typeof row.prepared_chain_reference !== 'string'
      ) {
        return fail();
      }
      const expiresAt = row.prepared_expires_at;
      if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime())) return fail();
      return Object.freeze({
        status: 'prepared',
        commandId: returnedCommandId,
        accountId: returnedAccountId,
        walletId: returnedWalletId,
        registeredByChallengeId: uuid(row.prepared_challenge_id),
        chainId: parseWalletChainId(
          `${row.prepared_chain_namespace}:${row.prepared_chain_reference}`,
        ),
        registry: Object.freeze({
          environment: 'MAINNET',
          version: 1,
          fingerprintSha256: sha256(row.prepared_registry_fingerprint_sha256),
        }),
        addressDigest: digest(row.prepared_address_digest_version, row.prepared_address_digest),
        verificationAddressDigest: digest(
          row.prepared_verification_digest_version,
          row.prepared_verification_digest,
        ),
        encryptedAddress: sealed(
          row.prepared_address_key_version,
          row.prepared_address_ciphertext,
          row.prepared_address_iv,
          row.prepared_address_auth_tag,
          128,
        ),
        encryptedMetadata: sealed(
          row.prepared_metadata_key_version,
          row.prepared_metadata_ciphertext,
          row.prepared_metadata_iv,
          row.prepared_metadata_auth_tag,
          8_192,
        ),
        preparedStateSha256: sha256(row.prepared_state_sha256),
        expiresAt,
      });
    } catch (error) {
      if (error instanceof WalletMetadataRewrapPersistenceError) throw error;
      return fail();
    }
  }

  async complete(
    request: CompleteWalletMetadataRewrapRequest,
  ): Promise<CompleteWalletMetadataRewrapResult> {
    try {
      const targetKeyVersion = smallint(request.targetKeyVersion);
      const address = sealedParams(request.encryptedAddress, 128);
      const metadata = sealedParams(request.encryptedMetadata, 8_192);
      if (address[0] !== targetKeyVersion || metadata[0] !== targetKeyVersion) return fail();
      const result = await this.postgres.query<CompleteRow>(
        `SELECT completed.rewrap_outcome
         FROM complete_wallet_metadata_rewrap(
           $1::uuid, $2::uuid, $3::uuid, $4::text,
           $5::smallint, $6::bytea, $7::bytea, $8::bytea,
           $9::smallint, $10::bytea, $11::bytea, $12::bytea
         ) AS completed`,
        [
          uuid(request.commandId),
          parseAccountId(request.accountId),
          uuid(request.walletId),
          sha256(request.preparedStateSha256),
          ...address,
          ...metadata,
        ],
      );
      if (result.rows.length !== 1) return fail();
      const row = exactRow<CompleteRow>(result.rows[0], ['rewrap_outcome']);
      if (row.rewrap_outcome === 'COMPLETED') return Object.freeze({ status: 'completed' });
      if (row.rewrap_outcome === 'INVALID') return Object.freeze({ status: 'invalid' });
      return fail();
    } catch (error) {
      if (error instanceof WalletMetadataRewrapPersistenceError) throw error;
      return fail();
    }
  }

  async retirementReadiness(
    keyVersionValue: number,
  ): Promise<WalletMetadataSealKeyRetirementReadiness> {
    try {
      const keyVersion = smallint(keyVersionValue);
      const result = await this.postgres.query<ReadinessRow>(
        'SELECT * FROM wallet_metadata_seal_key_retirement_readiness($1::smallint)',
        [keyVersion],
      );
      if (result.rows.length !== 1) return fail();
      const row = exactRow<ReadinessRow>(result.rows[0], [
        'key_version',
        'registered_address_count',
        'registered_metadata_count',
        'retained_challenge_count',
        'unexpired_challenge_count',
        'open_rewrap_command_count',
        'ready',
      ]);
      const registeredAddressCount = exactCount(row.registered_address_count);
      const registeredMetadataCount = exactCount(row.registered_metadata_count);
      const retainedChallengeCount = exactCount(row.retained_challenge_count);
      const unexpiredChallengeCount = exactCount(row.unexpired_challenge_count);
      const openRewrapCommandCount = exactCount(row.open_rewrap_command_count);
      const ready = row.ready;
      if (
        row.key_version !== keyVersion ||
        typeof ready !== 'boolean' ||
        unexpiredChallengeCount > retainedChallengeCount ||
        ready !==
          (registeredAddressCount === 0 &&
            registeredMetadataCount === 0 &&
            retainedChallengeCount === 0 &&
            unexpiredChallengeCount === 0 &&
            openRewrapCommandCount === 0)
      ) {
        return fail();
      }
      return Object.freeze({
        keyVersion,
        registeredAddressCount,
        registeredMetadataCount,
        retainedChallengeCount,
        unexpiredChallengeCount,
        openRewrapCommandCount,
        ready,
      });
    } catch (error) {
      if (error instanceof WalletMetadataRewrapPersistenceError) throw error;
      return fail();
    }
  }
}
