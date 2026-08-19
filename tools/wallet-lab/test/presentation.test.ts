import { describe, expect, it } from 'vitest';

import { sanitizeEvmWalletError, shortenWalletAddress } from '../src/presentation';

describe('wallet lab presentation boundary', () => {
  it('maps provider failures without retaining untrusted messages', () => {
    const error = { code: 4001, message: 'wc:secret-topic and 0xfulladdress' };

    expect(sanitizeEvmWalletError(error)).toEqual({
      code: 'user-rejected',
      message: 'The wallet request was rejected.',
    });
  });

  it('does not touch hostile getters while mapping an unknown error', () => {
    const error = Object.create(null, {
      message: {
        get() {
          throw new Error('must not read');
        },
      },
    });

    expect(sanitizeEvmWalletError(error).code).toBe('request-failed');
  });

  it('shortens a display address without changing short identifiers', () => {
    expect(shortenWalletAddress('0x1234567890abcdef1234')).toBe('0x123456…ef1234');
    expect(shortenWalletAddress('short')).toBe('short');
  });
});
