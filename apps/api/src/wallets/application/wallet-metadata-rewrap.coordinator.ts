import { parseAccountId, type AccountId } from '../../accounts/domain/account-profile';
import { supportedAssetRegistryForEnvironment } from '../../blockchain/domain/supported-asset-registry';
import { isCanonicalUuidV4 } from '../../infrastructure/logging';
import {
  type CompleteWalletMetadataRewrapRequest,
  type WalletMetadataRewrapRepositoryPort,
} from './ports/wallet-metadata-rewrap-repository.port';
import { parseWalletAddress, walletNamespaceOf } from '../domain/wallet-identity';
import type { EnabledWalletRegistrationConfig } from '../infrastructure/config/wallet-registration.config';
import {
  activeWalletRegistrationKey,
  digestWalletIdentity,
  openWalletRegistrationValue,
  sealWalletRegistrationValue,
  walletRegistrationDigestEquals,
  walletRegistrationKeyForVersion,
} from '../infrastructure/crypto/wallet-registration-crypto';

const LOWER_HEX_SHA256 = /^[0-9a-f]{64}$/u;
const MAINNET_NETWORKS = Object.freeze([
  'eip155:1',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
] as const);

type MainnetNetworkId = (typeof MAINNET_NETWORKS)[number];

export interface WalletMetadataRewrapInput {
  readonly commandId: string;
  readonly accountId: AccountId;
  readonly walletId: string;
}

export type WalletMetadataRewrapResult = Readonly<{
  readonly status: 'completed';
  readonly commandId: string;
}>;

interface WalletMetadataV1 {
  readonly schemaVersion: 1;
  readonly proofKind: 'EVM_EIP191_EOA' | 'SOLANA_ED25519';
  readonly registryEnvironment: 'MAINNET';
  readonly registryVersion: 1;
  readonly registryFingerprintSha256: string;
}

export class WalletMetadataRewrapError extends Error {
  readonly code = 'WALLET_METADATA_REWRAP_FAILED' as const;

  constructor() {
    super('Wallet metadata rewrap failed');
    this.name = 'WalletMetadataRewrapError';
  }
}

function fail(): never {
  throw new WalletMetadataRewrapError();
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
  const ownKeys = Reflect.ownKeys(descriptors);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return false;
  }
  return keys.every((key) => {
    const descriptor = descriptors[key];
    return descriptor?.enumerable === true && 'value' in descriptor;
  });
}

function exactInput(value: WalletMetadataRewrapInput): Readonly<{
  commandId: string;
  accountId: AccountId;
  walletId: string;
}> {
  try {
    if (!exactObject(value, ['commandId', 'accountId', 'walletId'])) return fail();
    const commandId = value.commandId;
    const accountId = parseAccountId(value.accountId);
    const walletId = value.walletId;
    if (!isCanonicalUuidV4(commandId) || !isCanonicalUuidV4(walletId)) return fail();
    return Object.freeze({ commandId, accountId, walletId });
  } catch (error) {
    if (error instanceof WalletMetadataRewrapError) throw error;
    return fail();
  }
}

function mainnetNetwork(value: unknown): MainnetNetworkId {
  if (typeof value !== 'string' || !(MAINNET_NETWORKS as readonly string[]).includes(value)) {
    return fail();
  }
  return value as MainnetNetworkId;
}

function parseMetadataV1(value: string, networkId: MainnetNetworkId): WalletMetadataV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return fail();
  }
  if (
    !exactObject(parsed, [
      'schemaVersion',
      'proofKind',
      'registryEnvironment',
      'registryVersion',
      'registryFingerprintSha256',
    ]) ||
    parsed.schemaVersion !== 1 ||
    (parsed.proofKind !== 'EVM_EIP191_EOA' && parsed.proofKind !== 'SOLANA_ED25519') ||
    parsed.registryEnvironment !== 'MAINNET' ||
    parsed.registryVersion !== 1 ||
    typeof parsed.registryFingerprintSha256 !== 'string' ||
    !LOWER_HEX_SHA256.test(parsed.registryFingerprintSha256) ||
    (walletNamespaceOf(networkId) === 'eip155') !== (parsed.proofKind === 'EVM_EIP191_EOA') ||
    JSON.stringify(parsed) !== value
  ) {
    return fail();
  }
  return parsed as unknown as WalletMetadataV1;
}

