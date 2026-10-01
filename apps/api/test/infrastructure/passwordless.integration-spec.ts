import { randomBytes, randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';

import { AuthenticationService } from '../../src/authentication/application/authentication.service';
import { PasswordlessService } from '../../src/authentication/application/passwordless.service';
import {
  AuthenticationRejectedError,
  AuthenticationUnavailableError,
} from '../../src/authentication/application/authentication.errors';
import { AuthenticationController } from '../../src/authentication/http/authentication.controller';
import { PasswordlessController } from '../../src/authentication/http/passwordless.controller';
import { AuthenticationClientAddressResolver } from '../../src/authentication/http/authentication-client-address';
import { AUTHENTICATION_CONFIG } from '../../src/authentication/infrastructure/config/authentication-config.provider';
import {
  loadAuthenticationConfig,
  type PasswordlessAuthenticationConfig,
} from '../../src/authentication/infrastructure/config/authentication.config';
import type {
  PasswordlessDelivery,
  PasswordlessMessage,
} from '../../src/authentication/infrastructure/passwordless-delivery';
import { PostgresAuthenticationRepository } from '../../src/authentication/infrastructure/postgres/postgres-authentication.repository';
import { PostgresAuthenticationRateLimiter } from '../../src/authentication/infrastructure/postgres/postgres-authentication-rate-limiter';
import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { PostgresService } from '../../src/infrastructure/database/postgres.service';
import { postgresStartupOptions } from '../../src/infrastructure/database/postgres-startup-options';
import { bootstrapRailwayDatabase } from '../../src/infrastructure/database/railway-database-bootstrap';
import { RAILWAY_DATABASE_MIGRATION_LIST } from '../../src/infrastructure/database/railway-migrations';
import { createPasswordlessChallengesMigration } from '../../src/infrastructure/database/migrations/9002-create-passwordless-challenges.migration';
import { addTwilioVerifyChallengesMigration } from '../../src/infrastructure/database/migrations/9003-add-twilio-verify-challenges.migration';

const adminUrl = process.env.RAILWAY_TEST_DATABASE_URL;
const enabled = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1' && adminUrl;
const describeWithPostgres = enabled ? describe : describe.skip;
const ORIGIN = 'https://bonsai.example.test';

describeWithPostgres('Postgres passwordless sign-in', () => {
  const database = `otp_${randomBytes(8).toString('hex')}`;
  const apiPassword = randomBytes(32).toString('base64url');
  let owner: Pool;
  let api: Pool;
  let service: PasswordlessService;
  let sessions: AuthenticationService;
  let app: INestApplication;
  let config: PasswordlessAuthenticationConfig;
  const messages: PasswordlessMessage[] = [];
  const smsCodes = new Map<string, string>();
  const remoteVerifications = new Map<
    string,
    { destination: string; code: string; used: boolean }
  >();
  const delivery: PasswordlessDelivery = {
    available: jest.fn(() => true),
    send: jest.fn(async (message: PasswordlessMessage) => {
      messages.push(message);
      if (message.channel === 'email') return null;
      const verificationSid = `VE${randomBytes(16).toString('hex')}`;
      const code = '654321';
      smsCodes.set(message.id, code);
      remoteVerifications.set(verificationSid, {
        destination: message.destination,
        code,
        used: false,
      });
      return { verificationSid };
    }),
    verifySms: jest.fn(async ({ verificationSid, destination, code }) => {
      const verification = remoteVerifications.get(verificationSid);
      if (
        !verification ||
        verification.used ||
        verification.destination !== destination ||
        verification.code !== code
      )
        return false;
      verification.used = true;
      return true;
    }),
  };
  let ipCounter = 10;
  const ip = (): string => `198.51.100.${ipCounter++}`;
  let phoneCounter = 124;
  const phone = (): string => `+12025550${phoneCounter++}`;

  function lastCode(): string {
    const message = messages[messages.length - 1]!;
    return message.channel === 'email' ? message.code : smsCodes.get(message.id)!;
  }

  beforeAll(async () => {
    const base = new URL(adminUrl!);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
      throw new Error('Tests require loopback Postgres');
    const cluster = new Pool({ connectionString: base.href });
    try {
      await cluster.query(`CREATE DATABASE "${database}"`);
    } finally {
      await cluster.end();
    }
    base.pathname = `/${database}`;
    owner = new Pool({ connectionString: base.href });
    await bootstrapRailwayDatabase(owner, {
      workload: 'api',
      username: 'crypto_api_login_railway',
      password: apiPassword,
    });
    const migrations = new Pool({
      connectionString: base.href,
      options: postgresStartupOptions('crypto_schema_owner'),
    });
    const previousProfile = process.env.RAILWAY_SIMPLE_PROFILE;
    try {
      // Match the deployed Railway profile. Older migration fingerprints depend
      // on PostgreSQL's version; explicitly verify the new schema below.
      process.env.RAILWAY_SIMPLE_PROFILE = '1';
      await new MigrationRunner(migrations, RAILWAY_DATABASE_MIGRATION_LIST).up();
      await expect(
        new MigrationRunner(migrations, RAILWAY_DATABASE_MIGRATION_LIST).up(),
      ).resolves.toEqual([]);
      expect(
        (await migrations.query(createPasswordlessChallengesMigration.verifySql!)).rows,
      ).toEqual([{ valid: true }]);
      expect((await migrations.query(addTwilioVerifyChallengesMigration.verifySql!)).rows).toEqual([
        { valid: true },
      ]);
    } finally {
      if (previousProfile === undefined) delete process.env.RAILWAY_SIMPLE_PROFILE;
      else process.env.RAILWAY_SIMPLE_PROFILE = previousProfile;
      await migrations.end();
    }
    base.username = 'crypto_api_login_railway';
    base.password = apiPassword;
    api = new Pool({
      connectionString: base.href,
      options: postgresStartupOptions('crypto_api_runtime'),
    });
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      DEPLOYMENT_TARGET: 'railway',
      AUTH_MODE: 'passwordless',
      AUTH_PUBLIC_ORIGIN: ORIGIN,
      AUTH_PREAUTH_TTL_SECONDS: '600',
      AUTH_SESSION_IDLE_TTL_SECONDS: '3600',
      AUTH_SESSION_ABSOLUTE_TTL_SECONDS: '86400',
      AUTH_PREAUTH_SEAL_KEY_ID: 'seal_v1',
      AUTH_PREAUTH_SEAL_KEY: randomBytes(32).toString('base64url'),
      AUTH_IDENTITY_HMAC_KEY_ID: 'identity_v1',
      AUTH_IDENTITY_HMAC_KEY: randomBytes(32).toString('base64url'),
      AUTH_SESSION_HMAC_KEY_ID: 'session_v1',
      AUTH_SESSION_HMAC_KEY: randomBytes(32).toString('base64url'),
      AUTH_CSRF_HMAC_KEY_ID: 'csrf_v1',
      AUTH_CSRF_HMAC_KEY: randomBytes(32).toString('base64url'),
    };
    config = loadAuthenticationConfig(env) as PasswordlessAuthenticationConfig;
    const postgres = new PostgresService(api);
    const repository = new PostgresAuthenticationRepository(postgres);
    const limiter = new PostgresAuthenticationRateLimiter(postgres);
    service = new PasswordlessService(postgres, delivery, config, repository, limiter);
    sessions = new AuthenticationService(config, repository, limiter, null);
    const module = await Test.createTestingModule({
      controllers: [PasswordlessController, AuthenticationController],
      providers: [
        { provide: PasswordlessService, useValue: service },
        { provide: AuthenticationService, useValue: sessions },
        {
          provide: AuthenticationClientAddressResolver,
          useValue: new AuthenticationClientAddressResolver({ mode: 'direct' }),
        },
        { provide: AUTHENTICATION_CONFIG, useValue: config },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await api?.end();
    await owner?.end();
    if (adminUrl) {
      const cluster = new Pool({ connectionString: adminUrl });
      try {
        await cluster.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      } finally {
        await cluster.end();
      }
    }
  });

  async function start(
    identifier = `${randomUUID()}@example.test`,
  ): Promise<{ cookie: string; code: string; identifier: string }> {
    const result = await service.start(identifier, ip());
    return { cookie: result.cookie, code: lastCode(), identifier };
  }

  it('upgrades and rolls back SMS challenges while preserving email challenges', async () => {
    const connection = await owner.connect();
    const emailId = randomUUID();
    const smsId = randomUUID();
    try {
      await connection.query('BEGIN');
      await connection.query(
        `INSERT INTO passwordless_challenges (id, channel, destination, code_key_version, code_digest, browser_digest)
         VALUES ($1, 'email', 'migration@example.test', 1, $2, $3)`,
        [emailId, randomBytes(32), randomBytes(32)],
      );
      await connection.query(
        `INSERT INTO passwordless_challenges (id, channel, destination, sms_verification_sid, browser_digest, sent)
         VALUES ($1, 'sms', '+12025550123', $2, $3, true)`,
        [smsId, `VE${randomBytes(16).toString('hex')}`, randomBytes(32)],
      );
      await connection.query(addTwilioVerifyChallengesMigration.downSql);
      expect(
        (
          await connection.query(
            'SELECT id FROM passwordless_challenges WHERE id = ANY($1::uuid[])',
            [[emailId, smsId]],
          )
        ).rows,
      ).toEqual([{ id: emailId }]);
      await connection.query(
        `INSERT INTO passwordless_challenges (id, channel, destination, code_key_version, code_digest, browser_digest, sent)
         VALUES ($1, 'sms', '+12025550123', 1, $2, $3, true)`,
        [smsId, randomBytes(32), randomBytes(32)],
      );
      await connection.query(addTwilioVerifyChallengesMigration.upSql);
      expect(
        (
          await connection.query(
            'SELECT id FROM passwordless_challenges WHERE id = ANY($1::uuid[])',
            [[emailId, smsId]],
          )
        ).rows,
      ).toEqual([{ id: emailId }]);
      expect((await connection.query(addTwilioVerifyChallengesMigration.verifySql!)).rows).toEqual([
        { valid: true },
      ]);
    } finally {
      await connection.query('ROLLBACK');
      connection.release();
    }
  });

  it('creates an email account only after verification, then signs the same account in again', async () => {
    const first = await start();
    await expect(
      service.complete(first.cookie, { declaredResidencyCountryCode: 'US' }),
    ).rejects.toBeInstanceOf(AuthenticationRejectedError);
    expect(await service.verify(first.cookie, first.code, ip())).toEqual({
      status: 'profile_required',
      channel: 'email',
      contactEmail: first.identifier,
    });
    const created = await service.complete(first.cookie, {
      declaredResidencyCountryCode: 'US',
      contactEmail: 'attacker@example.test',
    });
    expect(created.status).toBe('authenticated');
    if (created.status !== 'authenticated') throw new Error('Missing session');
    const profile = await api.query<{ contact_email: string }>(
      'SELECT contact_email FROM account_profiles WHERE account_id = $1',
      [created.session.accountId],
    );
    expect(profile.rows[0]?.contact_email).toBe(first.identifier);
    expect(
      await sessions.resolve({
        method: 'GET',
        headers: { cookie: `__Host-cl_session=${created.session.sessionCookie}` },
      }),
    ).toEqual({ accountId: created.session.accountId });
    await expect(service.complete(first.cookie)).rejects.toBeInstanceOf(
      AuthenticationRejectedError,
    );
    const next = await start(first.identifier);
    const signedIn = await service.verify(next.cookie, next.code, ip());
    expect(signedIn.status === 'authenticated' && signedIn.session.accountId).toBe(
      created.session.accountId,
    );
  });

  it('requires a verified phone and profile for first SMS sign-in', async () => {
    const attempt = await start('(202) 555-0123');
    const stored = (
      await api.query(
        'SELECT code_digest, code_key_version, sms_verification_sid FROM passwordless_challenges WHERE id = $1',
        [attempt.cookie.slice(0, 36)],
      )
    ).rows[0];
    expect(stored).toEqual({
      code_digest: null,
      code_key_version: null,
      sms_verification_sid: expect.stringMatching(/^VE[0-9a-f]{32}$/u),
    });
    expect(messages[messages.length - 1]).not.toHaveProperty('code');
    expect(await service.verify(attempt.cookie, attempt.code, ip())).toEqual({
      status: 'profile_required',
      channel: 'sms',
    });
    await expect(
      service.complete(attempt.cookie, { declaredResidencyCountryCode: 'US' }),
    ).rejects.toBeInstanceOf(AuthenticationRejectedError);
    const result = await service.complete(attempt.cookie, {
      contactEmail: 'phone-contact@example.test',
      declaredResidencyCountryCode: 'CA',
    });
    expect(result.status).toBe('authenticated');
    const next = await start('+12025550123');
    const signedIn = await service.verify(next.cookie, next.code, ip());
    expect(signedIn.status === 'authenticated' && signedIn.session.accountId).toBe(
      result.status === 'authenticated' && result.session.accountId,
    );
  });

  it('rejects unsupported phone regions before sending or storing a challenge', async () => {
    const count = messages.length;
    for (const identifier of [
      '+14165550123',
      '+12425550123',
      '+442079460123',
      '2025550123 ext 7',
    ]) {
      await expect(start(identifier)).rejects.toBeInstanceOf(AuthenticationRejectedError);
    }
    expect(messages).toHaveLength(count);
    expect(
      (
        await api.query('SELECT id FROM passwordless_challenges WHERE destination = $1', [
          '+14165550123',
        ])
      ).rows,
    ).toHaveLength(0);
  });

  it('checks browser binding and expiry before contacting Verify', async () => {
    const attempt = await start(phone());
    const calls = jest.mocked(delivery.verifySms).mock.calls.length;
    const wrongBrowser = `${attempt.cookie.slice(0, 36)}.${randomBytes(32).toString('base64url')}`;
    await expect(service.verify(wrongBrowser, attempt.code, ip())).rejects.toBeInstanceOf(
      AuthenticationRejectedError,
    );
    await owner.query(
      "UPDATE passwordless_challenges SET created_at = clock_timestamp() - interval '11 minutes', expires_at = clock_timestamp() - interval '1 minute' WHERE id = $1",
      [attempt.cookie.slice(0, 36)],
    );
    await expect(service.verify(attempt.cookie, attempt.code, ip())).rejects.toBeInstanceOf(
      AuthenticationRejectedError,
    );
    expect(delivery.verifySms).toHaveBeenCalledTimes(calls);
  });

  it('limits failed Verify checks to five and never approves locally', async () => {
    const attempt = await start(phone());
    const calls = jest.mocked(delivery.verifySms).mock.calls.length;
    for (let count = 0; count < 5; count++) {
      await expect(service.verify(attempt.cookie, '000000', ip())).rejects.toBeInstanceOf(
        AuthenticationRejectedError,
      );
    }
    await expect(service.verify(attempt.cookie, attempt.code, ip())).rejects.toBeInstanceOf(
      AuthenticationRejectedError,
    );
    expect(delivery.verifySms).toHaveBeenCalledTimes(calls + 5);
    const row = (
      await api.query(
        'SELECT failed_attempts, verified_at FROM passwordless_challenges WHERE id = $1',
        [attempt.cookie.slice(0, 36)],
      )
    ).rows[0];
    expect(row).toEqual({ failed_attempts: 5, verified_at: null });
  });

  it('keeps the challenge unverified after a provider outage without retrying the check', async () => {
    const attempt = await start(phone());
    const calls = jest.mocked(delivery.verifySms).mock.calls.length;
    jest.mocked(delivery.verifySms).mockRejectedValueOnce(new Error('private-provider-response'));
    await expect(service.verify(attempt.cookie, attempt.code, ip())).rejects.toBeInstanceOf(
      AuthenticationUnavailableError,
    );
    expect(delivery.verifySms).toHaveBeenCalledTimes(calls + 1);
    expect(
      (
        await api.query(
          'SELECT failed_attempts, verified_at FROM passwordless_challenges WHERE id = $1',
          [attempt.cookie.slice(0, 36)],
        )
      ).rows[0],
    ).toEqual({ failed_attempts: 0, verified_at: null });
    await expect(
      service.complete(attempt.cookie, {
        contactEmail: 'outage@example.test',
        declaredResidencyCountryCode: 'US',
      }),
    ).rejects.toBeInstanceOf(AuthenticationRejectedError);
    expect((await service.verify(attempt.cookie, attempt.code, ip())).status).toBe(
      'profile_required',
    );
  });

  it('serializes concurrent Verify checks and consumes the approved code once', async () => {
    const attempt = await start(phone());
    const calls = jest.mocked(delivery.verifySms).mock.calls.length;
    const results = await Promise.allSettled([
      service.verify(attempt.cookie, attempt.code, ip()),
      service.verify(attempt.cookie, attempt.code, ip()),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1);
    expect(delivery.verifySms).toHaveBeenCalledTimes(calls + 1);
    const completions = await Promise.allSettled([
      service.complete(attempt.cookie, {
        contactEmail: 'concurrent-phone@example.test',
        declaredResidencyCountryCode: 'US',
      }),
      service.complete(attempt.cookie, {
        contactEmail: 'concurrent-phone@example.test',
        declaredResidencyCountryCode: 'US',
      }),
    ]);
    expect(completions.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(completions.filter((item) => item.status === 'rejected')).toHaveLength(1);
    await expect(service.verify(attempt.cookie, attempt.code, ip())).rejects.toBeInstanceOf(
      AuthenticationRejectedError,
    );
    expect(delivery.verifySms).toHaveBeenCalledTimes(calls + 1);
  });

  it('requires a provider reference before an SMS challenge becomes usable', async () => {
    const identifier = phone();
    jest.mocked(delivery.send).mockResolvedValueOnce(null);
    await expect(start(identifier)).rejects.toBeInstanceOf(AuthenticationUnavailableError);
    expect(
      (
        await api.query('SELECT id FROM passwordless_challenges WHERE destination = $1', [
          identifier,
        ])
      ).rows,
    ).toHaveLength(0);
    await expect(
      api.query(
        `INSERT INTO passwordless_challenges (id, channel, destination, browser_digest, sent)
       VALUES ($1, 'sms', $2, $3, true)`,
        [randomUUID(), identifier, randomBytes(32)],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('stores a keyed digest, never the code, and rejects a different browser', async () => {
    const attempt = await start();
    const row = await api.query('SELECT * FROM passwordless_challenges WHERE id = $1', [
      attempt.cookie.slice(0, 36),
    ]);
    expect(row.rows[0].code_digest).toBeInstanceOf(Buffer);
    expect(Object.keys(row.rows[0])).not.toContain('code');
    const wrongBrowser = `${attempt.cookie.slice(0, 36)}.${randomBytes(32).toString('base64url')}`;
    await expect(service.verify(wrongBrowser, attempt.code, ip())).rejects.toBeInstanceOf(
      AuthenticationRejectedError,
    );
    expect((await service.verify(attempt.cookie, attempt.code, ip())).status).toBe(
      'profile_required',
    );
  });

  it('commits failed attempts and locks a code after five guesses', async () => {
    const attempt = await start();
    const wrongCode = attempt.code === '000000' ? '000001' : '000000';
    for (let count = 0; count < 5; count++)
      await expect(service.verify(attempt.cookie, wrongCode, ip())).rejects.toBeInstanceOf(
        AuthenticationRejectedError,
      );
    await expect(service.verify(attempt.cookie, attempt.code, ip())).rejects.toBeInstanceOf(
      AuthenticationRejectedError,
    );
    const row = await api.query(
      'SELECT failed_attempts FROM passwordless_challenges WHERE id = $1',
      [attempt.cookie.slice(0, 36)],
    );
    expect(row.rows[0].failed_attempts).toBe(5);
  });

  it('rejects expired and replayed codes', async () => {
    const expired = await start();
    await owner.query(
      "UPDATE passwordless_challenges SET created_at = clock_timestamp() - interval '11 minutes', expires_at = clock_timestamp() - interval '1 minute' WHERE id = $1",
      [expired.cookie.slice(0, 36)],
    );
    await expect(service.verify(expired.cookie, expired.code, ip())).rejects.toBeInstanceOf(
      AuthenticationRejectedError,
    );
    const replayed = await start();
    await service.verify(replayed.cookie, replayed.code, ip());
    await expect(service.verify(replayed.cookie, replayed.code, ip())).rejects.toBeInstanceOf(
      AuthenticationRejectedError,
    );
  });

  it('allows exactly one concurrent completion and one account/session', async () => {
    const attempt = await start();
    await service.verify(attempt.cookie, attempt.code, ip());
    const result = await Promise.allSettled([
      service.complete(attempt.cookie, { declaredResidencyCountryCode: 'US' }),
      service.complete(attempt.cookie, { declaredResidencyCountryCode: 'US' }),
    ]);
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((item) => item.status === 'rejected')).toHaveLength(1);
  });

  it('throttles sending to a recipient even from different IPs', async () => {
    const identifier = `${randomUUID()}@example.test`;
    for (let count = 0; count < 3; count++) await start(identifier);
    await expect(start(identifier)).rejects.toMatchObject({
      retryAfterSeconds: expect.any(Number),
    });
  });

  it('does not issue a usable challenge when delivery fails or is not configured', async () => {
    jest.mocked(delivery.available).mockReturnValueOnce(false);
    await expect(start()).rejects.toBeInstanceOf(AuthenticationUnavailableError);
    const count = messages.length;
    jest.mocked(delivery.send).mockRejectedValueOnce(new Error('private-provider-response'));
    await expect(start()).rejects.toBeInstanceOf(AuthenticationUnavailableError);
    expect(messages).toHaveLength(count);
    const pending = await api.query('SELECT id FROM passwordless_challenges WHERE sent = false');
    expect(pending.rows).toHaveLength(0);
  });

  it('keeps session rotation, CSRF enforcement and revocation working', async () => {
    const attempt = await start();
    await service.verify(attempt.cookie, attempt.code, ip());
    const result = await service.complete(attempt.cookie, { declaredResidencyCountryCode: 'US' });
    if (result.status !== 'authenticated') throw new Error('Missing session');
    const proof = {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        cookie: `__Host-cl_session=${result.session.sessionCookie}; __Host-cl_csrf=${result.session.csrfToken}`,
        'x-csrf-token': result.session.csrfToken,
      },
    };
    expect(
      await sessions.resolve({
        ...proof,
        headers: { ...proof.headers, origin: 'https://untrusted.example' },
      }),
    ).toBeNull();
    const rotated = await sessions.rotate(proof, ip());
    const updated = {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        cookie: `__Host-cl_session=${rotated.sessionCookie}; __Host-cl_csrf=${rotated.csrfToken}`,
        'x-csrf-token': rotated.csrfToken,
      },
    };
    await sessions.logout(updated);
    expect(await sessions.resolve({ ...updated, method: 'GET' })).toBeNull();
  });

  it('serves the browser flow with secure cookies and rejects cross-origin or duplicate-cookie requests', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/code/request')
      .set('Origin', 'https://untrusted.example')
      .send({ identifier: 'victim@example.test' })
      .expect(401);
    const identifier = `${randomUUID()}@example.test`;
    const begun = await request(app.getHttpServer())
      .post('/api/v1/auth/code/request')
      .set('Origin', ORIGIN)
      .send({ identifier })
      .expect(200);
    expect(begun.body).toEqual({ status: 'sent', channel: 'email', expiresInSeconds: 600 });
    expect(begun.headers['cache-control']).toBe('private, no-store');
    const setCookie = (begun.headers['set-cookie'] as unknown as string[])[0]!;
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');
    const cookie = setCookie.split(';')[0]!;
    const code = lastCode();
    await request(app.getHttpServer())
      .post('/api/v1/auth/code/verify')
      .set('Origin', ORIGIN)
      .set('Cookie', `${cookie}; ${cookie}`)
      .send({ code })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/code/verify')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .send({ code })
      .expect(200);
    const completed = await request(app.getHttpServer())
      .post('/api/v1/auth/code/complete')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .send({ declaredResidencyCountryCode: 'US' })
      .expect(200);
    expect(completed.body).toEqual({ status: 'authenticated' });
    expect(completed.headers['set-cookie']).toHaveLength(3);
    await request(app.getHttpServer()).get('/api/v1/auth/login').expect(503);
  });
});
