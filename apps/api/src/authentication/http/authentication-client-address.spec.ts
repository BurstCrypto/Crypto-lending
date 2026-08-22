import type { AuthenticationClientAddressConfig } from '../infrastructure/config/authentication-client-address.config';
import {
  AuthenticationClientAddressRejectedError,
  AuthenticationClientAddressResolver,
  type AuthenticationClientAddressRequest,
} from './authentication-client-address';

function resolver(config: AuthenticationClientAddressConfig): AuthenticationClientAddressResolver {
  return new AuthenticationClientAddressResolver(config);
}

function proxiedRequest(
  peerAddress: string,
  forwardedAddress: unknown,
): AuthenticationClientAddressRequest {
  return {
    socket: { remoteAddress: peerAddress },
    headers: { 'x-forwarded-for': forwardedAddress },
    rawHeaders: ['Host', 'api.example.test', 'X-Forwarded-For', String(forwardedAddress)],
  };
}

describe('AuthenticationClientAddressResolver', () => {
  it('uses the canonical direct peer and ignores an untrusted forwarded header by default', () => {
    const direct = resolver({ mode: 'direct' });
    expect(
      direct.resolve({
        socket: { remoteAddress: '2001:0db8:0:0:0:0:0:1' },
        headers: { 'x-forwarded-for': '203.0.113.9, 198.51.100.8' },
        rawHeaders: ['X-Forwarded-For', '203.0.113.9', 'X-Forwarded-For', '198.51.100.8'],
      }),
    ).toBe('2001:db8::1');
  });

  it.each([undefined, 'not-an-ip', '192.0.2.1:443'])('rejects invalid direct peers: %p', (peer) => {
    const direct = resolver({ mode: 'direct' });
    expect(() => direct.resolve({ socket: { remoteAddress: peer } })).toThrow(
      AuthenticationClientAddressRejectedError,
    );
  });

  describe('trusted single proxy', () => {
    const config: AuthenticationClientAddressConfig = {
      mode: 'trusted-single-proxy',
      trustedProxyRanges: [
        { address: '10.0.0.0', prefixLength: 8, family: 'ipv4' },
        { address: '2001:db8::', prefixLength: 32, family: 'ipv6' },
      ],
    };

    it('accepts one canonical client IP only from an allowlisted immediate peer', () => {
      const trusted = resolver(config);
      expect(trusted.resolve(proxiedRequest('10.2.3.4', '198.51.100.7'))).toBe('198.51.100.7');
      expect(trusted.resolve(proxiedRequest('2001:db8::10', '2001:db8:abcd::7'))).toBe(
        '2001:db8:abcd::7',
      );
      expect(trusted.resolve(proxiedRequest('::ffff:10.2.3.4', '198.51.100.8'))).toBe(
        '198.51.100.8',
      );
    });

    it('rejects a forwarded IP from an untrusted immediate peer', () => {
      expect(() => resolver(config).resolve(proxiedRequest('192.0.2.10', '198.51.100.7'))).toThrow(
        AuthenticationClientAddressRejectedError,
      );
    });

    it.each([
      '198.51.100.7, 203.0.113.2',
      ' 198.51.100.7',
      '198.51.100.7 ',
      '198.051.100.7',
      '198.51.100.7:443',
      '2001:0db8::1',
      '[2001:db8::1]',
    ])('rejects a non-canonical or list-valued forwarded address: %p', (value) => {
      expect(() => resolver(config).resolve(proxiedRequest('10.2.3.4', value))).toThrow(
        AuthenticationClientAddressRejectedError,
      );
    });

    it('rejects missing, array-valued, case-ambiguous, and duplicate forwarded headers', () => {
      const trusted = resolver(config);
      const invalid: readonly AuthenticationClientAddressRequest[] = [
        { socket: { remoteAddress: '10.2.3.4' }, headers: {}, rawHeaders: [] },
        {
          socket: { remoteAddress: '10.2.3.4' },
          headers: { 'x-forwarded-for': ['198.51.100.7'] },
          rawHeaders: ['X-Forwarded-For', '198.51.100.7'],
        },
        {
          socket: { remoteAddress: '10.2.3.4' },
          headers: {
            'x-forwarded-for': '198.51.100.7',
            'X-Forwarded-For': '198.51.100.7',
          },
          rawHeaders: ['X-Forwarded-For', '198.51.100.7'],
        },
        {
          socket: { remoteAddress: '10.2.3.4' },
          headers: { 'x-forwarded-for': '198.51.100.7, 203.0.113.2' },
          rawHeaders: ['X-Forwarded-For', '198.51.100.7', 'X-Forwarded-For', '203.0.113.2'],
        },
      ];
      for (const request of invalid) {
        expect(() => trusted.resolve(request)).toThrow(AuthenticationClientAddressRejectedError);
      }
    });

    it('requires raw and normalized header views to agree', () => {
      const trusted = resolver(config);
      expect(() =>
        trusted.resolve({
          socket: { remoteAddress: '10.2.3.4' },
          headers: { 'x-forwarded-for': '198.51.100.7' },
          rawHeaders: ['X-Forwarded-For', '198.51.100.8'],
        }),
      ).toThrow(AuthenticationClientAddressRejectedError);
    });
  });
});
