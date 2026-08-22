import type {
  OpaqueAuthenticationSecret,
  PkceVerifier,
  VerifiedOidcIdentity,
} from '../../domain/authentication';

export const OIDC_CLIENT = Symbol('OIDC_CLIENT');

export interface CreateOidcAuthorizationUrlRequest {
  readonly state: OpaqueAuthenticationSecret<'oidc-state'>;
  readonly nonce: OpaqueAuthenticationSecret<'oidc-nonce'>;
  readonly codeChallenge: string;
}

export interface ExchangeOidcAuthorizationCodeRequest {
  readonly code: string;
  readonly codeVerifier: PkceVerifier;
  readonly expectedNonce: OpaqueAuthenticationSecret<'oidc-nonce'>;
}

export interface OidcClientPort {
  createAuthorizationUrl(request: CreateOidcAuthorizationUrlRequest): URL;
  exchangeAuthorizationCode(
    request: ExchangeOidcAuthorizationCodeRequest,
  ): Promise<VerifiedOidcIdentity>;
}
