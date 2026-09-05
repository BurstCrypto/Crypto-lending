import { Buffer } from 'node:buffer';

import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { parseAccountId } from '../../../accounts/domain/account-profile';
import { PostgresService } from '../../../infrastructure/database/postgres.service';
import {
  type AuthenticationDigestReference,
  type AuthenticationDigestCandidates,
  type AuthenticationRepositoryPort,
  type BeginAuthenticationTransactionRequest,
  type BegunAuthenticationTransaction,
  type ClaimAuthenticationTransactionRequest,
  type ClaimAuthenticationTransactionResult,
  type ClaimedAuthenticationRejectionReason,
  type CompleteAuthenticationLoginRequest,
  type CompleteAuthenticationLoginResult,
  type ResolveAuthenticationSessionRequest,
  type ResolveAuthenticationSessionResult,
  type RejectClaimedAuthenticationTransactionRequest,
  type RejectClaimedAuthenticationTransactionResult,
  type RevokeAuthenticationSessionRequest,
  type RevokeAuthenticationSessionResult,
  type RotateAuthenticationSessionRequest,
  type RotateAuthenticationSessionResult,
} from '../../application/ports/authentication-repository.port';
import {
  parseAuthenticationTransactionId,
  type AuthenticationFlow,
} from '../../domain/authentication';

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

interface BeginRow extends QueryResultRow {
  attempt_id: string;
  expires_at: Date;
}

interface ClaimRow extends QueryResultRow {
  claim_outcome: string;
  claimed_flow: string | null;
  claimed_issuer: string | null;
  claimed_nonce_digest_version: number | null;
  claimed_nonce_digest: Buffer | null;
}

interface CompleteRow extends QueryResultRow {
  login_outcome: string;
  account_id: string | null;
  session_family_id: string | null;
  credential_id: string | null;
  idle_expires_at: Date | null;
  absolute_expires_at: Date | null;
}

interface RejectClaimedRow extends QueryResultRow {
  rejection_outcome: string;
}

interface ResolveRow extends QueryResultRow {
  authentication_outcome: string;
  account_id: string | null;
  session_family_id: string | null;
}

interface RotateRow extends QueryResultRow {
  rotation_outcome: string;
  credential_id: string | null;
  expires_at: Date | null;
}

interface RevokeRow extends QueryResultRow {
  revocation_outcome: string;
}

export class AuthenticationPersistenceError extends Error {
  constructor() {
    super('Authentication persistence operation failed');
    this.name = 'AuthenticationPersistenceError';
  }
}

function digestBytes(reference: AuthenticationDigestReference): Buffer {
  if (!validDigestVersion(reference.version) || !DIGEST_PATTERN.test(reference.value)) {
    throw new AuthenticationPersistenceError();
  }
  return Buffer.from(reference.value, 'hex');
}

function validDigestVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 32_767;
}

function digestCandidateParameters(candidates: AuthenticationDigestCandidates): {
  readonly versions: readonly number[];
  readonly values: readonly string[];
} {
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 3) {
    throw new AuthenticationPersistenceError();
  }
  let priorVersion = 0;
  const values = new Set<string>();
  for (const candidate of candidates) {
    digestBytes(candidate);
    if (candidate.version <= priorVersion || values.has(candidate.value)) {
      throw new AuthenticationPersistenceError();
    }
    priorVersion = candidate.version;
    values.add(candidate.value);
  }
  return Object.freeze({
    versions: Object.freeze(candidates.map(({ version }) => version)),
    values: Object.freeze(candidates.map(({ value }) => value)),
  });
}

function finiteDate(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new AuthenticationPersistenceError();
  }
  return value;
}

function oneRow<Row extends QueryResultRow>(rows: readonly Row[]): Row {
  if (!Array.isArray(rows)) throw new AuthenticationPersistenceError();
  const row = rows[0];
  if (!row || rows.length !== 1) throw new AuthenticationPersistenceError();
  return row;
}

function uuid(value: unknown): string {
  try {
    return parseAuthenticationTransactionId(value);
  } catch {
    throw new AuthenticationPersistenceError();
  }
}

function databaseFlow(flow: AuthenticationFlow): 'LOGIN' | 'REGISTRATION' {
  if (flow === 'login') return 'LOGIN';
  if (flow === 'registration') return 'REGISTRATION';
  throw new AuthenticationPersistenceError();
}

function applicationFlow(value: unknown): AuthenticationFlow {
  if (value === 'LOGIN') return 'login';
  if (value === 'REGISTRATION') return 'registration';
  throw new AuthenticationPersistenceError();
}

