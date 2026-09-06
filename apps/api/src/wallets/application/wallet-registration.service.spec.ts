import { generateKeyPairSync, randomBytes, randomUUID, sign as signNodeMessage } from 'node:crypto';

import { privateKeyToAccount } from 'viem/accounts';

import { parseAccountId } from '../../accounts/domain/account-profile';
import { supportedAssetRegistryForEnvironment } from '../../blockchain/domain/supported-asset-registry';
import type {
  ActiveWalletRegistrationRecord,
  BeginWalletOwnershipChallengeRequest,
  CompleteWalletRegistrationRequest,
  PrepareWalletOwnershipChallengeResult,
  WalletRegistrationRepositoryPort,
} from './ports/wallet-registration-repository.port';
import {
  WalletOwnershipConflictError,
  WalletRegistrationRejectedError,
  WalletRegistrationUnavailableError,
} from './wallet-registration.errors';
import { WalletRegistrationService } from './wallet-registration.service';
import { parseWalletChallengeId } from '../domain/wallet-ownership-proof';
import { WALLET_REGISTRATION_LAUNCH_CHAIN_IDS } from '../domain/wallet-registration-launch-policy';
import {
  loadWalletRegistrationConfig,
  type EnabledWalletRegistrationConfig,
} from '../infrastructure/config/wallet-registration.config';
import {
  activeWalletRegistrationKey,
  digestWalletIdentity,
  sealWalletRegistrationValue,
  walletRegistrationKeyForVersion,
} from '../infrastructure/crypto/wallet-registration-crypto';

const NOW = new Date('2026-08-22T17:00:00.000Z');
const ACCOUNT_ID = parseAccountId(randomUUID());
const CORRELATION_ID = randomUUID();
const SOLANA_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function encodedKey(): string {
  return randomBytes(32).toString('base64url');
}

function config(
  registryEnvironment: 'MAINNET' | 'TESTNET' = 'TESTNET',
): EnabledWalletRegistrationConfig {
  const loaded = loadWalletRegistrationConfig({
    NODE_ENV: 'test',
    AUTH_MODE: 'oidc',
    AUTH_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
    WALLET_REGISTRATION_MODE: 'enabled',
    WALLET_REGISTRATION_REGISTRY_ENVIRONMENT: registryEnvironment,
    WALLET_REGISTRATION_CHALLENGE_TTL_SECONDS: '300',
    WALLET_IDENTITY_HMAC_KEY_VERSION: '1',
    WALLET_IDENTITY_HMAC_KEY: encodedKey(),
    WALLET_CHALLENGE_HMAC_KEY_VERSION: '1',
    WALLET_CHALLENGE_HMAC_KEY: encodedKey(),
    WALLET_METADATA_SEAL_KEY_VERSION: '1',
    WALLET_METADATA_SEAL_KEY: encodedKey(),
  });
  if (loaded.mode !== 'enabled') throw new Error('enabled wallet fixture expected');
  return loaded;
}

function rotatedConfig(): EnabledWalletRegistrationConfig {
  const keyRing = (purpose: 'challenge-hmac' | 'identity-hmac' | 'metadata-seal'): string =>
    JSON.stringify({
      activeWriteVersion: 2,
      keys: [1, 2].map((version) => ({
        keyId: `service-${purpose}-${String(version)}`,
        purpose,
        version,
        material: encodedKey(),
      })),
    });
  const loaded = loadWalletRegistrationConfig({
    NODE_ENV: 'test',
    AUTH_MODE: 'oidc',
    AUTH_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
    WALLET_REGISTRATION_MODE: 'enabled',
    WALLET_REGISTRATION_REGISTRY_ENVIRONMENT: 'TESTNET',
    WALLET_REGISTRATION_CHALLENGE_TTL_SECONDS: '300',
    WALLET_IDENTITY_HMAC_KEY_RING_JSON: keyRing('identity-hmac'),
    WALLET_CHALLENGE_HMAC_KEY_RING_JSON: keyRing('challenge-hmac'),
    WALLET_METADATA_SEAL_KEY_RING_JSON: keyRing('metadata-seal'),
  });
  if (loaded.mode !== 'enabled') throw new Error('enabled wallet fixture expected');
  return loaded;
}

