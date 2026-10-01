import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

import { Inject, Injectable } from '@nestjs/common';

import {
  normalizeContactEmail,
  normalizeDeclaredResidencyCountryCode,
  parseAccountId,
  type ProvisionAccountProfileInput,
} from '../../accounts/domain/account-profile';
import { PostgresService } from '../../infrastructure/database/postgres.service';
import { parseOidcProviderKey, parseOidcSubject } from '../domain/authentication';
import { normalizePasswordlessPhone } from '../domain/passwordless-phone';
import { formatAuthenticationSessionCookie } from '../http/authentication-session-cookie';
import {
  AUTHENTICATION_CONFIG,
  type RuntimeAuthenticationConfig,
} from '../infrastructure/config/authentication-config.provider';
import type { PasswordlessAuthenticationConfig } from '../infrastructure/config/authentication.config';
import {
  activeAuthenticationHmacKey,
  createKeyedAuthenticationDigest,
  createOidcIdentityDigest,
  generateOpaqueAuthenticationSecret,
} from '../infrastructure/crypto/authentication-crypto';
import {
  PasswordlessDelivery,
  type PasswordlessChannel,
  type PasswordlessMessage,
} from '../infrastructure/passwordless-delivery';
import { isSmsVerificationSid } from '../infrastructure/twilio-verify';
import {
  AuthenticationRateLimitedError,
  AuthenticationRejectedError,
  AuthenticationUnavailableError,
} from './authentication.errors';
import type { CompletedAuthentication } from './authentication.service';
import {
  AUTHENTICATION_RATE_LIMITER,
  type AuthenticationRateLimiterPort,
} from './ports/authentication-rate-limiter.port';
import {
  AUTHENTICATION_REPOSITORY,
  type AuthenticationRepositoryPort,
} from './ports/authentication-repository.port';

export const PASSWORDLESS_COOKIE = '__Host-cl_otp';
export const PASSWORDLESS_TTL_SECONDS = 600;

interface Challenge {
  id: string;
  destination: string;
  channel: PasswordlessChannel;
  code_key_version: number | null;
  code_digest: Buffer | null;
  sms_verification_sid: string | null;
  failed_attempts: number;
  verified_at: Date | null;
}

export type PasswordlessCompletion =
  | {
      readonly status: 'profile_required';
      readonly channel: PasswordlessChannel;
      readonly contactEmail?: string;
    }
  | { readonly status: 'authenticated'; readonly session: CompletedAuthentication };

function bindingProof(cookie: unknown): { id: string; digest: Buffer } {
  if (
    typeof cookie !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/u.test(
      cookie,
    )
  ) {
    throw new AuthenticationRejectedError();
  }
  return { id: cookie.slice(0, 36), digest: createHash('sha256').update(cookie).digest() };
}

export function passwordlessDestination(value: unknown): {
  channel: PasswordlessChannel;
  destination: string;
} {
  if (typeof value !== 'string' || value.length > 254) throw new AuthenticationRejectedError();
  try {
    const normalized = value.trim();
    if (normalized.includes('@')) {
      return { channel: 'email', destination: normalizeContactEmail(normalized.toLowerCase()) };
    }
    return { channel: 'sms', destination: normalizePasswordlessPhone(normalized) };
  } catch {
    throw new AuthenticationRejectedError();
  }
}

@Injectable()
export class PasswordlessService {
  constructor(
    private readonly postgres: PostgresService,
    private readonly delivery: PasswordlessDelivery,
    @Inject(AUTHENTICATION_CONFIG) private readonly runtimeConfig: RuntimeAuthenticationConfig,
    @Inject(AUTHENTICATION_REPOSITORY) private readonly repository: AuthenticationRepositoryPort,
    @Inject(AUTHENTICATION_RATE_LIMITER) private readonly limiter: AuthenticationRateLimiterPort,
  ) {}

  options(): { mode: RuntimeAuthenticationConfig['mode']; email: boolean; sms: boolean } {
    return {
      mode: this.runtimeConfig.mode,
      email: this.runtimeConfig.mode === 'passwordless' && this.delivery.available('email'),
      sms: this.runtimeConfig.mode === 'passwordless' && this.delivery.available('sms'),
    };
  }

