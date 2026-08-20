export class AccountProfileNotFoundError extends Error {
  constructor() {
    super('Account profile was not found');
    this.name = 'AccountProfileNotFoundError';
  }
}

export class AccountProfileVersionConflictError extends Error {
  constructor() {
    super('Account profile version did not match');
    this.name = 'AccountProfileVersionConflictError';
  }
}
