import {
  AuthenticationDomainError,
  parseOidcProviderKey,
  parseOidcSubject,
  parsePreAuthenticationTransactionCookiePayload,
} from './authentication';

const SECRET = 'a'.repeat(43);

describe('authentication domain values', () => {
  it('preserves exact case-sensitive OIDC subjects', () => {
    expect(parseOidcProviderKey('primary_oidc')).toBe('primary_oidc');
    expect(parseOidcSubject('Case-Sensitive.Provider.Subject')).toBe(
      'Case-Sensitive.Provider.Subject',
    );
  });

  it.each(['', 'UPPER', 'has space', 'a'.repeat(33)])(
    'rejects an invalid provider key without reflecting it: %j',
    (value) => {
      expect(() => parseOidcProviderKey(value)).toThrow(AuthenticationDomainError);
      try {
        parseOidcProviderKey(value);
      } catch (error) {
        if (value) expect(String(error)).not.toContain(value);
      }
    },
  );

  it.each(['', ' leading', 'trailing ', 'line\nbreak', 'a'.repeat(256)])(
    'rejects an invalid or unbounded subject',
    (value) => expect(() => parseOidcSubject(value)).toThrow(AuthenticationDomainError),
  );

  it('parses an exact, bounded pre-authentication transaction payload', () => {
    const payload = parsePreAuthenticationTransactionCookiePayload({
      version: 1,
      transactionId: '00000000-0000-4000-8000-000000000001',
      flow: 'login',
      state: SECRET,
      browserBinding: SECRET,
      nonce: SECRET,
      codeVerifier: SECRET,
      returnPath: '/dashboard?welcome=1',
      issuedAtEpochSeconds: 1_000,
      expiresAtEpochSeconds: 1_300,
    });

    expect(payload).toMatchObject({ flow: 'login', expiresAtEpochSeconds: 1_300 });
    expect(Object.isFrozen(payload)).toBe(true);
  });

  it('normalizes registration data with the account domain rules', () => {
    const payload = parsePreAuthenticationTransactionCookiePayload({
      version: 1,
      transactionId: '00000000-0000-4000-8000-000000000001',
      flow: 'registration',
      state: SECRET,
      browserBinding: SECRET,
      nonce: SECRET,
      codeVerifier: SECRET,
      returnPath: '/dashboard',
      registration: {
        contactEmail: 'Person@EXAMPLE.TEST',
        contactPhone: '+15555550123',
        declaredResidencyCountryCode: 'US',
      },
      issuedAtEpochSeconds: 1_000,
      expiresAtEpochSeconds: 1_300,
    });

    expect(payload.registration).toEqual({
      contactEmail: 'Person@example.test',
      contactPhone: '+15555550123',
      declaredResidencyCountryCode: 'US',
    });
  });

  it.each([
    { extra: true },
    { expiresAtEpochSeconds: 1_000 },
    { expiresAtEpochSeconds: 2_000 },
    { state: 'short' },
    { transactionId: 'not-a-uuid' },
    {
      registration: {
        contactEmail: 'a@@b',
        contactPhone: null,
        declaredResidencyCountryCode: 'US',
      },
    },
    {
      registration: {
        contactEmail: 'person@example.test',
        contactPhone: null,
        declaredResidencyCountryCode: 'ZZ',
      },
    },
  ])('rejects malformed pre-authentication transaction data', (replacement) => {
    expect(() =>
      parsePreAuthenticationTransactionCookiePayload({
        version: 1,
        transactionId: '00000000-0000-4000-8000-000000000001',
        flow: 'registration',
        state: SECRET,
        browserBinding: SECRET,
        nonce: SECRET,
        codeVerifier: SECRET,
        returnPath: '/dashboard',
        registration: {
          contactEmail: 'person@example.test',
          contactPhone: null,
          declaredResidencyCountryCode: 'US',
        },
        issuedAtEpochSeconds: 1_000,
        expiresAtEpochSeconds: 1_300,
        ...replacement,
      }),
    ).toThrow(AuthenticationDomainError);
  });

  it.each([
    '/..//evil.example',
    '/safe/..//evil.example',
    '/.//evil.example',
    '/%2e%2e//evil.example',
  ])('rejects a return path that normalizes to a scheme-relative redirect: %s', (returnPath) => {
    expect(() =>
      parsePreAuthenticationTransactionCookiePayload({
        version: 1,
        transactionId: '00000000-0000-4000-8000-000000000001',
        flow: 'login',
        state: SECRET,
        browserBinding: SECRET,
        nonce: SECRET,
        codeVerifier: SECRET,
        returnPath,
        issuedAtEpochSeconds: 1_000,
        expiresAtEpochSeconds: 1_300,
      }),
    ).toThrow(AuthenticationDomainError);
  });
});
