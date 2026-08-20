import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  parseAccountId,
  type AccountId,
  type AccountProfile,
  type ProvisionAccountProfileInput,
  type UpdateAccountProfileInput,
} from '../domain/account-profile';
import {
  ACCOUNT_PROFILE_REPOSITORY,
  type AccountProfileRepository,
} from './account-profile.repository.port';
import {
  AccountProfileNotFoundError,
  AccountProfileVersionConflictError,
} from './account-profile.errors';

@Injectable()
export class AccountProfileService {
  constructor(
    @Inject(ACCOUNT_PROFILE_REPOSITORY)
    private readonly repository: AccountProfileRepository,
  ) {}

  async findSelf(accountId: AccountId): Promise<AccountProfile> {
    const profile = await this.repository.findByAccountId(accountId);
    if (!profile) {
      throw new AccountProfileNotFoundError();
    }
    return profile;
  }

  /** Internal handoff for identity provisioning; intentionally not an HTTP endpoint. */
  provisionAccount(input: ProvisionAccountProfileInput): Promise<AccountProfile> {
    const accountId = parseAccountId(randomUUID());
    return this.repository.provisionForAccount(
      {
        accountId,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        declaredResidencyCountryCode: input.declaredResidencyCountryCode,
      },
      {
        actorAccountId: accountId,
        correlationId: randomUUID(),
      },
    );
  }

  async updateSelf(
    accountId: AccountId,
    expectedVersion: number,
    input: UpdateAccountProfileInput,
  ): Promise<AccountProfile> {
    const result = await this.repository.update(accountId, expectedVersion, input, {
      actorAccountId: accountId,
      correlationId: randomUUID(),
    });

    if (result.status === 'not-found') {
      throw new AccountProfileNotFoundError();
    }
    if (result.status === 'stale') {
      throw new AccountProfileVersionConflictError();
    }
    return result.profile;
  }
}
