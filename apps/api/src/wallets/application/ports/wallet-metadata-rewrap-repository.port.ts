import type { AccountId } from '../../../accounts/domain/account-profile';
import type { WalletOwnershipChainId } from '../../domain/wallet-identity';
import type {
  SealedWalletRegistrationValue,
  WalletRegistrationDigestReference,
} from '../../infrastructure/crypto/wallet-registration-crypto';
import type { WalletRegistryBinding } from './wallet-registration-repository.port';

export interface WalletMetadataRewrapScope {
  readonly commandId: string;
  readonly accountId: AccountId;
  readonly walletId: string;
  readonly targetKeyVersion: number;
}

export interface PreparedWalletMetadataRewrap {
  readonly status: 'prepared';
  readonly commandId: string;
  readonly accountId: AccountId;
  readonly walletId: string;
  readonly registeredByChallengeId: string;
  readonly chainId: WalletOwnershipChainId;
  readonly registry: WalletRegistryBinding;
  /** Immutable registration-time digest used by both original AES-GCM AAD values. */
  readonly addressDigest: WalletRegistrationDigestReference<'address'>;
  /** Database-policy-active identity alias used to validate the opened address. */
  readonly verificationAddressDigest: WalletRegistrationDigestReference<'address'>;
  readonly encryptedAddress: SealedWalletRegistrationValue;
  readonly encryptedMetadata: SealedWalletRegistrationValue;
  readonly preparedStateSha256: string;
  readonly expiresAt: Date;
}

export type PrepareWalletMetadataRewrapResult =
  PreparedWalletMetadataRewrap | Readonly<{ status: 'completed' | 'invalid' }>;

export interface CompleteWalletMetadataRewrapRequest extends WalletMetadataRewrapScope {
  readonly preparedStateSha256: string;
  readonly encryptedAddress: SealedWalletRegistrationValue;
  readonly encryptedMetadata: SealedWalletRegistrationValue;
}

export type CompleteWalletMetadataRewrapResult = Readonly<{
  readonly status: 'completed' | 'invalid';
}>;

export interface WalletMetadataSealKeyRetirementReadiness {
  readonly keyVersion: number;
  readonly registeredAddressCount: number;
  readonly registeredMetadataCount: number;
  readonly retainedChallengeCount: number;
  readonly unexpiredChallengeCount: number;
  readonly openRewrapCommandCount: number;
  readonly ready: boolean;
}

/**
 * Deliberately not registered in Nest. A separately reviewed operator workflow
 * must construct this boundary explicitly before any production rewrap.
 */
export interface WalletMetadataRewrapRepositoryPort {
  prepare(scope: WalletMetadataRewrapScope): Promise<PrepareWalletMetadataRewrapResult>;
  complete(
    request: CompleteWalletMetadataRewrapRequest,
  ): Promise<CompleteWalletMetadataRewrapResult>;
  retirementReadiness(keyVersion: number): Promise<WalletMetadataSealKeyRetirementReadiness>;
}
