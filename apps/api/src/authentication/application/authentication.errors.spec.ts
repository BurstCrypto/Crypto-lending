import {
  AuthenticationRateLimitedError,
  AuthenticationRejectedError,
  AuthenticationUnavailableError,
} from './authentication.errors';

describe('authentication errors', () => {
  it('exposes only stable generic failure categories', () => {
    expect(new AuthenticationRejectedError()).toMatchObject({
      code: 'AUTHENTICATION_REJECTED',
      message: 'Authentication required',
    });
    expect(new AuthenticationUnavailableError()).toMatchObject({
      code: 'AUTHENTICATION_UNAVAILABLE',
      message: 'Authentication service unavailable',
    });
    expect(new AuthenticationRateLimitedError(30)).toMatchObject({
      code: 'AUTHENTICATION_RATE_LIMITED',
      retryAfterSeconds: 30,
    });
  });

  it('rejects unbounded Retry-After values', () => {
    expect(() => new AuthenticationRateLimitedError(0)).toThrow(TypeError);
    expect(() => new AuthenticationRateLimitedError(3601)).toThrow(TypeError);
  });
});
