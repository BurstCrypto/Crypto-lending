import {
  AccountProfileValidationError,
  assertValidProfileVersion,
  isAccountId,
  isValidContactEmail,
  isValidContactPhone,
  isValidDeclaredResidencyCountryCode,
  normalizeContactEmail,
  normalizeContactPhone,
  normalizeDeclaredResidencyCountryCode,
  parseAccountId,
  UNKNOWN_ACCOUNT_ELIGIBILITY,
} from './account-profile';

describe('account profile domain', () => {
  describe('account IDs', () => {
    it('accepts a canonical UUIDv4', () => {
      const value = '0f27af0b-48b2-4f1b-b3d4-cd531a0b4458';
      expect(parseAccountId(value)).toBe(value);
      expect(isAccountId(value)).toBe(true);
    });

    it.each([
      undefined,
      null,
      '',
      '00000000-0000-0000-0000-000000000000',
      '018f8f77-90c4-7a4a-8c52-2b752b04a4d8',
      '0F27AF0B-48B2-4F1B-B3D4-CD531A0B4458',
      '0f27af0b-48b2-4f1b-73d4-cd531a0b4458',
      ' 0f27af0b-48b2-4f1b-b3d4-cd531a0b4458',
    ])('rejects a non-canonical account ID', (value) => {
      expect(() => parseAccountId(value)).toThrow(
        new AccountProfileValidationError('INVALID_ACCOUNT_ID'),
      );
      expect(isAccountId(value)).toBe(false);
    });
  });

  describe('contact email', () => {
    it('lowercases only the ASCII domain and preserves the local part', () => {
      expect(normalizeContactEmail('Case.Sensitive+tag@EXAMPLE.COM')).toBe(
        'Case.Sensitive+tag@example.com',
      );
    });

    it.each([
      null,
      undefined,
      '',
      ' user@example.com',
      'user@example.com ',
      'user\n@example.com',
      'usér@example.com',
      'user@éxample.com',
      '.user@example.com',
      'user.@example.com',
      'user..name@example.com',
      'user@@example.com',
      'user@example..com',
      'user@-example.com',
      'user@example-.com',
      '"user"@example.com',
      `${'a'.repeat(65)}@example.com`,
      `user@${'a'.repeat(64)}.com`,
    ])('rejects ambiguous or non-canonical email input', (value) => {
      expect(() => normalizeContactEmail(value)).toThrow(
        new AccountProfileValidationError('INVALID_CONTACT_EMAIL'),
      );
      expect(isValidContactEmail(value)).toBe(false);
    });
  });

  describe('optional phone', () => {
    it('accepts an omitted value, explicit clearing, or canonical E.164', () => {
      expect(normalizeContactPhone(undefined)).toBeUndefined();
      expect(normalizeContactPhone(null)).toBeNull();
      expect(normalizeContactPhone('+12')).toBe('+12');
      expect(normalizeContactPhone('+14155552671')).toBe('+14155552671');
      expect(isValidContactPhone('+442071838750')).toBe(true);
    });

    it.each(['', '+1', '14155552671', '+0123', '+1 415 555 2671', '+1-415-555-2671'])(
      'rejects a non-canonical optional phone',
      (value) => {
        expect(() => normalizeContactPhone(value)).toThrow(
          new AccountProfileValidationError('INVALID_CONTACT_PHONE'),
        );
        expect(isValidContactPhone(value)).toBe(false);
      },
    );
  });

  describe('declared residency', () => {
    it.each([
      ['US', 'US'],
      ['BQ', 'BQ'],
      ['SS', 'SS'],
    ])('canonicalizes an assigned ISO code %s to %s', (value, expected) => {
      expect(normalizeDeclaredResidencyCountryCode(value)).toBe(expected);
      expect(isValidDeclaredResidencyCountryCode(value)).toBe(true);
    });

    it.each(['', 'ca', 'Us', ' USA', 'USA', 'UK', 'XK', 'AN', 'SU', 'ZZ', 'UЅ', 'U\n'])(
      'rejects unofficial, deprecated, confusable, or malformed country codes',
      (value) => {
        expect(() => normalizeDeclaredResidencyCountryCode(value)).toThrow(
          new AccountProfileValidationError('INVALID_DECLARED_RESIDENCY'),
        );
        expect(isValidDeclaredResidencyCountryCode(value)).toBe(false);
      },
    );

    it('keeps profile eligibility fail-closed regardless of declared residency', () => {
      expect(UNKNOWN_ACCOUNT_ELIGIBILITY).toBe('UNKNOWN');
      expect(normalizeDeclaredResidencyCountryCode('US')).toBe('US');
    });
  });

  it.each([1, 42, 2_147_483_647])('accepts a bounded positive profile version', (value) => {
    expect(assertValidProfileVersion(value)).toBe(value);
  });

  it.each([undefined, null, 0, -1, 1.1, Number.NaN, 2_147_483_648])(
    'rejects an invalid profile version',
    (value) => {
      expect(() => assertValidProfileVersion(value)).toThrow(
        new AccountProfileValidationError('INVALID_PROFILE_VERSION'),
      );
    },
  );
});