function databaseClaimedRejectionReason(
  reason: ClaimedAuthenticationRejectionReason,
): ClaimedAuthenticationRejectionReason {
  if (reason === 'PROVIDER_ERROR' || reason === 'TOKEN_INVALID' || reason === 'IDENTITY_INVALID') {
    return reason;
  }
  throw new AuthenticationPersistenceError();
}

@Injectable()
export class PostgresAuthenticationRepository implements AuthenticationRepositoryPort {
  constructor(private readonly postgres: PostgresService) {}

  async beginTransaction(
    request: BeginAuthenticationTransactionRequest,
  ): Promise<BegunAuthenticationTransaction> {
    try {
      const transactionId = uuid(request.transactionId);
      const result = await this.postgres.query<BeginRow>(
        `SELECT begun.attempt_id, begun.expires_at
         FROM begin_authentication_login_attempt(
           $1::uuid, $2::text, $3::text, $4::smallint, $5::bytea, $6::smallint,
           $7::bytea, $8::smallint, $9::bytea, $10::integer, $11::uuid
         ) AS begun
         LIMIT 2`,
        [
          transactionId,
          databaseFlow(request.flow),
          request.issuer,
          request.stateDigest.version,
          digestBytes(request.stateDigest),
          request.browserBindingDigest.version,
          digestBytes(request.browserBindingDigest),
          request.nonceDigest.version,
          digestBytes(request.nonceDigest),
          request.ttlSeconds,
          uuid(request.correlationId),
        ],
      );
      const row = oneRow(result.rows);
      const returnedTransactionId = uuid(row.attempt_id);
      if (returnedTransactionId !== transactionId) {
        throw new AuthenticationPersistenceError();
      }
      return Object.freeze({
        transactionId: returnedTransactionId,
        expiresAt: finiteDate(row.expires_at),
      });
    } catch (error) {
      if (error instanceof AuthenticationPersistenceError) throw error;
      throw new AuthenticationPersistenceError();
    }
  }

  async claimTransaction(
    request: ClaimAuthenticationTransactionRequest,
  ): Promise<ClaimAuthenticationTransactionResult> {
    try {
      const result = await this.postgres.query<ClaimRow>(
        `SELECT claimed.claim_outcome,
                claimed.claimed_flow,
                claimed.claimed_issuer,
                claimed.claimed_nonce_digest_version,
                claimed.claimed_nonce_digest
         FROM claim_authentication_login_attempt(
           $1::uuid, $2::smallint, $3::bytea, $4::smallint, $5::bytea, $6::uuid
         ) AS claimed
         LIMIT 2`,
        [
          uuid(request.transactionId),
          request.stateDigest.version,
          digestBytes(request.stateDigest),
          request.browserBindingDigest.version,
          digestBytes(request.browserBindingDigest),
          uuid(request.correlationId),
        ],
      );
      const row = oneRow(result.rows);
      if (row.claim_outcome === 'CLAIMED') {
        if (
          typeof row.claimed_issuer !== 'string' ||
          !validDigestVersion(row.claimed_nonce_digest_version) ||
          !Buffer.isBuffer(row.claimed_nonce_digest) ||
          row.claimed_nonce_digest.length !== 32
        ) {
          throw new AuthenticationPersistenceError();
        }
        return Object.freeze({
          status: 'claimed',
          flow: applicationFlow(row.claimed_flow),
          issuer: row.claimed_issuer,
          nonceDigest: {
            version: row.claimed_nonce_digest_version,
            value: row.claimed_nonce_digest.toString('hex'),
          },
        });
      }
      if (
        row.claimed_flow !== null ||
        row.claimed_issuer !== null ||
        row.claimed_nonce_digest_version !== null ||
        row.claimed_nonce_digest !== null
      ) {
        throw new AuthenticationPersistenceError();
      }
      if (row.claim_outcome === 'EXPIRED') return { status: 'expired' };
      if (row.claim_outcome === 'INVALID') return { status: 'invalid' };
      if (row.claim_outcome === 'REPLAYED') return { status: 'replayed' };
      throw new AuthenticationPersistenceError();
    } catch (error) {
      if (error instanceof AuthenticationPersistenceError) throw error;
      throw new AuthenticationPersistenceError();
    }
  }

