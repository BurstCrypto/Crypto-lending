import { Buffer } from 'node:buffer';

import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { parseAccountId } from '../../../accounts/domain/account-profile';
import { isCanonicalUuidV4 } from '../../../infrastructure/logging';
import { PostgresService } from '../../../infrastructure/database/postgres.service';
import {
  MAX_ACTIVE_WALLET_REGISTRATIONS_PER_ACCOUNT,
  type ActiveWalletRegistrationRecord,
  type BeginWalletOwnershipChallengeRequest,
  type BegunWalletOwnershipChallenge,
  type CompleteWalletRegistrationRequest,
  type CompleteWalletRegistrationResult,
  type ListActiveWalletRegistrationsRequest,
  type PrepareWalletOwnershipChallengeRequest,
  type PrepareWalletOwnershipChallengeResult,
  type RejectWalletOwnershipChallengeRequest,
  type RejectWalletOwnershipChallengeResult,
  type RevokeWalletRegistrationRequest,
  type RevokeWalletRegistrationResult,
  type WalletChallengeRejectionReason,
  type WalletProofScheme,
  type WalletRegistrationRepositoryPort,
  type WalletRegistryBinding,
} from '../../application/ports/wallet-registration-repository.port';
import { WalletRegistrationRateLimitedError } from '../../application/wallet-registration.errors';
import { parseWalletChallengeId } from '../../domain/wallet-ownership-proof';
import { parseWalletChainId } from '../../domain/wallet-identity';
import {
  walletRegistrationDigestEquals,
  type SealedWalletRegistrationValue,
  type WalletRegistrationDigestPurpose,
  type WalletRegistrationDigestReference,
} from '../crypto/wallet-registration-crypto';

const LOWER_HEX_DIGEST = /^[0-9a-f]{64}$/u;

interface BeginRow extends QueryResultRow {
  challenge_id: string;
  expires_at: Date;
}

interface PrepareRow extends QueryResultRow {
  prepare_outcome: string;
  prepared_account_id: string | null;
  prepared_proof_scheme: string | null;
  prepared_chain_namespace: string | null;
  prepared_chain_reference: string | null;
  prepared_registry_environment: string | null;
  prepared_registry_version: number | null;
  prepared_registry_fingerprint_sha256: string | null;
  prepared_challenge_payload_key_version: number | null;
  prepared_challenge_payload_ciphertext: Buffer | null;
  prepared_challenge_payload_iv: Buffer | null;
  prepared_challenge_payload_auth_tag: Buffer | null;
  prepared_address_digest_version: number | null;
  prepared_address_digest: Buffer | null;
  prepared_domain_digest_version: number | null;
  prepared_domain_digest: Buffer | null;
  prepared_message_digest_version: number | null;
  prepared_message_digest: Buffer | null;
  prepared_nonce_digest_version: number | null;
  prepared_nonce_digest: Buffer | null;
  prepared_issued_at: Date | null;
  prepared_expires_at: Date | null;
}

interface RejectRow extends QueryResultRow {
  rejection_outcome: string;
}

interface CompleteRow extends QueryResultRow {
  registration_outcome: string;
  wallet_id: string | null;
  registered_at: Date | null;
}

interface RevokeRow extends QueryResultRow {
  revocation_outcome: string;
}

interface ActiveWalletRow extends QueryResultRow {
  active_wallet_id: string;
  active_account_id: string;
  active_registered_by_challenge_id: string;
  active_chain_namespace: string;
  active_chain_reference: string;
  active_registry_environment: string;
  active_registry_version: number;
  active_registry_fingerprint_sha256: string;
  active_address_digest_version: number;
  active_address_digest: Buffer;
  active_verification_digest_version: number;
  active_verification_digest: Buffer;
  active_address_key_version: number;
  active_address_ciphertext: Buffer;
  active_address_iv: Buffer;
  active_address_auth_tag: Buffer;
  active_registered_at: Date;
}

export class WalletRegistrationPersistenceError extends Error {
  readonly code = 'WALLET_REGISTRATION_PERSISTENCE_ERROR' as const;

  constructor() {
    super('Wallet registration persistence operation failed');
    this.name = 'WalletRegistrationPersistenceError';
  }
}

function oneRow<Row extends QueryResultRow>(rows: readonly Row[]): Row {
  const row = rows[0];
  if (!row || rows.length !== 1) throw new WalletRegistrationPersistenceError();
  return row;
}

