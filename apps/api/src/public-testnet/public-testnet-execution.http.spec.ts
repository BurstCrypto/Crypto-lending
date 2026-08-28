jest.mock('rpc-websockets', () => ({ CommonClient: class {}, WebSocket: jest.fn() }));

import { of } from 'rxjs';

import { PUBLIC_TESTNET_CHAIN_ID } from './public-testnet-execution.constants';
import {
  PublicTestnetBodyError,
  PublicTestnetPrivacyInterceptor,
  parsePublicTestnetIntentBody,
  parsePublicTestnetIntentId,
  parsePublicTestnetSubmissionBody,
} from './public-testnet-execution.http';

const ACCOUNT = 'GvjoVKNjBvQcFaSKUW1gTE7DxhSpjHbE69umVR5nPuQp';
const SIGNATURE = '1'.repeat(64);

function intent(): Record<string, unknown> {
  return {
    portfolioSnapshotId: 'local-demo-portfolio:0123456789abcdef0123456789abcdef',
    selection: { kind: 'PRESET', presetId: 'BALANCED', liquidReserveBasisPoints: 0 },
    chainId: PUBLIC_TESTNET_CHAIN_ID,
    account: ACCOUNT,
  };
}

describe('public-testnet HTTP boundary', () => {
  it('accepts one canonical Solana account and one 64-byte base58 signature', () => {
    expect(parsePublicTestnetIntentBody(intent())).toEqual(intent());
    expect(parsePublicTestnetSubmissionBody({ signature: SIGNATURE })).toEqual({
      signature: SIGNATURE,
    });
  });

  it('rejects alternate chains, malformed keys, hashes, and extra fields', () => {
    expect(() => parsePublicTestnetIntentBody({ ...intent(), chainId: 'eip155:421614' })).toThrow(
      PublicTestnetBodyError,
    );
    expect(() => parsePublicTestnetIntentBody({ ...intent(), account: 'not-a-key' })).toThrow(
      PublicTestnetBodyError,
    );
    expect(() => parsePublicTestnetSubmissionBody({ signature: `0x${'a'.repeat(64)}` })).toThrow(
      PublicTestnetBodyError,
    );
    expect(() =>
      parsePublicTestnetSubmissionBody({ signature: SIGNATURE, rawTransaction: 'x' }),
    ).toThrow(PublicTestnetBodyError);
  });

  it('rejects inherited or accessor-authored request bodies', () => {
    expect(() => parsePublicTestnetIntentBody(Object.create(intent()))).toThrow(
      PublicTestnetBodyError,
    );
    const body = intent();
    Object.defineProperty(body, 'account', { enumerable: true, get: () => ACCOUNT });
    expect(() => parsePublicTestnetIntentBody(body)).toThrow(PublicTestnetBodyError);
  });

  it('accepts only canonical v4 intent ids', () => {
    expect(parsePublicTestnetIntentId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    expect(() => parsePublicTestnetIntentId('../intent')).toThrow(PublicTestnetBodyError);
  });

  it('sets private, origin-varying response headers', () => {
    const headers = new Map<string, string>();
    const context = {
      switchToHttp: () => ({
        getResponse: () => ({
          setHeader: (name: string, value: string) => headers.set(name, value),
        }),
      }),
    };
    const next = { handle: () => of(undefined) };
    new PublicTestnetPrivacyInterceptor().intercept(context as never, next).subscribe();
    expect(headers).toEqual(
      new Map([
        ['Cache-Control', 'private, no-store, max-age=0'],
        ['Vary', 'Cookie, Origin'],
        ['X-Crypto-Lending-Demo-Mode', 'public-testnet-local'],
      ]),
    );
  });
});
