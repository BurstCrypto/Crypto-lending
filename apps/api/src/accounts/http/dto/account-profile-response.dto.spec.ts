import {
  parseAccountId,
  UNKNOWN_ACCOUNT_ELIGIBILITY,
  type AccountProfile,
} from '../../domain/account-profile';
import { AccountProfileResponseDto } from './account-profile-response.dto';

describe('AccountProfileResponseDto', () => {
  it('projects only the explicit public profile contract', () => {
    const response = new AccountProfileResponseDto({
      accountId: parseAccountId('0f27af0b-48b2-4f1b-b3d4-cd531a0b4458'),
      contactEmail: 'Case.Sensitive@example.com',
      contactPhone: null,
      createdAt: new Date('2026-08-20T16:00:00.000Z'),
      declaredResidencyCountryCode: 'CA',
      eligibilityStatus: UNKNOWN_ACCOUNT_ELIGIBILITY,
      updatedAt: new Date('2026-08-20T17:00:00.000Z'),
      version: 3,
      internalProviderSubject: 'must-not-leak',
    } as AccountProfile & { readonly internalProviderSubject: string });

    expect(response).toEqual({
      accountId: '0f27af0b-48b2-4f1b-b3d4-cd531a0b4458',
      contactEmail: 'Case.Sensitive@example.com',
      contactPhone: null,
      createdAt: '2026-08-20T16:00:00.000Z',
      declaredResidencyCountryCode: 'CA',
      eligibilityStatus: 'UNKNOWN',
      updatedAt: '2026-08-20T17:00:00.000Z',
      version: 3,
    });
    expect(JSON.stringify(response)).not.toContain('must-not-leak');
    expect(Object.isFrozen(response)).toBe(true);
  });
});