function finiteDate(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new WalletRegistrationPersistenceError();
  }
  return value;
}

function uuid(value: unknown): string {
  if (!isCanonicalUuidV4(value)) throw new WalletRegistrationPersistenceError();
  return value;
}

function positiveSmallint(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 32_767) {
    throw new WalletRegistrationPersistenceError();
  }
  return value as number;
}

function digestBytes(reference: WalletRegistrationDigestReference): Buffer {
  positiveSmallint(reference.version);
  if (!LOWER_HEX_DIGEST.test(reference.value)) {
    throw new WalletRegistrationPersistenceError();
  }
  return Buffer.from(reference.value, 'hex');
}

function identityDigestParams(
  request: BeginWalletOwnershipChallengeRequest,
): readonly [readonly number[], readonly string[]] {
  const aliases = request.identityDigests;
  if (!Array.isArray(aliases) || aliases.length < 1 || aliases.length > 3) {
    throw new WalletRegistrationPersistenceError();
  }
  const versions: number[] = [];
  const digests: string[] = [];
  for (const [index, alias] of aliases.entries()) {
    const version = positiveSmallint(alias.version);
    if (
      (index > 0 && version <= (versions[index - 1] ?? 0)) ||
      !LOWER_HEX_DIGEST.test(alias.value) ||
      digests.includes(alias.value)
    ) {
      throw new WalletRegistrationPersistenceError();
    }
    versions.push(version);
    digests.push(alias.value);
  }
  const active = aliases.at(-1);
  if (!active || !walletRegistrationDigestEquals(active, request.addressDigest)) {
    throw new WalletRegistrationPersistenceError();
  }
  return Object.freeze([Object.freeze(versions), Object.freeze(digests)]);
}

function digestReference<Purpose extends WalletRegistrationDigestPurpose>(
  version: unknown,
  value: unknown,
): WalletRegistrationDigestReference<Purpose> {
  if (!Buffer.isBuffer(value) || value.length !== 32) {
    throw new WalletRegistrationPersistenceError();
  }
  return Object.freeze({
    version: positiveSmallint(version),
    value: value.toString('hex') as WalletRegistrationDigestReference<Purpose>['value'],
  });
}

function decodeSealedSegment(value: string, expectedLength?: number): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new WalletRegistrationPersistenceError();
  }
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.toString('base64url') !== value ||
    (expectedLength !== undefined && decoded.length !== expectedLength)
  ) {
    throw new WalletRegistrationPersistenceError();
  }
  return decoded;
}

function sealedParams(
  value: SealedWalletRegistrationValue,
): readonly [number, Buffer, Buffer, Buffer] {
  const ciphertext = decodeSealedSegment(value.ciphertext);
  if (ciphertext.length < 1 || ciphertext.length > 16_384) {
    throw new WalletRegistrationPersistenceError();
  }
  return [
    positiveSmallint(value.keyVersion),
    ciphertext,
    decodeSealedSegment(value.iv, 12),
    decodeSealedSegment(value.authTag, 16),
  ];
}

function sealedValue(
  keyVersion: unknown,
  ciphertext: unknown,
  iv: unknown,
  authTag: unknown,
  maximumCiphertextBytes = 16_384,
): SealedWalletRegistrationValue {
  if (
    !Number.isSafeInteger(maximumCiphertextBytes) ||
    maximumCiphertextBytes < 1 ||
    maximumCiphertextBytes > 16_384 ||
    !Buffer.isBuffer(ciphertext) ||
    ciphertext.length < 1 ||
    ciphertext.length > maximumCiphertextBytes ||
    !Buffer.isBuffer(iv) ||
    iv.length !== 12 ||
    !Buffer.isBuffer(authTag) ||
    authTag.length !== 16
  ) {
    throw new WalletRegistrationPersistenceError();
  }
  return Object.freeze({
    keyVersion: positiveSmallint(keyVersion),
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    authTag: authTag.toString('base64url'),
  });
}

function chainParts(chainId: string): readonly [string, string] {
  const separator = chainId.indexOf(':');
  if (separator < 1) throw new WalletRegistrationPersistenceError();
  return [chainId.slice(0, separator), chainId.slice(separator + 1)];
}

function proofScheme(value: unknown): WalletProofScheme {
  if (
    value !== 'EVM_ERC4361_ERC191' &&
    value !== 'SOLANA_SIWS_SIGN_IN' &&
    value !== 'SOLANA_SIWS_SIGN_MESSAGE'
  ) {
    throw new WalletRegistrationPersistenceError();
  }
  return value;
}

