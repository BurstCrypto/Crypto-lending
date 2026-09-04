import { randomBytes, randomUUID } from 'node:crypto';

import type { QueryResult } from 'pg';

import { parseAccountId } from '../../../accounts/domain/account-profile';
import type { PostgresService } from '../../../infrastructure/database/postgres.service';
import {
  MAX_ACTIVE_WALLET_REGISTRATIONS_PER_ACCOUNT,
  type BeginWalletOwnershipChallengeRequest,
  type WalletRegistrationRepositoryPort,
} from '../../application/ports/wallet-registration-repository.port';
import { WalletRegistrationRateLimitedError } from '../../application/wallet-registration.errors';
import { parseWalletChallengeId } from '../../domain/wallet-ownership-proof';
import {
  createWalletRegistrationKey,
  digestWalletChallengeValue,
  digestWalletIdentity,
  sealWalletRegistrationValue,
} from '../crypto/wallet-registration-crypto';
import {
  PostgresWalletRegistrationRepository,
  WalletRegistrationPersistenceError,
} from './postgres-wallet-registration.repository';

const NOW = new Date('2026-08-22T17:00:00.000Z');
const EXPIRES = new Date('2026-08-22T17:05:00.000Z');
const ACCOUNT_ID = parseAccountId(randomUUID());
const CHALLENGE_ID = parseWalletChallengeId(randomUUID());
const WALLET_ID = randomUUID();
const CORRELATION_ID = randomUUID();
const ADDRESS = '0xde709f2102306220921060314715629080e2fb77';
const NETWORK = 'eip155:11155111' as const;

function result<Row>(rows: readonly Row[]): QueryResult<Row & Record<string, unknown>> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: rows as (Row & Record<string, unknown>)[],
  };
}

function beginRequest(): BeginWalletOwnershipChallengeRequest {
  const identityKey = createWalletRegistrationKey(
    'identity-hmac',
    1,
    randomBytes(32).toString('base64url'),
  );
  const challengeKey = createWalletRegistrationKey(
    'challenge-hmac',
    1,
    randomBytes(32).toString('base64url'),
  );
  const sealKey = createWalletRegistrationKey(
    'metadata-seal',
    1,
    randomBytes(32).toString('base64url'),
  );
  const addressDigest = digestWalletIdentity(identityKey, NETWORK, ADDRESS);
  return {
    challengeId: CHALLENGE_ID,
    accountId: ACCOUNT_ID,
    proofScheme: 'EVM_ERC4361_ERC191',
    chainId: NETWORK,
    addressDigest,
    identityDigests: [addressDigest],
    domainDigest: digestWalletChallengeValue('domain', challengeKey, 'https://app.example.test'),
    messageDigest: digestWalletChallengeValue('message', challengeKey, 'message'),
    nonceDigest: digestWalletChallengeValue('nonce', challengeKey, 'nonce'),
    challengePayload: sealWalletRegistrationValue(
      sealKey,
      {
        field: 'challenge',
        challengeId: CHALLENGE_ID,
        accountId: ACCOUNT_ID,
        networkId: NETWORK,
        addressDigest,
      },
      '{"safe":"payload"}',
    ),
    registry: {
      environment: 'TESTNET',
      version: 1,
      fingerprintSha256: '89c158de188fcde7d01642aadef226f3c93724bfe5b53a7f3fcce096180d5ca7',
    },
    issuedAt: NOW,
    expiresAt: EXPIRES,
    correlationId: CORRELATION_ID,
  };
}

function repositoryWith(query: jest.Mock): WalletRegistrationRepositoryPort {
  return new PostgresWalletRegistrationRepository({ query } as unknown as PostgresService);
}

