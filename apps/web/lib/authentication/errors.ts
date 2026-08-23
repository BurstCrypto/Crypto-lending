export const AUTHENTICATION_ERROR_CODES = Object.freeze({
  rejected: 'AUTHENTICATION_REJECTED',
  unauthenticated: 'AUTHENTICATION_REQUIRED',
  unavailable: 'AUTHENTICATION_UNAVAILABLE',
} as const);

export class AuthenticationRejectedError extends Error {
  readonly code = AUTHENTICATION_ERROR_CODES.rejected;

  constructor() {
    super('Authentication request rejected');
    this.name = 'AuthenticationRejectedError';
  }
}

export class AuthenticationUnauthenticatedError extends Error {
  readonly code = AUTHENTICATION_ERROR_CODES.unauthenticated;

  constructor() {
    super('Authentication required');
    this.name = 'AuthenticationUnauthenticatedError';
  }
}

export class AuthenticationUnavailableError extends Error {
  readonly code = AUTHENTICATION_ERROR_CODES.unavailable;
  readonly retryAfterSeconds: number | undefined;

  constructor(retryAfterSeconds?: number) {
    super('Authentication unavailable');
    this.name = 'AuthenticationUnavailableError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