function registryBinding(
  environment: unknown,
  version: unknown,
  fingerprintSha256: unknown,
): WalletRegistryBinding {
  if (
    (environment !== 'MAINNET' && environment !== 'TESTNET') ||
    version !== 1 ||
    typeof fingerprintSha256 !== 'string' ||
    !LOWER_HEX_DIGEST.test(fingerprintSha256)
  ) {
    throw new WalletRegistrationPersistenceError();
  }
  return Object.freeze({ environment, version, fingerprintSha256 });
}

function rejectionReason(value: WalletChallengeRejectionReason): WalletChallengeRejectionReason {
  if (
    value !== 'MALFORMED_PROOF' &&
    value !== 'SIGNATURE_INVALID' &&
    value !== 'WRONG_DOMAIN' &&
    value !== 'WRONG_USER' &&
    value !== 'WRONG_NETWORK' &&
    value !== 'WRONG_ADDRESS' &&
    value !== 'WRONG_MESSAGE' &&
    value !== 'WRONG_NONCE' &&
    value !== 'UNSUPPORTED_SCHEME'
  ) {
    throw new WalletRegistrationPersistenceError();
  }
  return value;
}

function isPendingLimit(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '54000';
}

@Injectable()
export class PostgresWalletRegistrationRepository implements WalletRegistrationRepositoryPort {
  constructor(private readonly postgres: PostgresService) {}

  async listActiveWallets(
    request: ListActiveWalletRegistrationsRequest,
  ): Promise<readonly ActiveWalletRegistrationRecord[]> {
    try {
      const accountId = parseAccountId(request.accountId);
      const result = await this.postgres.query<ActiveWalletRow>(
        `SELECT active_wallet.*
         FROM list_active_wallet_registrations_rotatable($1::uuid) AS active_wallet`,
        [accountId],
      );
      if (result.rows.length > MAX_ACTIVE_WALLET_REGISTRATIONS_PER_ACCOUNT) {
        throw new WalletRegistrationPersistenceError();
      }

      const walletIds = new Set<string>();
      return Object.freeze(
        result.rows.map((row) => {
          const walletId = uuid(row.active_wallet_id);
          if (walletIds.has(walletId)) throw new WalletRegistrationPersistenceError();
          walletIds.add(walletId);
          const returnedAccountId = parseAccountId(row.active_account_id);
          if (returnedAccountId !== accountId) throw new WalletRegistrationPersistenceError();
          if (
            typeof row.active_chain_namespace !== 'string' ||
            typeof row.active_chain_reference !== 'string'
          ) {
            throw new WalletRegistrationPersistenceError();
          }
          return Object.freeze({
            walletId,
            accountId: returnedAccountId,
            registeredByChallengeId: parseWalletChallengeId(row.active_registered_by_challenge_id),
            chainId: parseWalletChainId(
              `${row.active_chain_namespace}:${row.active_chain_reference}`,
            ),
            registry: registryBinding(
              row.active_registry_environment,
              row.active_registry_version,
              row.active_registry_fingerprint_sha256,
            ),
            addressDigest: digestReference<'address'>(
              row.active_address_digest_version,
              row.active_address_digest,
            ),
            verificationAddressDigest: digestReference<'address'>(
              row.active_verification_digest_version,
              row.active_verification_digest,
            ),
            encryptedAddress: sealedValue(
              row.active_address_key_version,
              row.active_address_ciphertext,
              row.active_address_iv,
              row.active_address_auth_tag,
              512,
            ),
            registeredAt: finiteDate(row.active_registered_at),
          });
        }),
      );
    } catch (error) {
      if (error instanceof WalletRegistrationPersistenceError) throw error;
      throw new WalletRegistrationPersistenceError();
    }
  }

  async revokeWallet(
    request: RevokeWalletRegistrationRequest,
  ): Promise<RevokeWalletRegistrationResult> {
    try {
      const result = await this.postgres.query<RevokeRow>(
        `SELECT revoked.revocation_outcome
         FROM revoke_wallet_registration(
           $1::uuid, $2::uuid, $3::uuid
         ) AS revoked`,
        [parseAccountId(request.accountId), uuid(request.walletId), uuid(request.correlationId)],
      );
      const outcome = oneRow(result.rows).revocation_outcome;
      if (outcome === 'REVOKED') return Object.freeze({ status: 'revoked' });
      if (outcome === 'UNCHANGED') return Object.freeze({ status: 'unchanged' });
      throw new WalletRegistrationPersistenceError();
    } catch (error) {
      if (error instanceof WalletRegistrationPersistenceError) throw error;
      throw new WalletRegistrationPersistenceError();
    }
  }

