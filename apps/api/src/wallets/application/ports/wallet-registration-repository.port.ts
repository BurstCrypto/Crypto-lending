import type { AccountId } from '../../../accounts/domain/account-profile';
import type { WalletChallengeId } from '../../domain/wallet-ownership-proof';
import type { WalletOwnershipChainId } from '../../domain/wallet-identity';
import type {
  SealedWalletRegistrationValue,
  WalletRegistrationDigestReference,
} from '../../infrastructure/crypto/wallet-registration-crypto';

export const WALLET_REGISTRATION_REPOSITORY = Symbol('WALLET_REGISTRATION_REPOSITORY');
export const MAX_ACTIVE_WALLET_REGISTRATIONS_PER_ACCOUNT = 32 as const;

export type WalletProofScheme =
  'EVM_ERC4361_ERC191' | 'SOLANA_SIWS_SIGN_IN' | 'SOLANA_SIWS_SIGN_MESSAGE';

export interface WalletRegistryBinding {
  readonly environment: 'MAINNET' | 'TESTNET';
  readonly version: number;
  readonly fingerprintSha256: string;
}

export interface BeginWalletOwnershipChallengeRequest {
  readonly challengeId: WalletChallengeId;
  readonly accountId: AccountId;
  readonly proofScheme: WalletProofScheme;
  readonly chainId: WalletOwnershipChainId;
  readonly addressDigest: WalletRegistrationDigestReference<'address'>;
  /**
   * Exact, version-sorted aliases for every accepted identity-HMAC key. The
   * persistence boundary admits the challenge only when this set matches its
   * schema-owner-controlled rotation policy.
   */
  readonly identityDigests: readonly WalletRegistrationDigestReference<'address'>[];
  readonly domainDigest: WalletRegistrationDigestReference<'domain'>;
  readonly messageDigest: WalletRegistrationDigestReference<'message'>;
  readonly nonceDigest: WalletRegistrationDigestReference<'nonce'>;
  readonly challengePayload: SealedWalletRegistrationValue;
  readonly registry: WalletRegistryBinding;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly correlationId: string;
}

export interface BegunWalletOwnershipChallenge {
  readonly challengeId: WalletChallengeId;
  readonly expiresAt: Date;
}

export interface PrepareWalletOwnershipChallengeRequest {
  readonly challengeId: WalletChallengeId;
  readonly accountId: AccountId;
  readonly correlationId: string;
}

export type PrepareWalletOwnershipChallengeResult =
  | Readonly<{
      status: 'pending';
      challengeId: WalletChallengeId;
      accountId: AccountId;
      proofScheme: WalletProofScheme;
      chainId: WalletOwnershipChainId;
      addressDigest: WalletRegistrationDigestReference<'address'>;
      domainDigest: WalletRegistrationDigestReference<'domain'>;
      messageDigest: WalletRegistrationDigestReference<'message'>;
      nonceDigest: WalletRegistrationDigestReference<'nonce'>;
      challengePayload: SealedWalletRegistrationValue;
      registry: WalletRegistryBinding;
      issuedAt: Date;
      expiresAt: Date;
    }>
  | Readonly<{ status: 'expired' | 'invalid' | 'replayed' }>;

export type WalletChallengeRejectionReason =
  | 'MALFORMED_PROOF'
  | 'SIGNATURE_INVALID'
  | 'WRONG_DOMAIN'
  | 'WRONG_USER'
  | 'WRONG_NETWORK'
  | 'WRONG_ADDRESS'
  | 'WRONG_MESSAGE'
  | 'WRONG_NONCE'
  | 'UNSUPPORTED_SCHEME';

export interface RejectWalletOwnershipChallengeRequest {
  readonly challengeId: WalletChallengeId;
  readonly accountId: AccountId;
  readonly reason: WalletChallengeRejectionReason;
  readonly correlationId: string;
}

export type RejectWalletOwnershipChallengeResult = Readonly<{
  readonly status: 'rejected' | 'expired' | 'invalid' | 'replayed';
}>;

export interface CompleteWalletRegistrationRequest {
  readonly challengeId: WalletChallengeId;
  readonly accountId: AccountId;
  readonly walletId: string;
  readonly encryptedAddress: SealedWalletRegistrationValue;
  readonly encryptedMetadata: SealedWalletRegistrationValue;
  readonly correlationId: string;
}

export interface ListActiveWalletRegistrationsRequest {
  readonly accountId: AccountId;
  /** When present, the repository must cancel and drain the physical read. */
  readonly signal?: AbortSignal;
}

export interface RevokeWalletRegistrationRequest {
  readonly accountId: AccountId;
  readonly walletId: string;
  readonly correlationId: string;
}

export type RevokeWalletRegistrationResult = Readonly<{
  /**
   * `unchanged` intentionally combines absent, already-revoked, and
   * differently-owned wallet identifiers so callers cannot enumerate them.
   */
  status: 'revoked' | 'unchanged';
}>;

/**
 * Persistence-only representation. Address plaintext remains sealed until the
 * account-scoped application service validates every registry and AAD binding.
 */
export interface ActiveWalletRegistrationRecord {
  readonly walletId: string;
  readonly accountId: AccountId;
  readonly registeredByChallengeId: WalletChallengeId;
  readonly chainId: WalletOwnershipChainId;
  readonly registry: WalletRegistryBinding;
  /** Immutable registration-time digest retained in AES-GCM AAD. */
  readonly addressDigest: WalletRegistrationDigestReference<'address'>;
  /** Current database-policy alias used to validate decrypted plaintext. */
  readonly verificationAddressDigest: WalletRegistrationDigestReference<'address'>;
  readonly encryptedAddress: SealedWalletRegistrationValue;
  readonly registeredAt: Date;
}

export type CompleteWalletRegistrationResult =
  | Readonly<{
      status: 'registered' | 'already_registered';
      walletId: string;
      registeredAt: Date;
    }>
  | Readonly<{
      status: 'expired' | 'invalid' | 'ownership_conflict' | 'replayed' | 'revoked';
    }>;

export interface WalletRegistrationRepositoryPort {
  listActiveWallets(
    request: ListActiveWalletRegistrationsRequest,
  ): Promise<readonly ActiveWalletRegistrationRecord[]>;
  revokeWallet(request: RevokeWalletRegistrationRequest): Promise<RevokeWalletRegistrationResult>;
  beginChallenge(
    request: BeginWalletOwnershipChallengeRequest,
  ): Promise<BegunWalletOwnershipChallenge>;
  prepareChallenge(
    request: PrepareWalletOwnershipChallengeRequest,
  ): Promise<PrepareWalletOwnershipChallengeResult>;
  rejectChallenge(
    request: RejectWalletOwnershipChallengeRequest,
  ): Promise<RejectWalletOwnershipChallengeResult>;
  completeRegistration(
    request: CompleteWalletRegistrationRequest,
  ): Promise<CompleteWalletRegistrationResult>;
}
