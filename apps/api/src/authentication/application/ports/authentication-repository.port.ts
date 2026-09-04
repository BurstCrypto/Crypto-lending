import type {
  AccountId,
  ProvisionAccountProfileInput,
} from '../../../accounts/domain/account-profile';
import type { AuthenticationFlow, VerifiedOidcIdentity } from '../../domain/authentication';

export const AUTHENTICATION_REPOSITORY = Symbol('AUTHENTICATION_REPOSITORY');
/** Unkeyed pre-authentication digests retain their original fixed schema version. */
export const AUTHENTICATION_OPAQUE_DIGEST_VERSION = 1 as const;

/** A versioned, domain-separated 32-byte digest encoded as lowercase hex. */
export interface AuthenticationDigestReference {
  readonly version: number;
  readonly value: string;
}

export type AuthenticationDigestCandidates = readonly AuthenticationDigestReference[];

export interface BeginAuthenticationTransactionRequest {
  readonly transactionId: string;
  readonly flow: AuthenticationFlow;
  readonly issuer: string;
  readonly stateDigest: AuthenticationDigestReference;
  readonly browserBindingDigest: AuthenticationDigestReference;
  readonly nonceDigest: AuthenticationDigestReference;
  readonly ttlSeconds: number;
  readonly correlationId: string;
}

export interface BegunAuthenticationTransaction {
  readonly transactionId: string;
  readonly expiresAt: Date;
}

export interface ClaimAuthenticationTransactionRequest {
  readonly transactionId: string;
  readonly stateDigest: AuthenticationDigestReference;
  readonly browserBindingDigest: AuthenticationDigestReference;
  readonly correlationId: string;
}

export type ClaimAuthenticationTransactionResult =
  | {
      readonly status: 'claimed';
      readonly flow: AuthenticationFlow;
      readonly issuer: string;
      readonly nonceDigest: AuthenticationDigestReference;
    }
  | { readonly status: 'expired' | 'invalid' | 'replayed' };

export type ClaimedAuthenticationRejectionReason =
  'IDENTITY_INVALID' | 'PROVIDER_ERROR' | 'TOKEN_INVALID';

export interface RejectClaimedAuthenticationTransactionRequest {
  readonly transactionId: string;
  readonly reason: ClaimedAuthenticationRejectionReason;
  readonly correlationId: string;
}

export type RejectClaimedAuthenticationTransactionResult =
  { readonly status: 'rejected' } | { readonly status: 'invalid' | 'replayed' };

/**
 * Identity mapping and first session issuance are one repository operation. The
 * adapter must preserve that atomic boundary under concurrent first callbacks.
 */
interface CompleteAuthenticationLoginBaseRequest {
  readonly transactionId: string;
  readonly identity: VerifiedOidcIdentity;
  readonly nonceDigest: AuthenticationDigestReference;
  readonly subjectDigests: AuthenticationDigestCandidates;
  readonly proposedAccountId: AccountId;
  readonly proposedIdentityId: string;
  readonly proposedSessionFamilyId: string;
  readonly proposedCredentialId: string;
  readonly credentialDigest: AuthenticationDigestReference;
  readonly csrfDigest: AuthenticationDigestReference;
  readonly idleTtlSeconds: number;
  readonly absoluteTtlSeconds: number;
  readonly correlationId: string;
}

export type CompleteAuthenticationLoginRequest = CompleteAuthenticationLoginBaseRequest &
  (
    | { readonly flow: 'login'; readonly registration?: never }
    | { readonly flow: 'registration'; readonly registration: ProvisionAccountProfileInput }
  );

export type CompleteAuthenticationLoginResult =
  | {
      readonly status: 'authenticated';
      readonly accountId: AccountId;
      readonly sessionFamilyId: string;
      readonly credentialId: string;
      readonly idleExpiresAt: Date;
      readonly absoluteExpiresAt: Date;
    }
  | { readonly status: 'rejected' };

export type AuthenticationSessionRejection = 'expired' | 'invalid' | 'replayed' | 'revoked';

export type ResolveAuthenticationSessionResult =
  | {
      readonly status: 'authenticated';
      readonly accountId: AccountId;
      readonly sessionFamilyId: string;
    }
  | { readonly status: AuthenticationSessionRejection };

export type AuthenticationCsrfValidation =
  | { readonly required: false }
  | { readonly required: true; readonly digests: AuthenticationDigestCandidates };

export interface ResolveAuthenticationSessionRequest {
  readonly credentialId: string;
  readonly credentialDigests: AuthenticationDigestCandidates;
  readonly csrf: AuthenticationCsrfValidation;
  readonly correlationId: string;
}

export interface RotateAuthenticationSessionRequest {
  readonly credentialId: string;
  readonly credentialDigests: AuthenticationDigestCandidates;
  readonly successorCredentialId: string;
  readonly successorCredentialDigest: AuthenticationDigestReference;
  readonly successorCsrfDigest: AuthenticationDigestReference;
  readonly correlationId: string;
}

export type RotateAuthenticationSessionResult =
  | {
      readonly status: 'rotated';
      readonly credentialId: string;
      readonly expiresAt: Date;
    }
  | { readonly status: 'invalid' | 'replayed' };

export interface RevokeAuthenticationSessionRequest {
  readonly credentialId: string;
  readonly credentialDigests: AuthenticationDigestCandidates;
  readonly correlationId: string;
}

export type RevokeAuthenticationSessionResult =
  { readonly status: 'revoked' } | { readonly status: 'invalid' | 'replayed' };

export interface AuthenticationRepositoryPort {
  beginTransaction(
    request: BeginAuthenticationTransactionRequest,
  ): Promise<BegunAuthenticationTransaction>;
  claimTransaction(
    request: ClaimAuthenticationTransactionRequest,
  ): Promise<ClaimAuthenticationTransactionResult>;
  rejectClaimedTransaction(
    request: RejectClaimedAuthenticationTransactionRequest,
  ): Promise<RejectClaimedAuthenticationTransactionResult>;
  completeLogin(
    request: CompleteAuthenticationLoginRequest,
  ): Promise<CompleteAuthenticationLoginResult>;
  resolveSession(
    request: ResolveAuthenticationSessionRequest,
  ): Promise<ResolveAuthenticationSessionResult>;
  rotateSession(
    request: RotateAuthenticationSessionRequest,
  ): Promise<RotateAuthenticationSessionResult>;
  revokeSession(
    request: RevokeAuthenticationSessionRequest,
  ): Promise<RevokeAuthenticationSessionResult>;
}
