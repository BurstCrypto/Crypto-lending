import {
  AuthenticationClientAddressConfigurationError,
  canonicalAuthenticationIpAddress,
  loadAuthenticationClientAddressConfig,
} from './authentication-client-address.config';

describe('authentication client-address configuration', () => {
  it('defaults to direct socket addressing', () => {
    expect(loadAuthenticationClientAddressConfig({})).toEqual({ mode: 'direct' });
  });

  it('does not allow dormant proxy ranges in direct mode', () => {
    expect(() =>
      loadAuthenticationClientAddressConfig({ AUTH_TRUSTED_PROXY_CIDRS: '10.0.0.0/8' }),
    ).toThrow(AuthenticationClientAddressConfigurationError);
  });

  it('loads a bounded, explicit IPv4 and IPv6 proxy allowlist', () => {
    expect(
      loadAuthenticationClientAddressConfig({
        AUTH_CLIENT_ADDRESS_MODE: 'trusted-single-proxy',
        AUTH_TRUSTED_PROXY_CIDRS: '10.0.0.0/8,2001:db8::/32,192.0.2.10',
      }),
    ).toEqual({
      mode: 'trusted-single-proxy',
      trustedProxyRanges: [
        { address: '10.0.0.0', prefixLength: 8, family: 'ipv4' },
        { address: '2001:db8::', prefixLength: 32, family: 'ipv6' },
        { address: '192.0.2.10', prefixLength: 32, family: 'ipv4' },
      ],
    });
  });

  it.each([
    {},
    { AUTH_TRUSTED_PROXY_CIDRS: '' },
    { AUTH_TRUSTED_PROXY_CIDRS: '10.0.0.0/8, 192.0.2.0/24' },
    { AUTH_TRUSTED_PROXY_CIDRS: '10.0.0.0/33' },
    { AUTH_TRUSTED_PROXY_CIDRS: '2001:0db8::/32' },
    { AUTH_TRUSTED_PROXY_CIDRS: '10.0.0.0/8,10.0.0.0/8' },
    { AUTH_TRUSTED_PROXY_CIDRS: 'not-an-ip' },
  ])('rejects an unsafe proxy-mode allowlist: %p', (extra) => {
    expect(() =>
      loadAuthenticationClientAddressConfig({
        AUTH_CLIENT_ADDRESS_MODE: 'trusted-single-proxy',
        ...extra,
      }),
    ).toThrow(AuthenticationClientAddressConfigurationError);
  });

  it('rejects unknown modes', () => {
    expect(() =>
      loadAuthenticationClientAddressConfig({ AUTH_CLIENT_ADDRESS_MODE: 'proxy' }),
    ).toThrow(AuthenticationClientAddressConfigurationError);
  });

  it('canonicalizes valid socket addresses without accepting ports or IPv4 shorthand', () => {
    expect(canonicalAuthenticationIpAddress('2001:0db8:0:0:0:0:0:1')).toBe('2001:db8::1');
    expect(canonicalAuthenticationIpAddress('192.0.2.4')).toBe('192.0.2.4');
    expect(canonicalAuthenticationIpAddress('192.0.2.4:443')).toBeNull();
    expect(canonicalAuthenticationIpAddress('192.0.2')).toBeNull();
  });
});