  async rejectClaimedTransaction(
    request: RejectClaimedAuthenticationTransactionRequest,
  ): Promise<RejectClaimedAuthenticationTransactionResult> {
    try {
      const result = await this.postgres.query<RejectClaimedRow>(
        `SELECT rejected.rejection_outcome
         FROM reject_claimed_authentication_login_attempt(
           $1::uuid, $2::text, $3::uuid
         ) AS rejected
         LIMIT 2`,
        [
          uuid(request.transactionId),
          databaseClaimedRejectionReason(request.reason),
          uuid(request.correlationId),
        ],
      );
      const row = oneRow(result.rows);
      if (row.rejection_outcome === 'REJECTED') return { status: 'rejected' };
      if (row.rejection_outcome === 'REPLAYED') return { status: 'replayed' };
      if (row.rejection_outcome === 'INVALID') return { status: 'invalid' };
      throw new AuthenticationPersistenceError();
    } catch (error) {
      if (error instanceof AuthenticationPersistenceError) throw error;
      throw new AuthenticationPersistenceError();
    }
  }

  async completeLogin(
    request: CompleteAuthenticationLoginRequest,
  ): Promise<CompleteAuthenticationLoginResult> {
    if ((request.flow === 'registration') !== (request.registration !== undefined)) {
      throw new AuthenticationPersistenceError();
    }
    const registration = request.flow === 'registration' ? request.registration : undefined;
    try {
      const subjectDigests = digestCandidateParameters(request.subjectDigests);
      const proposedSessionFamilyId = uuid(request.proposedSessionFamilyId);
      const proposedCredentialId = uuid(request.proposedCredentialId);
      const result = await this.postgres.query<CompleteRow>(
        `SELECT completed.login_outcome,
                completed.account_id,
                completed.session_family_id,
                completed.credential_id,
                completed.idle_expires_at,
                completed.absolute_expires_at
         FROM complete_auth_login_keyring(
           $1::uuid, $2::text, $3::text, $4::smallint, $5::bytea,
           $6::smallint[], $7::text[], $8::uuid, $9::uuid, $10::uuid, $11::uuid,
           $12::smallint, $13::bytea, $14::smallint, $15::bytea,
           $16::integer, $17::integer, $18::text, $19::text, $20::text, $21::uuid
         ) AS completed
         LIMIT 2`,
        [
          uuid(request.transactionId),
          request.identity.providerKey,
          request.identity.issuer,
          request.nonceDigest.version,
          digestBytes(request.nonceDigest),
          subjectDigests.versions,
          subjectDigests.values,
          parseAccountId(request.proposedAccountId),
          uuid(request.proposedIdentityId),
          proposedSessionFamilyId,
          proposedCredentialId,
          request.credentialDigest.version,
          digestBytes(request.credentialDigest),
          request.csrfDigest.version,
          digestBytes(request.csrfDigest),
          request.idleTtlSeconds,
          request.absoluteTtlSeconds,
          registration?.contactEmail ?? null,
          registration?.contactPhone ?? null,
          registration?.declaredResidencyCountryCode ?? null,
          uuid(request.correlationId),
        ],
      );
      const row = oneRow(result.rows);
      if (row.login_outcome === 'REJECTED') {
        if (
          row.account_id !== null ||
          row.session_family_id !== null ||
          row.credential_id !== null ||
          row.idle_expires_at !== null ||
          row.absolute_expires_at !== null
        ) {
          throw new AuthenticationPersistenceError();
        }
        return { status: 'rejected' };
      }
      if (
        row.login_outcome !== 'AUTHENTICATED' ||
        row.account_id === null ||
        row.session_family_id === null ||
        row.credential_id === null ||
        row.idle_expires_at === null ||
        row.absolute_expires_at === null
      ) {
        throw new AuthenticationPersistenceError();
      }
      const sessionFamilyId = uuid(row.session_family_id);
      const credentialId = uuid(row.credential_id);
      if (sessionFamilyId !== proposedSessionFamilyId || credentialId !== proposedCredentialId) {
        throw new AuthenticationPersistenceError();
      }
      return Object.freeze({
        status: 'authenticated',
        accountId: parseAccountId(row.account_id),
        sessionFamilyId,
        credentialId,
        idleExpiresAt: finiteDate(row.idle_expires_at),
        absoluteExpiresAt: finiteDate(row.absolute_expires_at),
      });
    } catch (error) {
      if (error instanceof AuthenticationPersistenceError) throw error;
      throw new AuthenticationPersistenceError();
    }
  }