function base58(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += (digits[index] ?? 0) << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let zeroes = 0;
  while (bytes[zeroes] === 0) zeroes += 1;
  return (
    '1'.repeat(zeroes) +
    digits
      .reverse()
      .map((digit) => SOLANA_ALPHABET[digit] ?? '')
      .join('')
  );
}

interface RepositoryFixture {
  readonly repository: WalletRegistrationRepositoryPort;
  readonly complete: jest.MockedFunction<WalletRegistrationRepositoryPort['completeRegistration']>;
  readonly list: jest.MockedFunction<WalletRegistrationRepositoryPort['listActiveWallets']>;
  readonly revoke: jest.MockedFunction<WalletRegistrationRepositoryPort['revokeWallet']>;
}

function repositoryFixture(): RepositoryFixture {
  let begun: BeginWalletOwnershipChallengeRequest | undefined;
  const complete = jest.fn<
    ReturnType<WalletRegistrationRepositoryPort['completeRegistration']>,
    [CompleteWalletRegistrationRequest]
  >(async (request) => ({
    status: 'registered',
    walletId: request.walletId,
    registeredAt: NOW,
  }));
  const list = jest.fn<
    ReturnType<WalletRegistrationRepositoryPort['listActiveWallets']>,
    Parameters<WalletRegistrationRepositoryPort['listActiveWallets']>
  >(async () => []);
  const revoke = jest.fn<
    ReturnType<WalletRegistrationRepositoryPort['revokeWallet']>,
    Parameters<WalletRegistrationRepositoryPort['revokeWallet']>
  >(async () => ({ status: 'revoked' }));
  const repository: WalletRegistrationRepositoryPort = {
    listActiveWallets: list,
    revokeWallet: revoke,
    beginChallenge: jest.fn(async (request) => {
      begun = request;
      return { challengeId: request.challengeId, expiresAt: request.expiresAt };
    }),
    prepareChallenge: jest.fn(async (): Promise<PrepareWalletOwnershipChallengeResult> => {
      if (!begun) return { status: 'invalid' };
      return {
        status: 'pending',
        challengeId: begun.challengeId,
        accountId: begun.accountId,
        proofScheme: begun.proofScheme,
        chainId: begun.chainId,
        addressDigest: begun.addressDigest,
        domainDigest: begun.domainDigest,
        messageDigest: begun.messageDigest,
        nonceDigest: begun.nonceDigest,
        challengePayload: begun.challengePayload,
        registry: begun.registry,
        issuedAt: begun.issuedAt,
        expiresAt: begun.expiresAt,
      };
    }),
    rejectChallenge: jest.fn(async () => ({ status: 'rejected' as const })),
    completeRegistration: complete,
  };
  return { repository, complete, list, revoke };
}

function serviceFixture(
  registryEnvironment: 'MAINNET' | 'TESTNET' = 'TESTNET',
): RepositoryFixture & {
  readonly config: EnabledWalletRegistrationConfig;
  readonly service: WalletRegistrationService;
} {
  const fixture = repositoryFixture();
  const walletConfig = config(registryEnvironment);
  const service = new WalletRegistrationService(fixture.repository, walletConfig, {
    now: () => new Date(NOW),
  });
  return { config: walletConfig, service, ...fixture };
}

