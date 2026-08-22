export class AuthenticationRejectedError extends Error {
  readonly code = 'AUTHENTICATION_REJECTED' as const;

  constructor() {
    super('Authentication required');
    this.name = 'AuthenticationRejectedError';
  }
}

export class AuthenticationRateLimitedError extends Error {
  readonly code = 'AUTHENTICATION_RATE_LIMITED' as const;

  constructor(readonly retryAfterSeconds: number) {
    super('Authentication request rate limited');
    this.name = 'AuthenticationRateLimitedError';
    if (
      !Number.isSafeInteger(retryAfterSeconds) ||
      retryAfterSeconds < 1 ||
      retryAfterSeconds > 3600
    ) {
      throw new TypeError('retryAfterSeconds must be an integer between 1 and 3600');
    }
  }
}

export class AuthenticationUnavailableError extends Error {
  readonly code = 'AUTHENTICATION_UNAVAILABLE' as const;

  constructor() {
    super('Authentication service unavailable');
    this.name = 'AuthenticationUnavailableError';
  }
}

/** Marks a callback whose one-use transaction was definitively claimed. */
export class ClaimedAuthenticationRejectedError extends AuthenticationRejectedError {
  constructor() {
    super();
    this.name = 'ClaimedAuthenticationRejectedError';
  }
}

/** Marks a dependency failure after the callback transaction was claimed. */
export class ClaimedAuthenticationUnavailableError extends AuthenticationUnavailableError {
  constructor() {
    super();
    this.name = 'ClaimedAuthenticationUnavailableError';
  }
}
