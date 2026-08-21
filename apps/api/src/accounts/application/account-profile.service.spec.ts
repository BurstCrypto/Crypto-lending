import type { AccountProfile, UpdateAccountProfileInput } from '../domain/account-profile';
import { isAccountId, parseAccountId } from '../domain/account-profile';
import { loggingContext } from '../../infrastructure/logging';
import {
  AccountProfileNotFoundError,
  AccountProfileVersionConflictError,
} from './account-profile.errors';
import type { AccountProfileRepository } from './account-profile.repository.port';
import { AccountProfileService } from './account-profile.service';

const accountId = parseAccountId('123e4567-e89b-42d3-a456-426614174000');
const PROVISION_REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const UPDATE_REQUEST_ID = '00000000-0000-4000-8000-000000000002';
const profile: AccountProfile = {
  accountId,
  contactEmail: 'trey@example.com',
  contactPhone: null,
  declaredResidencyCountryCode: 'US',
  eligibilityStatus: 'UNKNOWN',
  version: 1,
  createdAt: new Date('2026-08-20T12:00:00.000Z'),
  updatedAt: new Date('2026-08-20T12:00:00.000Z'),
};

function repositoryStub(
  overrides: Partial<AccountProfileRepository> = {},
): jest.Mocked<AccountProfileRepository> {
  return {
    findByAccountId: jest.fn().mockResolvedValue(profile),
    provisionForAccount: jest.fn().mockResolvedValue(profile),
    update: jest.fn().mockResolvedValue({ status: 'updated', profile }),
    ...overrides,
  } as jest.Mocked<AccountProfileRepository>;
}

describe('AccountProfileService', () => {
  it('reads only the supplied trusted account ID', async () => {
    const repository = repositoryStub();
    const service = new AccountProfileService(repository);

    await expect(service.findSelf(accountId)).resolves.toEqual(profile);
    expect(repository.findByAccountId).toHaveBeenCalledWith(accountId);
  });

  it('reports an unmapped account without exposing another account', async () => {
    const repository = repositoryStub({ findByAccountId: jest.fn().mockResolvedValue(null) });
    const service = new AccountProfileService(repository);

    await expect(service.findSelf(accountId)).rejects.toBeInstanceOf(AccountProfileNotFoundError);
  });

  it('generates a new opaque UUIDv4 inside the trusted provisioning use case', async () => {
    const repository = repositoryStub();
    const service = new AccountProfileService(repository);
    const input = {
      contactEmail: 'new@example.com',
      contactPhone: null,
      declaredResidencyCountryCode: 'US',
      accountId,
    };

    await loggingContext.run({ correlationId: PROVISION_REQUEST_ID }, () =>
      service.provisionAccount(input),
    );

    expect(repository.provisionForAccount).toHaveBeenCalledTimes(1);
    const call = repository.provisionForAccount.mock.calls[0];
    if (!call) throw new Error('Expected one provisioning call');
    const [createInput, auditContext] = call;
    expect(isAccountId(createInput.accountId)).toBe(true);
    expect(createInput.accountId).not.toBe(accountId);
    expect(createInput).toEqual({
      accountId: createInput.accountId,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      declaredResidencyCountryCode: input.declaredResidencyCountryCode,
    });
    expect(auditContext).toEqual({
      actorAccountId: createInput.accountId,
      correlationId: PROVISION_REQUEST_ID,
    });
  });

  it('maps stale writes to an application conflict', async () => {
    const repository = repositoryStub({
      update: jest.fn().mockResolvedValue({ status: 'stale' }),
    });
    const service = new AccountProfileService(repository);
    const update: UpdateAccountProfileInput = { contactEmail: 'new@example.com' };

    await expect(service.updateSelf(accountId, 1, update)).rejects.toBeInstanceOf(
      AccountProfileVersionConflictError,
    );
  });

  it('passes only the trusted account ID and permitted fields to persistence', async () => {
    const nextProfile = { ...profile, contactPhone: '+13035550123', version: 2 };
    const repository = repositoryStub({
      update: jest.fn().mockResolvedValue({ status: 'updated', profile: nextProfile }),
    });
    const service = new AccountProfileService(repository);
    const update: UpdateAccountProfileInput = { contactPhone: '+13035550123' };

    await expect(
      loggingContext.run({ correlationId: UPDATE_REQUEST_ID }, () =>
        service.updateSelf(accountId, 1, update),
      ),
    ).resolves.toEqual(nextProfile);
    expect(repository.update).toHaveBeenCalledWith(accountId, 1, update, {
      actorAccountId: accountId,
      correlationId: UPDATE_REQUEST_ID,
    });
  });
});
