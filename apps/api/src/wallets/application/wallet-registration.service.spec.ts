import { generateKeyPairSync, randomBytes, randomUUID, sign as signNodeMessage } from 'node:crypto';

import { privateKeyToAccount } from 'viem/accounts';

import { parseAccountId } from '../../accounts/domain/account-profile';
import type {
  BeginWalletOwnershipChallengeRequest,
  CompleteWalletRegistrationRequest,
  PrepareWalletOwnershipChallengeResult,
  WalletRegistrationRepositoryPort,
} from './ports/wallet-registration-repository.port';
import {
  WalletOwnershipConflictError,
  WalletRegistrationRejectedError,
} from './wallet-registration.errors';
import { WalletRegistrationService } from './wallet-registration.service';
import {
  loadWalletRegistrationConfig,
  type WalletRegistrationConfig,
} from '../infrastructure/config/wallet-registration.config';

const NOW = new Date('2026-08-22T17:00:00.000Z');
const ACCOUNT_ID = parseAccountId(randomUUID());
const CORRELATION_ID = randomUUID();
const SOLANA_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function encodedKey(): string {
  return randomBytes(32).toString('base64url');
}

function config(): WalletRegistrationConfig {
  return loadWalletRegistrationConfig({
    NODE_ENV: 'test',
    AUTH_MODE: 'oidc',
    AUTH_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
    WALLET_REGISTRATION_MODE: 'enabled',
    WALLET_REGISTRATION_REGISTRY_ENVIRONMENT: 'TESTNET',
    WALLET_REGISTRATION_CHALLENGE_TTL_SECONDS: '300',
    WALLET_IDENTITY_HMAC_KEY_VERSION: '1',
    WALLET_IDENTITY_HMAC_KEY: encodedKey(),
    WALLET_CHALLENGE_HMAC_KEY_VERSION: '1',
    WALLET_CHALLENGE_HMAC_KEY: encodedKey(),
    WALLET_METADATA_SEAL_KEY_VERSION: '1',
    WALLET_METADATA_SEAL_KEY: encodedKey(),
  });
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
  const repository: WalletRegistrationRepositoryPort = {
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
  return { repository, complete };
}

function serviceFixture(): RepositoryFixture & { readonly service: WalletRegistrationService } {
  const fixture = repositoryFixture();
  const service = new WalletRegistrationService(fixture.repository, config(), {
    now: () => new Date(NOW),
  });
  return { service, ...fixture };
}

describe('WalletRegistrationService', () => {
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
    expect(repository.beginChallenge).not.toHaveBeenCalled();
  });
});