describe('WalletRegistrationService', () => {
  it('pins the exact production and test launch allowlists', () => {
    expect(WALLET_REGISTRATION_LAUNCH_CHAIN_IDS).toEqual({
      MAINNET: ['eip155:1', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
      TESTNET: ['eip155:11155111', 'eip155:84532', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'],
    });
  });

  it('decrypts only account-bound active wallets with current registry and digest bindings', async () => {
    const { service, config: walletConfig, list } = serviceFixture();
    const walletId = randomUUID();
    const registeredByChallengeId = parseWalletChallengeId(randomUUID());
    const chainId = 'eip155:11155111' as const;
    const address = '0xde709f2102306220921060314715629080e2fb77';
    const addressDigest = digestWalletIdentity(
      activeWalletRegistrationKey(walletConfig.identityHmacKeys),
      chainId,
      address,
    );
    const registry = supportedAssetRegistryForEnvironment('TESTNET').latest;
    const record: ActiveWalletRegistrationRecord = {
      walletId,
      accountId: ACCOUNT_ID,
      registeredByChallengeId,
      chainId,
      registry: {
        environment: registry.environment,
        version: registry.version,
        fingerprintSha256: registry.fingerprintSha256,
      },
      addressDigest,
      verificationAddressDigest: addressDigest,
      encryptedAddress: sealWalletRegistrationValue(
        activeWalletRegistrationKey(walletConfig.metadataSealKeys),
        {
          field: 'address',
          walletId,
          challengeId: registeredByChallengeId,
          accountId: ACCOUNT_ID,
          networkId: chainId,
          addressDigest,
        },
        address,
      ),
      registeredAt: NOW,
    };
    list.mockResolvedValue([record]);

    await expect(service.listActiveWallets(ACCOUNT_ID)).resolves.toEqual({
      version: 1,
      wallets: [
        {
          walletId,
          chainId,
          address,
          registeredAt: NOW.toISOString(),
          registryEnvironment: registry.environment,
          registryVersion: registry.version,
          registryFingerprintSha256: registry.fingerprintSha256,
        },
      ],
    });
    expect(list).toHaveBeenCalledWith({ accountId: ACCOUNT_ID });
    expect(Object.prototype.hasOwnProperty.call(list.mock.calls[0]?.[0], 'signal')).toBe(false);

    list.mockResolvedValueOnce([{ ...record, accountId: parseAccountId(randomUUID()) }]);
    await expect(service.listActiveWallets(ACCOUNT_ID)).rejects.toBeInstanceOf(
      WalletRegistrationUnavailableError,
    );

    const unsupportedChainId = 'eip155:421614' as const;
    const unsupportedDigest = digestWalletIdentity(
      activeWalletRegistrationKey(walletConfig.identityHmacKeys),
      unsupportedChainId,
      address,
    );
    list.mockResolvedValueOnce([
      {
        ...record,
        chainId: unsupportedChainId,
        addressDigest: unsupportedDigest,
        encryptedAddress: sealWalletRegistrationValue(
          activeWalletRegistrationKey(walletConfig.metadataSealKeys),
          {
            field: 'address',
            walletId,
            challengeId: registeredByChallengeId,
            accountId: ACCOUNT_ID,
            networkId: unsupportedChainId,
            addressDigest: unsupportedDigest,
          },
          address,
        ),
      },
    ]);
    await expect(service.listActiveWallets(ACCOUNT_ID)).rejects.toBeInstanceOf(
      WalletRegistrationUnavailableError,
    );

    list.mockResolvedValueOnce([
      {
        ...record,
        encryptedAddress: {
          ...record.encryptedAddress,
          authTag: randomBytes(16).toString('base64url'),
        },
      },
    ]);
    await expect(service.listActiveWallets(ACCOUNT_ID)).rejects.toBeInstanceOf(
      WalletRegistrationUnavailableError,
    );
  });

  it('forwards an exact optional cancellation signal and sanitizes repository failures', async () => {
    const successful = serviceFixture();
    const controller = new AbortController();

    await expect(
      successful.service.listActiveWallets(
        ACCOUNT_ID,
        Object.freeze({ signal: controller.signal }),
      ),
    ).resolves.toEqual({ version: 1, wallets: [] });
    expect(successful.list).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      signal: controller.signal,
    });
    expect(successful.list.mock.calls[0]?.[0].signal).toBe(controller.signal);

    const unavailable = serviceFixture();
    unavailable.list.mockRejectedValueOnce(new Error('private cancellation detail'));
    let thrown: unknown;
    try {
      await unavailable.service.listActiveWallets(ACCOUNT_ID, { signal: controller.signal });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toEqual(new WalletRegistrationUnavailableError());
    expect(String(thrown)).not.toContain('private cancellation detail');
  });

  it('reads previous key versions while issuing only active-version writes and all identity aliases', async () => {
    const repository = repositoryFixture();
    const walletConfig = rotatedConfig();
    const service = new WalletRegistrationService(repository.repository, walletConfig, {
      now: () => new Date(NOW),
    });
    const walletId = randomUUID();
    const registeredByChallengeId = parseWalletChallengeId(randomUUID());
    const chainId = 'eip155:11155111' as const;
    const address = '0xde709f2102306220921060314715629080e2fb77';
    const priorIdentityKey = walletRegistrationKeyForVersion(walletConfig.identityHmacKeys, 1);
    const priorSealKey = walletRegistrationKeyForVersion(walletConfig.metadataSealKeys, 1);
    const addressDigest = digestWalletIdentity(priorIdentityKey, chainId, address);
    const registry = supportedAssetRegistryForEnvironment('TESTNET').latest;
    repository.list.mockResolvedValue([
      {
        walletId,
        accountId: ACCOUNT_ID,
        registeredByChallengeId,
        chainId,
        registry: {
          environment: registry.environment,
          version: registry.version,
          fingerprintSha256: registry.fingerprintSha256,
        },
        addressDigest,
        verificationAddressDigest: digestWalletIdentity(
          activeWalletRegistrationKey(walletConfig.identityHmacKeys),
          chainId,
          address,
        ),
        encryptedAddress: sealWalletRegistrationValue(
          priorSealKey,
          {
            field: 'address',
            walletId,
            challengeId: registeredByChallengeId,
            accountId: ACCOUNT_ID,
            networkId: chainId,
            addressDigest,
          },
          address,
        ),
        registeredAt: NOW,
      },
    ]);

    await expect(service.listActiveWallets(ACCOUNT_ID)).resolves.toMatchObject({
      wallets: [{ walletId, address }],
    });
    await service.issueChallenge({
      accountId: ACCOUNT_ID,
      chainId,
      address,
      correlationId: CORRELATION_ID,
    });
    const begun = jest.mocked(repository.repository.beginChallenge).mock.calls[0]?.[0];
    expect(begun).toBeDefined();
    expect(begun?.addressDigest.version).toBe(2);
    expect(begun?.challengePayload.keyVersion).toBe(2);
    expect(begun?.domainDigest.version).toBe(2);
    expect(begun?.identityDigests.map((digest) => digest.version)).toEqual([1, 2]);
  });

  it('removes a wallet with constant idempotent semantics scoped to the current account', async () => {
    const { service, revoke } = serviceFixture();
    const walletId = randomUUID();

    await expect(
      service.removeWallet({ accountId: ACCOUNT_ID, walletId, correlationId: CORRELATION_ID }),
    ).resolves.toEqual({ status: 'removed' });
    expect(revoke).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      walletId,
      correlationId: CORRELATION_ID,
    });

    revoke.mockResolvedValueOnce({ status: 'unchanged' });
    await expect(
      service.removeWallet({ accountId: ACCOUNT_ID, walletId, correlationId: CORRELATION_ID }),
    ).resolves.toEqual({ status: 'removed' });
  });

  it('keeps removal available while new wallet registration is disabled', async () => {
    const fixture = repositoryFixture();
    const service = new WalletRegistrationService(
      fixture.repository,
      { mode: 'disabled' },
      {
        now: () => new Date(NOW),
      },
    );
    const walletId = randomUUID();

    await expect(
      service.removeWallet({ accountId: ACCOUNT_ID, walletId, correlationId: CORRELATION_ID }),
    ).resolves.toEqual({ status: 'removed' });
    expect(fixture.revoke).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      walletId,
      correlationId: CORRELATION_ID,
    });
  });

  it('rejects malformed removal inputs and fails closed on persistence anomalies', async () => {
    const malformed = serviceFixture();
    await expect(
      malformed.service.removeWallet({
        accountId: ACCOUNT_ID,
        walletId: 'not-a-wallet-id',
        correlationId: CORRELATION_ID,
      }),
    ).rejects.toBeInstanceOf(WalletRegistrationRejectedError);
    expect(malformed.revoke).not.toHaveBeenCalled();

    const unavailable = serviceFixture();
    unavailable.revoke.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      unavailable.service.removeWallet({
        accountId: ACCOUNT_ID,
        walletId: randomUUID(),
        correlationId: CORRELATION_ID,
      }),
    ).rejects.toBeInstanceOf(WalletRegistrationUnavailableError);

    const forged = serviceFixture();
    forged.revoke.mockResolvedValueOnce({ status: 'unexpected' } as never);
    await expect(
      forged.service.removeWallet({
        accountId: ACCOUNT_ID,
        walletId: randomUUID(),
        correlationId: CORRELATION_ID,
      }),
    ).rejects.toBeInstanceOf(WalletRegistrationUnavailableError);
  });

  it('issues and verifies a valid offline EVM EOA proof', async () => {
    const { service, complete } = serviceFixture();
    const account = privateKeyToAccount(`0x${randomBytes(32).toString('hex')}`);
    const challenge = await service.issueChallenge({
      accountId: ACCOUNT_ID,
      chainId: 'eip155:11155111',
      address: account.address,
      correlationId: CORRELATION_ID,
    });
    const signature = await account.signMessage({ message: challenge.message });
    const registered = await service.submitProof({
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
      proof: {
        kind: 'EVM_EIP191_EOA',
        challengeId: challenge.challengeId,
        message: challenge.message,
        signature,
      },
    });

    expect(challenge.message).toContain('does not authorize login');
    expect(challenge.registryEnvironment).toBe('TESTNET');
    expect(registered).toMatchObject({
      status: 'registered',
      chainId: 'eip155:11155111',
      address: account.address.toLowerCase(),
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(complete.mock.calls[0]?.[0])).not.toContain(challenge.message);
    expect(JSON.stringify(complete.mock.calls[0]?.[0])).not.toContain(signature);
  });

  it('issues and verifies a valid offline Solana Ed25519 proof', async () => {
    const { service } = serviceFixture();
    const pair = generateKeyPairSync('ed25519');
    const publicDer = pair.publicKey.export({ type: 'spki', format: 'der' });
    const publicKey = publicDer.subarray(publicDer.length - 32);
    const address = base58(publicKey);
    const challenge = await service.issueChallenge({
      accountId: ACCOUNT_ID,
      chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
      address,
      correlationId: CORRELATION_ID,
    });
    const message = Buffer.from(challenge.message, 'utf8');
    const signature = signNodeMessage(null, message, pair.privateKey);
    const registered = await service.submitProof({
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
      proof: {
        kind: 'SOLANA_ED25519',
        challengeId: challenge.challengeId,
        address: address as never,
        publicKey,
        signedMessage: message,
        signature,
      },
    });

    expect(challenge.messageFormat).toBe('SIWS');
    expect(registered).toMatchObject({
      status: 'registered',
      chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
      address,
    });
  });

  it('terminally rejects a malformed signature without persisting proof material', async () => {
    const { service, repository, complete } = serviceFixture();
    const account = privateKeyToAccount(`0x${randomBytes(32).toString('hex')}`);
    const challenge = await service.issueChallenge({
      accountId: ACCOUNT_ID,
      chainId: 'eip155:11155111',
      address: account.address,
      correlationId: CORRELATION_ID,
    });
    const signature = await account.signMessage({ message: challenge.message });
    const mutated = `${signature.slice(0, 4)}${signature[4] === '0' ? '1' : '0'}${signature.slice(5)}`;

    await expect(
      service.submitProof({
        accountId: ACCOUNT_ID,
        correlationId: CORRELATION_ID,
        proof: {
          kind: 'EVM_EIP191_EOA',
          challengeId: challenge.challengeId,
          message: challenge.message,
          signature: mutated,
        },
      }),
    ).rejects.toBeInstanceOf(WalletRegistrationRejectedError);
    expect(repository.rejectChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'SIGNATURE_INVALID' }),
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it('fails closed on replay and conflicting ownership outcomes', async () => {
    const replay = serviceFixture();
    replay.repository.prepareChallenge = jest.fn(
      async (): Promise<PrepareWalletOwnershipChallengeResult> => ({ status: 'replayed' }),
    );
    await expect(
      replay.service.submitProof({
        accountId: ACCOUNT_ID,
        correlationId: CORRELATION_ID,
        proof: {
          kind: 'EVM_EIP191_EOA',
          challengeId: randomUUID() as never,
          message: 'not inspected',
          signature: 'not inspected',
        },
      }),
    ).rejects.toBeInstanceOf(WalletRegistrationRejectedError);

    const conflict = serviceFixture();
    conflict.complete.mockResolvedValueOnce({ status: 'ownership_conflict' });
    const account = privateKeyToAccount(`0x${randomBytes(32).toString('hex')}`);
    const challenge = await conflict.service.issueChallenge({
      accountId: ACCOUNT_ID,
      chainId: 'eip155:11155111',
      address: account.address,
      correlationId: CORRELATION_ID,
    });
    const signature = await account.signMessage({ message: challenge.message });
    await expect(
      conflict.service.submitProof({
        accountId: ACCOUNT_ID,
        correlationId: CORRELATION_ID,
        proof: {
          kind: 'EVM_EIP191_EOA',
          challengeId: challenge.challengeId,
          message: challenge.message,
          signature,
        },
      }),
    ).rejects.toBeInstanceOf(WalletOwnershipConflictError);
  });

  it('rejects unsupported environment networks before creating durable state', async () => {
    const { service, repository } = serviceFixture();
    await expect(
      service.issueChallenge({
        accountId: ACCOUNT_ID,
        chainId: 'eip155:1',
        address: '0xde709f2102306220921060314715629080e2fb77',
        correlationId: CORRELATION_ID,
      }),
    ).rejects.toBeInstanceOf(WalletRegistrationRejectedError);
    await expect(
      service.issueChallenge({
        accountId: ACCOUNT_ID,
        chainId: 'eip155:421614',
        address: '0xde709f2102306220921060314715629080e2fb77',
        correlationId: CORRELATION_ID,
      }),
    ).rejects.toBeInstanceOf(WalletRegistrationRejectedError);
    expect(repository.beginChallenge).not.toHaveBeenCalled();
  });

  it.each(['eip155:8453', 'eip155:42161'] as const)(
    'rejects non-launch mainnet %s before creating durable state',
    async (chainId) => {
      const { service, repository } = serviceFixture('MAINNET');

      await expect(
        service.issueChallenge({
          accountId: ACCOUNT_ID,
          chainId,
          address: '0xde709f2102306220921060314715629080e2fb77',
          correlationId: CORRELATION_ID,
        }),
      ).rejects.toBeInstanceOf(WalletRegistrationRejectedError);
      expect(repository.beginChallenge).not.toHaveBeenCalled();
    },
  );

  it('fails closed when storage returns an active Base mainnet registration', async () => {
    const { service, config: walletConfig, list } = serviceFixture('MAINNET');
    const walletId = randomUUID();
    const registeredByChallengeId = parseWalletChallengeId(randomUUID());
    const chainId = 'eip155:8453' as const;
    const address = '0xde709f2102306220921060314715629080e2fb77';
    const addressDigest = digestWalletIdentity(
      activeWalletRegistrationKey(walletConfig.identityHmacKeys),
      chainId,
      address,
    );
    const registry = supportedAssetRegistryForEnvironment('MAINNET').latest;
    list.mockResolvedValue([
      {
        walletId,
        accountId: ACCOUNT_ID,
        registeredByChallengeId,
        chainId,
        registry: {
          environment: registry.environment,
          version: registry.version,
          fingerprintSha256: registry.fingerprintSha256,
        },
        addressDigest,
        verificationAddressDigest: addressDigest,
        encryptedAddress: sealWalletRegistrationValue(
          activeWalletRegistrationKey(walletConfig.metadataSealKeys),
          {
            field: 'address',
            walletId,
            challengeId: registeredByChallengeId,
            accountId: ACCOUNT_ID,
            networkId: chainId,
            addressDigest,
          },
          address,
        ),
        registeredAt: NOW,
      },
    ]);

    await expect(service.listActiveWallets(ACCOUNT_ID)).rejects.toBeInstanceOf(
      WalletRegistrationUnavailableError,
    );
  });
});
