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
  digestWalletIdentity,
  sealWalletRegistrationValue,
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
  const repository: WalletRegistrationRepositoryPort = {
    listActiveWallets: list,
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
  return { repository, complete, list };
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
    const addressDigest = digestWalletIdentity(walletConfig.identityHmacKey, chainId, address);
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
      encryptedAddress: sealWalletRegistrationValue(
        walletConfig.metadataSealKey,
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

    list.mockResolvedValueOnce([{ ...record, accountId: parseAccountId(randomUUID()) }]);
    await expect(service.listActiveWallets(ACCOUNT_ID)).rejects.toBeInstanceOf(
      WalletRegistrationUnavailableError,
    );

    const unsupportedChainId = 'eip155:421614' as const;
    const unsupportedDigest = digestWalletIdentity(
      walletConfig.identityHmacKey,
      unsupportedChainId,
      address,
    );
    list.mockResolvedValueOnce([
      {
        ...record,
        chainId: unsupportedChainId,
        addressDigest: unsupportedDigest,
        encryptedAddress: sealWalletRegistrationValue(
          walletConfig.metadataSealKey,
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
    const addressDigest = digestWalletIdentity(walletConfig.identityHmacKey, chainId, address);
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
        encryptedAddress: sealWalletRegistrationValue(
          walletConfig.metadataSealKey,
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