describe('PostgresWalletRegistrationRepository', () => {
  it('lists only bounded encrypted active-wallet rows for the requested account', async () => {
    const request = beginRequest();
    const encryptedAddress = sealWalletRegistrationValue(
      createWalletRegistrationKey('metadata-seal', 1, randomBytes(32).toString('base64url')),
      {
        field: 'address',
        walletId: WALLET_ID,
        challengeId: CHALLENGE_ID,
        accountId: ACCOUNT_ID,
        networkId: NETWORK,
        addressDigest: request.addressDigest,
      },
      ADDRESS,
    );
    const row = {
      active_wallet_id: WALLET_ID,
      active_account_id: ACCOUNT_ID,
      active_registered_by_challenge_id: CHALLENGE_ID,
      active_chain_namespace: 'eip155',
      active_chain_reference: '11155111',
      active_registry_environment: request.registry.environment,
      active_registry_version: request.registry.version,
      active_registry_fingerprint_sha256: request.registry.fingerprintSha256,
      active_address_digest_version: request.addressDigest.version,
      active_address_digest: Buffer.from(request.addressDigest.value, 'hex'),
      active_verification_digest_version: request.addressDigest.version,
      active_verification_digest: Buffer.from(request.addressDigest.value, 'hex'),
      active_address_key_version: encryptedAddress.keyVersion,
      active_address_ciphertext: Buffer.from(encryptedAddress.ciphertext, 'base64url'),
      active_address_iv: Buffer.from(encryptedAddress.iv, 'base64url'),
      active_address_auth_tag: Buffer.from(encryptedAddress.authTag, 'base64url'),
      active_registered_at: NOW,
    };
    const query = jest.fn().mockResolvedValue(result([row]));

    await expect(
      repositoryWith(query).listActiveWallets({ accountId: ACCOUNT_ID }),
    ).resolves.toEqual([
      expect.objectContaining({
        walletId: WALLET_ID,
        accountId: ACCOUNT_ID,
        registeredByChallengeId: CHALLENGE_ID,
        chainId: NETWORK,
        registry: request.registry,
        addressDigest: request.addressDigest,
        verificationAddressDigest: request.addressDigest,
        encryptedAddress,
        registeredAt: NOW,
      }),
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('list_active_wallet_registrations_rotatable'),
      [ACCOUNT_ID],
    );

    query.mockResolvedValueOnce(
      result(Array.from({ length: MAX_ACTIVE_WALLET_REGISTRATIONS_PER_ACCOUNT + 1 }, () => row)),
    );
    await expect(
      repositoryWith(query).listActiveWallets({ accountId: ACCOUNT_ID }),
    ).rejects.toBeInstanceOf(WalletRegistrationPersistenceError);

    query.mockResolvedValueOnce(
      result([{ ...row, active_address_ciphertext: Buffer.alloc(513, 1) }]),
    );
    await expect(
      repositoryWith(query).listActiveWallets({ accountId: ACCOUNT_ID }),
    ).rejects.toBeInstanceOf(WalletRegistrationPersistenceError);
  });

  it('maps wallet revocation without exposing whether the account-scoped row existed', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce(result([{ revocation_outcome: 'REVOKED' }]))
      .mockResolvedValueOnce(result([{ revocation_outcome: 'UNCHANGED' }]))
      .mockResolvedValueOnce(result([{ revocation_outcome: 'FORGED' }]));
    const repository = repositoryWith(query);
    const request = {
      accountId: ACCOUNT_ID,
      walletId: WALLET_ID,
      correlationId: CORRELATION_ID,
    };

    await expect(repository.revokeWallet(request)).resolves.toEqual({ status: 'revoked' });
    await expect(repository.revokeWallet(request)).resolves.toEqual({ status: 'unchanged' });
    expect(query.mock.calls[0]).toEqual([
      expect.stringContaining('revoke_wallet_registration('),
      [ACCOUNT_ID, WALLET_ID, CORRELATION_ID],
    ]);
    await expect(repository.revokeWallet(request)).rejects.toBeInstanceOf(
      WalletRegistrationPersistenceError,
    );
  });

  it('maps an encrypted challenge to the exact fixed SQL boundary', async () => {
    const query = jest
      .fn()
      .mockResolvedValue(result([{ challenge_id: CHALLENGE_ID, expires_at: EXPIRES }]));
    const repository = repositoryWith(query);
    const request = beginRequest();

    await expect(repository.beginChallenge(request)).resolves.toEqual({
      challengeId: CHALLENGE_ID,
      expiresAt: EXPIRES,
    });
    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('begin_wallet_ownership_challenge_rotatable(');
    expect(parameters).toHaveLength(25);
    expect(parameters).toContain('eip155');
    expect(parameters).toContain('11155111');
    expect(JSON.stringify(parameters)).not.toContain(ADDRESS);
    expect(parameters.filter(Buffer.isBuffer)).toHaveLength(7);
    expect(parameters.at(-2)).toEqual([1]);
    expect(parameters.at(-1)).toEqual([request.addressDigest.value]);
  });

  it('restores only complete READY rows and passes the correlation to expiry preparation', async () => {
    const request = beginRequest();
    const payload = Buffer.from(request.challengePayload.ciphertext, 'base64url');
    const query = jest.fn().mockResolvedValue(
      result([
        {
          prepare_outcome: 'READY',
          prepared_account_id: ACCOUNT_ID,
          prepared_proof_scheme: request.proofScheme,
          prepared_chain_namespace: 'eip155',
          prepared_chain_reference: '11155111',
          prepared_registry_environment: request.registry.environment,
          prepared_registry_version: request.registry.version,
          prepared_registry_fingerprint_sha256: request.registry.fingerprintSha256,
          prepared_challenge_payload_key_version: request.challengePayload.keyVersion,
          prepared_challenge_payload_ciphertext: payload,
          prepared_challenge_payload_iv: Buffer.from(request.challengePayload.iv, 'base64url'),
          prepared_challenge_payload_auth_tag: Buffer.from(
            request.challengePayload.authTag,
            'base64url',
          ),
          prepared_address_digest_version: request.addressDigest.version,
          prepared_address_digest: Buffer.from(request.addressDigest.value, 'hex'),
          prepared_domain_digest_version: request.domainDigest.version,
          prepared_domain_digest: Buffer.from(request.domainDigest.value, 'hex'),
          prepared_message_digest_version: request.messageDigest.version,
          prepared_message_digest: Buffer.from(request.messageDigest.value, 'hex'),
          prepared_nonce_digest_version: request.nonceDigest.version,
          prepared_nonce_digest: Buffer.from(request.nonceDigest.value, 'hex'),
          prepared_issued_at: NOW,
          prepared_expires_at: EXPIRES,
        },
      ]),
    );
    const repository = repositoryWith(query);

    await expect(
      repository.prepareChallenge({
        challengeId: CHALLENGE_ID,
        accountId: ACCOUNT_ID,
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toMatchObject({
      status: 'pending',
      chainId: NETWORK,
      registry: request.registry,
      challengePayload: request.challengePayload,
    });
    expect(query.mock.calls[0]?.[1]).toEqual([CHALLENGE_ID, ACCOUNT_ID, CORRELATION_ID]);
  });

  it('uses only guarded completion and maps a revocation tombstone to rejection state', async () => {
    const encrypted = beginRequest().challengePayload;
    const query = jest.fn().mockResolvedValue(
      result([
        {
          registration_outcome: 'REVOKED',
          wallet_id: null,
          registered_at: null,
        },
      ]),
    );
    const repository = repositoryWith(query);

    await expect(
      repository.completeRegistration({
        challengeId: CHALLENGE_ID,
        accountId: ACCOUNT_ID,
        walletId: WALLET_ID,
        encryptedAddress: encrypted,
        encryptedMetadata: encrypted,
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toEqual({ status: 'revoked' });

    const [sql] = query.mock.calls[0] as [string];
    expect(sql).toContain('FROM complete_wallet_registration_rotatable(');
    expect(sql).not.toContain('FROM complete_wallet_registration(');
  });

  it('rejects metadata leaks on non-ready outcomes and forged completion results', async () => {
    const leaked = jest.fn().mockResolvedValue(
      result([
        {
          prepare_outcome: 'INVALID',
          prepared_account_id: ACCOUNT_ID,
          prepared_proof_scheme: null,
          prepared_chain_namespace: null,
          prepared_chain_reference: null,
          prepared_registry_environment: null,
          prepared_registry_version: null,
          prepared_registry_fingerprint_sha256: null,
          prepared_challenge_payload_key_version: null,
          prepared_challenge_payload_ciphertext: null,
          prepared_challenge_payload_iv: null,
          prepared_challenge_payload_auth_tag: null,
          prepared_address_digest_version: null,
          prepared_address_digest: null,
          prepared_domain_digest_version: null,
          prepared_domain_digest: null,
          prepared_message_digest_version: null,
          prepared_message_digest: null,
          prepared_nonce_digest_version: null,
          prepared_nonce_digest: null,
          prepared_issued_at: null,
          prepared_expires_at: null,
        },
      ]),
    );
    await expect(
      repositoryWith(leaked).prepareChallenge({
        challengeId: CHALLENGE_ID,
        accountId: ACCOUNT_ID,
        correlationId: CORRELATION_ID,
      }),
    ).rejects.toBeInstanceOf(WalletRegistrationPersistenceError);
  });

  it('maps pending-challenge exhaustion to a bounded application rate-limit error', async () => {
    const query = jest.fn().mockRejectedValue({ code: '54000' });
    await expect(repositoryWith(query).beginChallenge(beginRequest())).rejects.toEqual(
      new WalletRegistrationRateLimitedError(60),
    );
  });

  it('rejects incomplete, unordered, duplicate, and non-active identity alias sets locally', async () => {
    const query = jest.fn();
    const original = beginRequest();
    const other = {
      ...original.addressDigest,
      version: 2,
      value: randomBytes(32).toString('hex') as typeof original.addressDigest.value,
    };
    const malformed = [
      { ...original, identityDigests: [] },
      { ...original, identityDigests: [other, original.addressDigest] },
      { ...original, identityDigests: [original.addressDigest, original.addressDigest] },
      { ...original, identityDigests: [other] },
    ];

    for (const request of malformed) {
      await expect(repositoryWith(query).beginChallenge(request)).rejects.toBeInstanceOf(
        WalletRegistrationPersistenceError,
      );
    }
    expect(query).not.toHaveBeenCalled();
  });
});
