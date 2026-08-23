export class WalletRegistrationRejectedError extends Error {
  readonly code = 'WALLET_REGISTRATION_REJECTED' as const;

  constructor() {
    super('Wallet registration request rejected');
    this.name = 'WalletRegistrationRejectedError';
  }
}

export class WalletOwnershipConflictError extends Error {
  readonly code = 'WALLET_OWNERSHIP_CONFLICT' as const;

  constructor() {
    super('Wallet ownership conflicts with an existing registration');
    this.name = 'WalletOwnershipConflictError';
  }
}

export class WalletRegistrationUnavailableError extends Error {
  readonly code = 'WALLET_REGISTRATION_UNAVAILABLE' as const;

  constructor() {
    super('Wallet registration is unavailable');
    this.name = 'WalletRegistrationUnavailableError';
  }
}

export class WalletRegistrationRateLimitedError extends Error {
  readonly code = 'WALLET_REGISTRATION_RATE_LIMITED' as const;

  constructor(readonly retryAfterSeconds: number) {
    super('Wallet registration request rate limited');
    this.name = 'WalletRegistrationRateLimitedError';
  }
}