  async beginChallenge(
    request: BeginWalletOwnershipChallengeRequest,
  ): Promise<BegunWalletOwnershipChallenge> {
    try {
      const [namespace, reference] = chainParts(request.chainId);
      const payload = sealedParams(request.challengePayload);
      const identityAliases = identityDigestParams(request);
      const result = await this.postgres.query<BeginRow>(
        `SELECT begun.challenge_id, begun.expires_at
         FROM begin_wallet_ownership_challenge_rotatable(
           $1::uuid, $2::uuid, $3::text, $4::text, $5::text,
           $6::text, $7::integer, $8::text,
           $9::smallint, $10::bytea, $11::bytea, $12::bytea,
           $13::smallint, $14::bytea, $15::smallint, $16::bytea,
           $17::smallint, $18::bytea, $19::smallint, $20::bytea,
           $21::timestamptz, $22::timestamptz, $23::uuid,
           $24::smallint[], $25::text[]
         ) AS begun`,
        [
          parseWalletChallengeId(request.challengeId),
          parseAccountId(request.accountId),
          proofScheme(request.proofScheme),
          namespace,
          reference,
          request.registry.environment,
          request.registry.version,
          request.registry.fingerprintSha256,
          ...payload,
          request.addressDigest.version,
          digestBytes(request.addressDigest),
          request.domainDigest.version,
          digestBytes(request.domainDigest),
          request.messageDigest.version,
          digestBytes(request.messageDigest),
          request.nonceDigest.version,
          digestBytes(request.nonceDigest),
          finiteDate(request.issuedAt),
          finiteDate(request.expiresAt),
          uuid(request.correlationId),
          identityAliases[0],
          identityAliases[1],
        ],
      );
      const row = oneRow(result.rows);
      return Object.freeze({
        challengeId: parseWalletChallengeId(row.challenge_id),
        expiresAt: finiteDate(row.expires_at),
      });
    } catch (error) {
      if (error instanceof WalletRegistrationPersistenceError) throw error;
      if (isPendingLimit(error)) throw new WalletRegistrationRateLimitedError(60);
      throw new WalletRegistrationPersistenceError();
    }
  }

  async prepareChallenge(
    request: PrepareWalletOwnershipChallengeRequest,
  ): Promise<PrepareWalletOwnershipChallengeResult> {
    try {
      const challengeId = parseWalletChallengeId(request.challengeId);
      const accountId = parseAccountId(request.accountId);
      const correlationId = uuid(request.correlationId);
      const result = await this.postgres.query<PrepareRow>(
        `SELECT prepared.*
         FROM prepare_wallet_ownership_challenge(
           $1::uuid, $2::uuid, $3::uuid
         ) AS prepared
         LIMIT 2`,
        [challengeId, accountId, correlationId],
      );
      const row = oneRow(result.rows);
      if (row.prepare_outcome === 'READY') {
        if (row.prepared_chain_namespace === null || row.prepared_chain_reference === null) {
          throw new WalletRegistrationPersistenceError();
        }
        const preparedAccountId = parseAccountId(row.prepared_account_id);
        if (preparedAccountId !== accountId) {
          throw new WalletRegistrationPersistenceError();
        }
        return Object.freeze({
          status: 'pending',
          challengeId,
          accountId: preparedAccountId,
          proofScheme: proofScheme(row.prepared_proof_scheme),
          chainId: parseWalletChainId(
            `${row.prepared_chain_namespace}:${row.prepared_chain_reference}`,
          ),
          registry: registryBinding(
            row.prepared_registry_environment,
            row.prepared_registry_version,
            row.prepared_registry_fingerprint_sha256,
          ),
          challengePayload: sealedValue(
            row.prepared_challenge_payload_key_version,
            row.prepared_challenge_payload_ciphertext,
            row.prepared_challenge_payload_iv,
            row.prepared_challenge_payload_auth_tag,
          ),
          addressDigest: digestReference<'address'>(
            row.prepared_address_digest_version,
            row.prepared_address_digest,
          ),
          domainDigest: digestReference<'domain'>(
            row.prepared_domain_digest_version,
            row.prepared_domain_digest,
          ),
          messageDigest: digestReference<'message'>(
            row.prepared_message_digest_version,
            row.prepared_message_digest,
          ),
          nonceDigest: digestReference<'nonce'>(
            row.prepared_nonce_digest_version,
            row.prepared_nonce_digest,
          ),
          issuedAt: finiteDate(row.prepared_issued_at),
          expiresAt: finiteDate(row.prepared_expires_at),
        });
      }
      const leaked = Object.entries(row).some(
        ([key, value]) => key !== 'prepare_outcome' && value !== null,
      );
      if (leaked) throw new WalletRegistrationPersistenceError();
      if (row.prepare_outcome === 'EXPIRED') return Object.freeze({ status: 'expired' });
      if (row.prepare_outcome === 'INVALID') return Object.freeze({ status: 'invalid' });
      if (row.prepare_outcome === 'REPLAYED') return Object.freeze({ status: 'replayed' });
      throw new WalletRegistrationPersistenceError();
    } catch (error) {
      if (error instanceof WalletRegistrationPersistenceError) throw error;
      throw new WalletRegistrationPersistenceError();
    }
  }