  async resolveSession(
    request: ResolveAuthenticationSessionRequest,
  ): Promise<ResolveAuthenticationSessionResult> {
    try {
      const credentials = digestCandidateParameters(request.credentialDigests);
      const csrf = request.csrf.required
        ? digestCandidateParameters(request.csrf.digests)
        : undefined;
      const result = await this.postgres.query<ResolveRow>(
        `SELECT resolved.authentication_outcome,
                resolved.account_id,
                resolved.session_family_id
         FROM resolve_auth_session_keyring(
           $1::uuid, $2::smallint[], $3::text[], $4::boolean,
           $5::smallint[], $6::text[], $7::uuid
         ) AS resolved
         LIMIT 2`,
        [
          uuid(request.credentialId),
          credentials.versions,
          credentials.values,
          request.csrf.required,
          csrf?.versions ?? null,
          csrf?.values ?? null,
          uuid(request.correlationId),
        ],
      );
      const row = oneRow(result.rows);
      if (row.authentication_outcome === 'AUTHENTICATED') {
        if (row.account_id === null || row.session_family_id === null) {
          throw new AuthenticationPersistenceError();
        }
        return Object.freeze({
          status: 'authenticated',
          accountId: parseAccountId(row.account_id),
          sessionFamilyId: uuid(row.session_family_id),
        });
      }
      if (row.account_id !== null || row.session_family_id !== null) {
        throw new AuthenticationPersistenceError();
      }
      if (row.authentication_outcome === 'EXPIRED') return { status: 'expired' };
      if (row.authentication_outcome === 'REPLAYED') return { status: 'replayed' };
      if (row.authentication_outcome === 'INVALID') return { status: 'invalid' };
      throw new AuthenticationPersistenceError();
    } catch (error) {
      if (error instanceof AuthenticationPersistenceError) throw error;
      throw new AuthenticationPersistenceError();
    }
  }

  async rotateSession(
    request: RotateAuthenticationSessionRequest,
  ): Promise<RotateAuthenticationSessionResult> {
    try {
      const credentials = digestCandidateParameters(request.credentialDigests);
      const successorCredentialId = uuid(request.successorCredentialId);
      const result = await this.postgres.query<RotateRow>(
        `SELECT rotated.rotation_outcome, rotated.credential_id, rotated.expires_at
         FROM rotate_auth_session_keyring(
           $1::uuid, $2::smallint[], $3::text[], $4::uuid, $5::smallint,
           $6::bytea, $7::smallint, $8::bytea, $9::uuid
         ) AS rotated
         LIMIT 2`,
        [
          uuid(request.credentialId),
          credentials.versions,
          credentials.values,
          successorCredentialId,
          request.successorCredentialDigest.version,
          digestBytes(request.successorCredentialDigest),
          request.successorCsrfDigest.version,
          digestBytes(request.successorCsrfDigest),
          uuid(request.correlationId),
        ],
      );
      const row = oneRow(result.rows);
      if (row.rotation_outcome === 'ROTATED') {
        if (row.credential_id === null || row.expires_at === null) {
          throw new AuthenticationPersistenceError();
        }
        const credentialId = uuid(row.credential_id);
        if (credentialId !== successorCredentialId) {
          throw new AuthenticationPersistenceError();
        }
        return Object.freeze({
          status: 'rotated',
          credentialId,
          expiresAt: finiteDate(row.expires_at),
        });
      }
      if (row.credential_id !== null || row.expires_at !== null) {
        throw new AuthenticationPersistenceError();
      }
      if (row.rotation_outcome === 'INVALID') return { status: 'invalid' };
      if (row.rotation_outcome === 'REPLAYED') return { status: 'replayed' };
      throw new AuthenticationPersistenceError();
    } catch (error) {
      if (error instanceof AuthenticationPersistenceError) throw error;
      throw new AuthenticationPersistenceError();
    }
  }

  async revokeSession(
    request: RevokeAuthenticationSessionRequest,
  ): Promise<RevokeAuthenticationSessionResult> {
    try {
      const credentials = digestCandidateParameters(request.credentialDigests);
      const result = await this.postgres.query<RevokeRow>(
        `SELECT revoked.revocation_outcome
         FROM revoke_auth_session_keyring(
           $1::uuid, $2::smallint[], $3::text[], $4::uuid
         ) AS revoked
         LIMIT 2`,
        [
          uuid(request.credentialId),
          credentials.versions,
          credentials.values,
          uuid(request.correlationId),
        ],
      );
      const row = oneRow(result.rows);
      if (row.revocation_outcome === 'REVOKED') return { status: 'revoked' };
      if (row.revocation_outcome === 'INVALID') return { status: 'invalid' };
      if (row.revocation_outcome === 'REPLAYED') return { status: 'replayed' };
      throw new AuthenticationPersistenceError();
    } catch (error) {
      if (error instanceof AuthenticationPersistenceError) throw error;
      throw new AuthenticationPersistenceError();
    }
  }
}
