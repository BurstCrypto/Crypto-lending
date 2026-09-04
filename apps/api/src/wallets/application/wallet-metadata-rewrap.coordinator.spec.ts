import { randomBytes, randomUUID } from 'node:crypto';

import { parseAccountId } from '../../accounts/domain/account-profile';
import { supportedAssetRegistryForEnvironment } from '../../blockchain/domain/supported-asset-registry';
import type {
  PreparedWalletMetadataRewrap,
  WalletMetadataRewrapRepositoryPort,
} from './ports/wallet-metadata-rewrap-repository.port';
import {
  WalletMetadataRewrapCoordinator,
  WalletMetadataRewrapError,
} from './wallet-metadata-rewrap.coordinator';
import type { WalletOwnershipChainId } from '../domain/wallet-identity';
import type { EnabledWalletRegistrationConfig } from '../infrastructure/config/wallet-registration.config';
import {
  createWalletRegistrationKey,
  createWalletRegistrationKeyRing,
  digestWalletIdentity,
  openWalletRegistrationValue,
  sealWalletRegistrationValue,
} from '../infrastructure/crypto/wallet-registration-crypto';

const ACCOUNT_ID = parseAccountId(randomUUID());
const WALLET_ID = randomUUID();
const CHALLENGE_ID = randomUUID();
const COMMAND_ID = randomUUID();
const REGISTRY = supportedAssetRegistryForEnvironment('MAINNET').latest;
const IDENTITY_V1 = createWalletRegistrationKey(
  'identity-hmac',
  1,
  randomBytes(32).toString('base64url'),
);
const IDENTITY_V2 = createWalletRegistrationKey(
  'identity-hmac',
  2,
  randomBytes(32).toString('base64url'),
);
const METADATA_V1 = createWalletRegistrationKey(
  'metadata-seal',
  1,
  randomBytes(32).toString('base64url'),
);
const METADATA_V2 = createWalletRegistrationKey(
  'metadata-seal',
  2,
  randomBytes(32).toString('base64url'),
);
const CONFIG: Pick<
  EnabledWalletRegistrationConfig,
  'registryEnvironment' | 'identityHmacKeys' | 'metadataSealKeys'
> = Object.freeze({
  registryEnvironment: 'MAINNET',
  identityHmacKeys: createWalletRegistrationKeyRing('identity-hmac', 2, [IDENTITY_V1, IDENTITY_V2]),
  metadataSealKeys: createWalletRegistrationKeyRing('metadata-seal', 2, [METADATA_V1, METADATA_V2]),
});

function repositoryWith(
  prepared: PreparedWalletMetadataRewrap | Readonly<{ status: 'completed' | 'invalid' }>,
): jest.Mocked<WalletMetadataRewrapRepositoryPort> {
  return {
    prepare: jest.fn().mockResolvedValue(prepared),
    complete: jest.fn().mockResolvedValue({ status: 'completed' }),
    retirementReadiness: jest.fn(),
  };
}

function preparedWallet(
  chainId: WalletOwnershipChainId,
  address: string,
  proofKind: 'EVM_EIP191_EOA' | 'SOLANA_ED25519',
  metadataPlaintext = JSON.stringify({
    schemaVersion: 1,
    proofKind,
    registryEnvironment: 'MAINNET',
    registryVersion: REGISTRY.version,
    registryFingerprintSha256: REGISTRY.fingerprintSha256,
  }),
): PreparedWalletMetadataRewrap {
  const addressDigest = digestWalletIdentity(IDENTITY_V1, chainId, address);
  const binding = {
    walletId: WALLET_ID,
    challengeId: CHALLENGE_ID,
    accountId: ACCOUNT_ID,
    networkId: chainId,
    addressDigest,
  } as const;
  return Object.freeze({
    status: 'prepared',
    commandId: COMMAND_ID,
    accountId: ACCOUNT_ID,
    walletId: WALLET_ID,
    registeredByChallengeId: CHALLENGE_ID,
    chainId,
    registry: Object.freeze({
      environment: 'MAINNET',
      version: REGISTRY.version,
      fingerprintSha256: REGISTRY.fingerprintSha256,
    }),
    addressDigest,
    verificationAddressDigest: digestWalletIdentity(IDENTITY_V2, chainId, address),
    encryptedAddress: sealWalletRegistrationValue(
      METADATA_V1,
      { ...binding, field: 'address' },
      address,
    ),
    encryptedMetadata: sealWalletRegistrationValue(
      METADATA_V1,
      { ...binding, field: 'metadata' },
      metadataPlaintext,
    ),
    preparedStateSha256: randomBytes(32).toString('hex'),
    expiresAt: new Date('2026-09-04T18:05:00.000Z'),
  });
}