  async start(
    identifier: unknown,
    sourceAddress: string,
  ): Promise<{ cookie: string; channel: PasswordlessChannel }> {
    const config = this.config();
    const recipient = passwordlessDestination(identifier);
    if (!isIP(sourceAddress)) throw new AuthenticationRejectedError();
    if (!this.delivery.available(recipient.channel)) throw new AuthenticationUnavailableError();
    await this.admit(`otp:start:ip:${sourceAddress}`, 10, 600);
    await this.admit(`otp:start:recipient:${recipient.channel}:${recipient.destination}`, 3, 600);
    await this.admit(
      `otp:start:global:${recipient.channel}`,
      recipient.channel === 'sms' ? 30 : 300,
      3600,
    );
    const id = randomUUID();
    const cookie = `${id}.${randomBytes(32).toString('base64url')}`;
    const proof = bindingProof(cookie);
    const message: PasswordlessMessage =
      recipient.channel === 'email'
        ? {
            id,
            destination: recipient.destination,
            channel: 'email',
            code: String(randomInt(0, 1_000_000)).padStart(6, '0'),
          }
        : { id, destination: recipient.destination, channel: 'sms' };
    const key =
      message.channel === 'email' ? activeAuthenticationHmacKey(config.sessionHmacKeys) : null;
    const digest =
      key && message.channel === 'email'
        ? Buffer.from(
            createKeyedAuthenticationDigest('otp-code', key, `${id}:${message.code}`),
            'hex',
          )
        : null;
    try {
      // Expiry is checked on every read; bounded cleanup removes old recipient data.
      await this.postgres.query(`DELETE FROM passwordless_challenges WHERE id IN (
        SELECT id FROM passwordless_challenges WHERE expires_at < clock_timestamp()
        ORDER BY expires_at LIMIT 1000
      )`);
      await this.postgres.query(
        `INSERT INTO passwordless_challenges (id, channel, destination, code_key_version, code_digest, browser_digest)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, recipient.channel, recipient.destination, key?.version ?? null, digest, proof.digest],
      );
      const verification = await this.delivery.send(message);
      if (recipient.channel === 'sms' && !isSmsVerificationSid(verification?.verificationSid)) {
        throw new AuthenticationUnavailableError();
      }
      await this.postgres.query(
        'UPDATE passwordless_challenges SET sent = true, sms_verification_sid = $2 WHERE id = $1',
        [id, recipient.channel === 'sms' ? verification!.verificationSid : null],
      );
    } catch {
      // A timed-out provider may still deliver. Its code must never become usable.
      await this.postgres
        .query('DELETE FROM passwordless_challenges WHERE id = $1', [id])
        .catch(() => undefined);
      throw new AuthenticationUnavailableError();
    }
    return { cookie, channel: recipient.channel };
  }

  async verify(
    cookie: unknown,
    code: unknown,
    sourceAddress: string,
  ): Promise<PasswordlessCompletion> {
    this.config();
    const proof = bindingProof(cookie);
    if (typeof code !== 'string' || !/^\d{6}$/u.test(code) || !isIP(sourceAddress)) {
      throw new AuthenticationRejectedError();
    }
    await this.admit(`otp:verify:ip:${sourceAddress}`, 30, 600);
    const verified = await this.postgres.withTransaction(
      async () => {
        const row = await this.lockChallenge(proof);
        if (!row || row.verified_at || row.failed_attempts >= 5) return false;
        let approved: boolean;
        if (row.channel === 'sms') {
          if (!isSmsVerificationSid(row.sms_verification_sid)) return false;
          try {
            approved = await this.delivery.verifySms({
              verificationSid: row.sms_verification_sid,
              destination: row.destination,
              code,
            });
          } catch {
            throw new AuthenticationUnavailableError();
          }
        } else {
          const key = this.config().sessionHmacKeys.keys.find(
            (candidate) => candidate.version === row.code_key_version,
          );
          if (!key || !row.code_digest) return false;
          const actual = Buffer.from(
            createKeyedAuthenticationDigest('otp-code', key, `${row.id}:${code}`),
            'hex',
          );
          approved = timingSafeEqual(actual, row.code_digest);
        }
        if (!approved) {
          await this.postgres.query(
            'UPDATE passwordless_challenges SET failed_attempts = failed_attempts + 1 WHERE id = $1',
            [row.id],
          );
          return false; // Commit the failed attempt; throwing here would roll it back.
        }
        await this.postgres.query(
          'UPDATE passwordless_challenges SET verified_at = clock_timestamp() WHERE id = $1',
          [row.id],
        );
        return true;
      },
      { maxRetries: 0 },
    ); // A successful Verify check consumes the remote code; never retry it.
    if (!verified) throw new AuthenticationRejectedError();
    return this.complete(cookie);
  }

  async complete(
    cookie: unknown,
    profile?: { contactEmail?: unknown; declaredResidencyCountryCode?: unknown },
  ): Promise<PasswordlessCompletion> {
    const config = this.config();
    const proof = bindingProof(cookie);
    // Lock, identity mapping, account provisioning, session issuance and challenge
    // consumption share one transaction, including concurrent completion requests.
    return this.postgres.withTransaction(async () => {
      const row = await this.lockChallenge(proof);
      if (!row?.verified_at) throw new AuthenticationRejectedError();
      const providerKey = parseOidcProviderKey(`passwordless_${row.channel}`);
      const issuer = `${config.publicOrigin}/passwordless`;
      const subject = parseOidcSubject(row.destination);
      const subjectDigests = config.identityHmacKeys.keys.map((key) => ({
        version: key.version,
        value: createOidcIdentityDigest(key, providerKey, issuer, subject),
      }));
      const mapped = await this.postgres.query<{ present: boolean }>(
        'SELECT passwordless_identity_exists($1, $2, $3::smallint[], $4::text[]) AS present',
        [
          issuer,
          providerKey,
          subjectDigests.map((item) => item.version),
          subjectDigests.map((item) => item.value),
        ],
      );
      let registration: ProvisionAccountProfileInput | undefined;
      if (!mapped.rows[0]?.present) {
        if (!profile)
          return {
            status: 'profile_required',
            channel: row.channel,
            ...(row.channel === 'email' ? { contactEmail: row.destination } : {}),
          };
        try {
          registration = {
            contactEmail:
              row.channel === 'email'
                ? row.destination
                : normalizeContactEmail(profile.contactEmail),
            contactPhone: row.channel === 'sms' ? row.destination : null,
            declaredResidencyCountryCode: normalizeDeclaredResidencyCountryCode(
              profile.declaredResidencyCountryCode,
            ),
          };
        } catch {
          throw new AuthenticationRejectedError();
        }
      }
      // The existing persistence adapter also supports native verified identities.
      // No authorization URL, provider callback, token exchange or OIDC claim is used.
      const transactionId = randomUUID();
      const correlationId = randomUUID();
      const stateDigest = { version: 1, value: randomBytes(32).toString('hex') };
      const nonceDigest = { version: 1, value: randomBytes(32).toString('hex') };
      const browserBindingDigest = { version: 1, value: proof.digest.toString('hex') };
      const flow = registration ? 'registration' : 'login';
      await this.repository.beginTransaction({
        transactionId,
        flow,
        issuer,
        stateDigest,
        nonceDigest,
        browserBindingDigest,
        ttlSeconds: 60,
        correlationId,
      });
      const claimed = await this.repository.claimTransaction({
        transactionId,
        stateDigest,
        browserBindingDigest,
        correlationId,
      });
      if (claimed.status !== 'claimed') throw new AuthenticationRejectedError();
      const credentialId = randomUUID();
      const sessionSecret = generateOpaqueAuthenticationSecret('session');
      const csrfToken = generateOpaqueAuthenticationSecret('csrf');
      const now = Math.floor(Date.now() / 1000);
      const base = {
        transactionId,
        identity: {
          providerKey,
          issuer,
          subject,
          issuedAtEpochSeconds: now,
          expiresAtEpochSeconds: now + 60,
        },
        nonceDigest,
        subjectDigests,
        proposedAccountId: parseAccountId(randomUUID()),
        proposedIdentityId: randomUUID(),
        proposedSessionFamilyId: randomUUID(),
        proposedCredentialId: credentialId,
        credentialDigest: {
          version: config.sessionHmacKeys.activeWriteVersion,
          value: createKeyedAuthenticationDigest(
            'session',
            activeAuthenticationHmacKey(config.sessionHmacKeys),
            sessionSecret,
          ),
        },
        csrfDigest: {
          version: config.csrfHmacKeys.activeWriteVersion,
          value: createKeyedAuthenticationDigest(
            'csrf',
            activeAuthenticationHmacKey(config.csrfHmacKeys),
            csrfToken,
          ),
        },
        idleTtlSeconds: config.sessionIdleTtlSeconds,
        absoluteTtlSeconds: config.sessionAbsoluteTtlSeconds,
        correlationId,
      };
      const completed = await this.repository.completeLogin(
        registration ? { ...base, flow: 'registration', registration } : { ...base, flow: 'login' },
      );
      if (completed.status !== 'authenticated' || completed.credentialId !== credentialId)
        throw new AuthenticationRejectedError();
      await this.postgres.query(
        'UPDATE passwordless_challenges SET consumed_at = clock_timestamp() WHERE id = $1',
        [row.id],
      );
      return {
        status: 'authenticated',
        session: {
          accountId: completed.accountId,
          sessionCookie: formatAuthenticationSessionCookie(credentialId, sessionSecret),
          csrfToken,
          returnPath: '/account',
          idleExpiresAt: completed.idleExpiresAt,
          absoluteExpiresAt: completed.absoluteExpiresAt,
        },
      };
    });
  }

  private async lockChallenge(proof: {
    id: string;
    digest: Buffer;
  }): Promise<Challenge | undefined> {
    const result = await this.postgres.query<Challenge>(
      `SELECT id, channel, destination, code_key_version, code_digest, sms_verification_sid, failed_attempts, verified_at
       FROM passwordless_challenges WHERE id = $1 AND browser_digest = $2
       AND sent = true AND consumed_at IS NULL AND expires_at > clock_timestamp() FOR UPDATE`,
      [proof.id, proof.digest],
    );
    return result.rows[0];
  }

  private async admit(subject: string, limitCount: number, windowSeconds: number): Promise<void> {
    const config = this.config();
    const result = await this.limiter.admit({
      scope: 'LOGIN_START',
      windowSeconds,
      limitCount,
      correlationId: randomUUID(),
      subjectDigests: config.sessionHmacKeys.keys.map((key) => ({
        version: key.version,
        value: createKeyedAuthenticationDigest('rate-limit', key, subject),
      })),
    });
    if (!result.admitted) throw new AuthenticationRateLimitedError(result.retryAfterSeconds);
  }

  private config(): PasswordlessAuthenticationConfig {
    if (this.runtimeConfig.mode !== 'passwordless') throw new AuthenticationUnavailableError();
    return this.runtimeConfig;
  }
}
