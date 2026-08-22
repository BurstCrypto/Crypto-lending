import {
  AuthenticationCallbackError,
  parseAuthenticationCallback,
  parseLocalReturnPath,
} from './authentication-callback';

describe('authentication callback parsing', () => {
  it('accepts one bounded code, state, and optional issuer', () => {
    expect(
      parseAuthenticationCallback(
        '/api/v1/auth/callback?code=abc&state=def&iss=https%3A%2F%2Fissuer.example',
      ),
    ).toEqual({
      kind: 'success',
      code: 'abc',
      state: 'def',
      issuer: 'https://issuer.example',
    });
  });

  it.each([
    '/callback?code=a&code=b&state=c',
    '/callback?code=a&state=b&state=c',
    '/callback?code=a&error=denied&state=b',
    '/callback?state=b',
    '/callback?error=denied',
  ])('rejects ambiguous or incomplete callbacks', (url) => {
    expect(() => parseAuthenticationCallback(url)).toThrow(AuthenticationCallbackError);
  });

  it('accepts only local, single-decoding return paths', () => {
    expect(parseLocalReturnPath('/account?tab=security')).toBe('/account?tab=security');
    for (const value of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/%2f%2fevil.example',
      '/%252f%252fevil.example',
      '/..//evil.example',
      '/path#fragment',
    ]) {
      expect(() => parseLocalReturnPath(value)).toThrow(AuthenticationCallbackError);
    }
  });
});