describe('WalletMetadataRewrapCoordinator', () => {
  it.each([
    {
      chainId: 'eip155:1' as const,
      address: '0x1111111111111111111111111111111111111111',
      proofKind: 'EVM_EIP191_EOA' as const,
    },
    {
      chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const,
      address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      proofKind: 'SOLANA_ED25519' as const,
    },
  ])('opens, validates, and freshly reseals an exact $chainId wallet', async (fixture) => {
    const prepared = preparedWallet(fixture.chainId, fixture.address, fixture.proofKind);
    const repository = repositoryWith(prepared);
    const coordinator = new WalletMetadataRewrapCoordinator(repository, CONFIG);

    await expect(
      coordinator.rewrap({ commandId: COMMAND_ID, accountId: ACCOUNT_ID, walletId: WALLET_ID }),
    ).resolves.toEqual({ status: 'completed', commandId: COMMAND_ID });
    expect(repository.prepare).toHaveBeenCalledWith({
      commandId: COMMAND_ID,
      accountId: ACCOUNT_ID,
      walletId: WALLET_ID,
      targetKeyVersion: 2,
    });
    expect(repository.complete).toHaveBeenCalledTimes(1);
    const completion = repository.complete.mock.calls[0]?.[0];
    if (!completion) throw new Error('completion fixture missing');
    const binding = {
      walletId: WALLET_ID,
      challengeId: CHALLENGE_ID,
      accountId: ACCOUNT_ID,
      networkId: fixture.chainId,
      addressDigest: prepared.addressDigest,
    } as const;
    expect(completion.targetKeyVersion).toBe(2);
    expect(completion.encryptedAddress.keyVersion).toBe(2);
    expect(completion.encryptedMetadata.keyVersion).toBe(2);
    expect(completion.encryptedAddress.iv).not.toBe(prepared.encryptedAddress.iv);
    expect(completion.encryptedMetadata.iv).not.toBe(prepared.encryptedMetadata.iv);
    expect(completion.encryptedAddress.iv).not.toBe(completion.encryptedMetadata.iv);
    expect(
      openWalletRegistrationValue(
        METADATA_V2,
        { ...binding, field: 'address' },
        completion.encryptedAddress,
      ),
    ).toBe(fixture.address);
    expect(
      openWalletRegistrationValue(
        METADATA_V2,
        { ...binding, field: 'metadata' },
        completion.encryptedMetadata,
      ),
    ).toBe(
      JSON.stringify({
        schemaVersion: 1,
        proofKind: fixture.proofKind,
        registryEnvironment: 'MAINNET',
        registryVersion: REGISTRY.version,
        registryFingerprintSha256: REGISTRY.fingerprintSha256,
      }),
    );
    expect(JSON.stringify(completion)).not.toContain(fixture.address);
  });

  it('returns an idempotent completed result without opening or resealing anything', async () => {
    const repository = repositoryWith({ status: 'completed' });
    const coordinator = new WalletMetadataRewrapCoordinator(repository, CONFIG);

    await expect(
      coordinator.rewrap({ commandId: COMMAND_ID, accountId: ACCOUNT_ID, walletId: WALLET_ID }),
    ).resolves.toEqual({ status: 'completed', commandId: COMMAND_ID });
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it('rejects wrong AAD, inactive identity aliases, and non-exact schema-v1 metadata generically', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    const original = preparedWallet('eip155:1', address, 'EVM_EIP191_EOA');
    const extraMetadata = preparedWallet(
      'eip155:1',
      address,
      'EVM_EIP191_EOA',
      JSON.stringify({
        schemaVersion: 1,
        proofKind: 'EVM_EIP191_EOA',
        registryEnvironment: 'MAINNET',
        registryVersion: REGISTRY.version,
        registryFingerprintSha256: REGISTRY.fingerprintSha256,
        unexpected: true,
      }),
    );
    const cases: readonly PreparedWalletMetadataRewrap[] = [
      Object.freeze({ ...original, registeredByChallengeId: randomUUID() }),
      Object.freeze({
        ...original,
        verificationAddressDigest: digestWalletIdentity(
          IDENTITY_V2,
          'eip155:1',
          '0x2222222222222222222222222222222222222222',
        ),
      }),
      extraMetadata,
    ];

    for (const prepared of cases) {
      const repository = repositoryWith(prepared);
      const coordinator = new WalletMetadataRewrapCoordinator(repository, CONFIG);
      await expect(
        coordinator.rewrap({ commandId: COMMAND_ID, accountId: ACCOUNT_ID, walletId: WALLET_ID }),
      ).rejects.toMatchObject({
        name: 'WalletMetadataRewrapError',
        code: 'WALLET_METADATA_REWRAP_FAILED',
        message: 'Wallet metadata rewrap failed',
      });
      expect(repository.complete).not.toHaveBeenCalled();
    }
  });

  it('rejects malformed scope and sanitizes repository failures without leaking details', async () => {
    const repository = repositoryWith({ status: 'invalid' });
    repository.prepare.mockRejectedValueOnce(new Error('plaintext=secret-wallet-value'));
    const coordinator = new WalletMetadataRewrapCoordinator(repository, CONFIG);

    await expect(
      coordinator.rewrap({ commandId: COMMAND_ID, accountId: ACCOUNT_ID, walletId: WALLET_ID }),
    ).rejects.toEqual(new WalletMetadataRewrapError());
    const accessor = Object.defineProperty(
      { accountId: ACCOUNT_ID, walletId: WALLET_ID },
      'commandId',
      { enumerable: true, get: () => COMMAND_ID },
    );
    await expect(
      coordinator.rewrap(accessor as unknown as Parameters<typeof coordinator.rewrap>[0]),
    ).rejects.toEqual(new WalletMetadataRewrapError());
    expect(repository.prepare).toHaveBeenCalledTimes(1);
  });
});
