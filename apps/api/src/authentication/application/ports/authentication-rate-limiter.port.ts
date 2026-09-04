import type { AuthenticationDigestCandidates } from './authentication-repository.port';

export const AUTHENTICATION_RATE_LIMITER = Symbol('AUTHENTICATION_RATE_LIMITER');

export type AuthenticationRateLimitScope = 'CALLBACK' | 'LOGIN_START' | 'SESSION_ROTATE';

export type AuthenticationRateLimitDecision =
  | { readonly admitted: true; readonly remainingCount: number }
  | { readonly admitted: false; readonly retryAfterSeconds: number };

export interface AuthenticationRateLimitRequest {
  readonly scope: AuthenticationRateLimitScope;
  /** A server-authored digest; never a raw IP, subject, or session credential. */
  readonly subjectDigests: AuthenticationDigestCandidates;
  readonly windowSeconds: number;
  readonly limitCount: number;
  readonly correlationId: string;
}

export interface AuthenticationRateLimiterPort {
  admit(request: AuthenticationRateLimitRequest): Promise<AuthenticationRateLimitDecision>;
}