  async rejectChallenge(
    request: RejectWalletOwnershipChallengeRequest,
  ): Promise<RejectWalletOwnershipChallengeResult> {
    try {
      const result = await this.postgres.query<RejectRow>(
        `SELECT rejected.rejection_outcome
         FROM reject_wallet_ownership_challenge(
           $1::uuid, $2::uuid, $3::text, $4::uuid
         ) AS rejected`,
        [
          parseWalletChallengeId(request.challengeId),
          parseAccountId(request.accountId),
          rejectionReason(request.reason),
          uuid(request.correlationId),
        ],
      );
      const outcome = oneRow(result.rows).rejection_outcome;
      if (outcome === 'REJECTED') return Object.freeze({ status: 'rejected' });
      if (outcome === 'EXPIRED') return Object.freeze({ status: 'expired' });
      if (outcome === 'INVALID') return Object.freeze({ status: 'invalid' });
      if (outcome === 'REPLAYED') return Object.freeze({ status: 'replayed' });
      throw new WalletRegistrationPersistenceError();
    } catch (error) {
      if (error instanceof WalletRegistrationPersistenceError) throw error;
      throw new WalletRegistrationPersistenceError();
    }
  }

  async completeRegistration(
    request: CompleteWalletRegistrationRequest,
  ): Promise<CompleteWalletRegistrationResult> {
    try {
      const address = sealedParams(request.encryptedAddress);
      const metadata = sealedParams(request.encryptedMetadata);
      const result = await this.postgres.query<CompleteRow>(
        `SELECT completed.registration_outcome,
                completed.wallet_id,
                completed.registered_at
         FROM complete_wallet_registration_rotatable(
           $1::uuid, $2::uuid, $3::uuid,
           $4::smallint, $5::bytea, $6::bytea, $7::bytea,
           $8::smallint, $9::bytea, $10::bytea, $11::bytea,
           $12::uuid
         ) AS completed`,
        [
          parseWalletChallengeId(request.challengeId),
          parseAccountId(request.accountId),
          uuid(request.walletId),
          ...address,
          ...metadata,
          uuid(request.correlationId),
        ],
      );
      const row = oneRow(result.rows);
      if (
        row.registration_outcome === 'REGISTERED' ||
        row.registration_outcome === 'ALREADY_REGISTERED'
      ) {
        return Object.freeze({
          status: row.registration_outcome === 'REGISTERED' ? 'registered' : 'already_registered',
          walletId: uuid(row.wallet_id),
          registeredAt: finiteDate(row.registered_at),
        });
      }
      if (row.wallet_id !== null || row.registered_at !== null) {
        throw new WalletRegistrationPersistenceError();
      }
      if (row.registration_outcome === 'OWNERSHIP_CONFLICT') {
        return Object.freeze({ status: 'ownership_conflict' });
      }
      if (row.registration_outcome === 'REVOKED') return Object.freeze({ status: 'revoked' });
      if (row.registration_outcome === 'EXPIRED') return Object.freeze({ status: 'expired' });
      if (row.registration_outcome === 'INVALID') return Object.freeze({ status: 'invalid' });
      if (row.registration_outcome === 'REPLAYED') return Object.freeze({ status: 'replayed' });
      throw new WalletRegistrationPersistenceError();
    } catch (error) {
      if (error instanceof WalletRegistrationPersistenceError) throw error;
      throw new WalletRegistrationPersistenceError();
    }
  }
}
