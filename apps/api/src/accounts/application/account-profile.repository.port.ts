import type {
  AccountId,
  AccountProfile,
  CreateAccountProfileInput,
  UpdateAccountProfileInput,
} from '../domain/account-profile';

export const ACCOUNT_PROFILE_REPOSITORY = Symbol('ACCOUNT_PROFILE_REPOSITORY');

export interface AccountProfileAuditContext {
  readonly actorAccountId: AccountId;
  readonly correlationId: string;
}

export type AccountProfileUpdateResult =
  | { readonly status: 'updated'; readonly profile: AccountProfile }
  | { readonly status: 'not-found' }
  | { readonly status: 'stale' };

export interface AccountProfileRepository {
  findByAccountId(accountId: AccountId): Promise<AccountProfile | null>;

  provisionForAccount(
    input: CreateAccountProfileInput,
    auditContext: AccountProfileAuditContext,
  ): Promise<AccountProfile>;

  update(
    accountId: AccountId,
    expectedVersion: number,
    input: UpdateAccountProfileInput,
    auditContext: AccountProfileAuditContext,
  ): Promise<AccountProfileUpdateResult>;
}
