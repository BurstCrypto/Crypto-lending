import {
  isCanonicalSha256,
  sha256Bytes,
  sha256ClmaFp1,
  sha256Framed,
} from './mainnet-financial-action-signed-verification-digest';

describe('mainnet financial action signed-verification digests', () => {
  it('matches migration 0033 CLMA-FP-1 golden vectors across named and null fields', () => {
    expect(
      sha256ClmaFp1(
        'CRYPTO_LENDING:MAINNET_ACTION:PERSISTED_INTENT:FRAMED:v1',
        ['fingerprintEncodingVersion', 'intentId', 'networkId', 'amountAtomic'],
        ['1', '11111111-1111-4111-8111-111111111111', 'eip155:1', '1000000'],
      ),
    ).toBe('e672e31e8e43af4e842b455732232f6edcb398b4be16b0e2481127877781b16c');
    expect(
      sha256ClmaFp1(
        'CRYPTO_LENDING:MAINNET_ACTION:SNAPSHOT:FRAMED:v1',
        ['fingerprintEncodingVersion', 'previousSnapshotSha256'],
        ['1', null],
      ),
    ).toBe('0def9229fa93856e2f685e95123cb90b613697796da323feaf62830690099401');
  });

  it('rejects ambiguous, duplicate, oversized, and malformed frames', () => {
    const domain = 'CRYPTO_LENDING:MAINNET_ACTION:SNAPSHOT:FRAMED:v1';
    expect(() => sha256ClmaFp1(domain, [], [])).toThrow('Invalid CLMA-FP-1 frame.');
    expect(() => sha256ClmaFp1(domain, ['value'], ['1'])).toThrow('Invalid CLMA-FP-1 frame.');
    expect(() =>
      sha256ClmaFp1(
        domain,
        ['fingerprintEncodingVersion', 'duplicate', 'duplicate'],
        ['1', 'a', 'b'],
      ),
    ).toThrow('Invalid CLMA-FP-1 frame.');
    expect(() =>
      sha256ClmaFp1(domain, ['fingerprintEncodingVersion', 'value'], ['1', 'x'.repeat(16_385)]),
    ).toThrow('Invalid CLMA-FP-1 frame.');
    expect(
      sha256ClmaFp1(domain, ['fingerprintEncodingVersion', 'left', 'right'], ['1', 'ab', 'c']),
    ).not.toBe(
      sha256ClmaFp1(domain, ['fingerprintEncodingVersion', 'left', 'right'], ['1', 'a', 'bc']),
    );
  });

  it('retains the existing byte and unnamed framing contracts', () => {
    expect(isCanonicalSha256('a'.repeat(64))).toBe(true);
    expect(isCanonicalSha256('A'.repeat(64))).toBe(false);
    expect(sha256Bytes(Buffer.from('wire'))).toMatch(/^[0-9a-f]{64}$/u);
    expect(sha256Framed('domain', ['a', 'bc'])).not.toBe(sha256Framed('domain', ['ab', 'c']));
  });
});