/**
 * Dormant one-wallet coordinator. It has no controller, CLI, schedule, module
 * provider, logger, external transport, or secret loader of its own.
 */
export class WalletMetadataRewrapCoordinator {
  constructor(
    private readonly repository: WalletMetadataRewrapRepositoryPort,
    private readonly config: Pick<
      EnabledWalletRegistrationConfig,
      'registryEnvironment' | 'identityHmacKeys' | 'metadataSealKeys'
    >,
  ) {}

  async rewrap(inputValue: WalletMetadataRewrapInput): Promise<WalletMetadataRewrapResult> {
    try {
      const input = exactInput(inputValue);
      if (this.config.registryEnvironment !== 'MAINNET') return fail();
      const targetKey = activeWalletRegistrationKey(this.config.metadataSealKeys);
      const prepared = await this.repository.prepare({
        ...input,
        targetKeyVersion: targetKey.version,
      });
      if (prepared.status === 'completed') {
        return Object.freeze({ status: 'completed', commandId: input.commandId });
      }
      if (prepared.status !== 'prepared') return fail();

      const networkId = mainnetNetwork(prepared.chainId);
      const currentRegistry = supportedAssetRegistryForEnvironment('MAINNET').latest;
      if (
        prepared.commandId !== input.commandId ||
        prepared.accountId !== input.accountId ||
        prepared.walletId !== input.walletId ||
        prepared.registry.environment !== 'MAINNET' ||
        prepared.registry.version !== currentRegistry.version ||
        prepared.registry.fingerprintSha256 !== currentRegistry.fingerprintSha256 ||
        !LOWER_HEX_SHA256.test(prepared.preparedStateSha256) ||
        !(prepared.expiresAt instanceof Date) ||
        !Number.isFinite(prepared.expiresAt.getTime()) ||
        prepared.encryptedAddress.keyVersion >= targetKey.version ||
        prepared.encryptedMetadata.keyVersion >= targetKey.version ||
        prepared.verificationAddressDigest.version !==
          this.config.identityHmacKeys.activeWriteVersion
      ) {
        return fail();
      }

      const sealBase = Object.freeze({
        walletId: prepared.walletId,
        challengeId: prepared.registeredByChallengeId,
        accountId: prepared.accountId,
        networkId,
        addressDigest: prepared.addressDigest,
      });
      const address = openWalletRegistrationValue(
        walletRegistrationKeyForVersion(
          this.config.metadataSealKeys,
          prepared.encryptedAddress.keyVersion,
        ),
        { ...sealBase, field: 'address' },
        prepared.encryptedAddress,
      );
      const canonicalAddress = parseWalletAddress(networkId, address);
      if (
        canonicalAddress !== address ||
        !walletRegistrationDigestEquals(
          prepared.verificationAddressDigest,
          digestWalletIdentity(
            walletRegistrationKeyForVersion(
              this.config.identityHmacKeys,
              prepared.verificationAddressDigest.version,
            ),
            networkId,
            canonicalAddress,
          ),
        )
      ) {
        return fail();
      }

      const metadataPlaintext = openWalletRegistrationValue(
        walletRegistrationKeyForVersion(
          this.config.metadataSealKeys,
          prepared.encryptedMetadata.keyVersion,
        ),
        { ...sealBase, field: 'metadata' },
        prepared.encryptedMetadata,
      );
      const metadata = parseMetadataV1(metadataPlaintext, networkId);
      if (
        metadata.registryVersion !== prepared.registry.version ||
        metadata.registryFingerprintSha256 !== prepared.registry.fingerprintSha256
      ) {
        return fail();
      }

      const completion: CompleteWalletMetadataRewrapRequest = Object.freeze({
        ...input,
        targetKeyVersion: targetKey.version,
        preparedStateSha256: prepared.preparedStateSha256,
        encryptedAddress: sealWalletRegistrationValue(
          targetKey,
          { ...sealBase, field: 'address' },
          canonicalAddress,
        ),
        encryptedMetadata: sealWalletRegistrationValue(
          targetKey,
          { ...sealBase, field: 'metadata' },
          metadataPlaintext,
        ),
      });
      const completed = await this.repository.complete(completion);
      if (completed.status !== 'completed') return fail();
      return Object.freeze({ status: 'completed', commandId: input.commandId });
    } catch (error) {
      if (error instanceof WalletMetadataRewrapError) throw error;
      return fail();
    }
  }
}
