import { describe, expect, it } from 'vitest';

import {
  assertOwnershipChallenge,
  assertOwnershipChallengeTargetsConnection,
  assertOwnershipSignatureMatchesChallenge,
  assertWalletConnection,
  base64UrlToWalletBytes,
  toOwnershipSignatureWire,
  walletBytesToBase64Url,
  type SiweOwnershipChallenge,
  type WalletConnection,
  type WalletEvent,
} from '../lib/wallets/wallet-adapter';

const accountA = {
  chainId: 'eip155:11155111',
  address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
} as const;

const accountB = {
  chainId: 'eip155:84532',
  address: '0x0000000000000000000000000000000000000002',
} as const;

function connection(overrides: Partial<WalletConnection> = {}): WalletConnection {
  return {
    connectionId: 'connection-2',
    connectorId: 'metamask',
    transportSessionId: 'session-1',
    accounts: [accountA, accountB],
    approvedScopes: [
      {
        chainId: accountA.chainId,
        methods: ['personal_sign'],
        events: ['accountsChanged', 'chainChanged'],
      },
      {
        chainId: accountB.chainId,
        methods: ['personal_sign'],
        events: ['accountsChanged', 'chainChanged'],
      },
    ],
    selectedAccount: accountB,
    restored: false,
    ...overrides,
  };
}

function challenge(overrides: Partial<SiweOwnershipChallenge> = {}): SiweOwnershipChallenge {
  return {
    id: 'challenge-1',
    format: 'siwe',
    chainId: accountB.chainId,
    address: accountB.address,
    message: 'example.test wants you to sign in with your Ethereum account',
    nonce: 'nonce12345678',
    expiresAt: '2026-08-18T18:00:00.000Z',
    ...overrides,
  };
}

describe('wallet adapter contract', () => {
  it('accepts an explicitly selected account that is not the first account', () => {
    const candidate: unknown = connection();

    assertWalletConnection(candidate, 'eip155');
    expect(candidate.selectedAccount).toEqual(accountB);
  });

  it('accepts an injected connection without a transport session ID and checks connector identity', () => {
    const injectedConnection: Record<string, unknown> = { ...connection() };
    delete injectedConnection.transportSessionId;

    expect(() => assertWalletConnection(injectedConnection, 'eip155', 'metamask')).not.toThrow();
    expect(() => assertWalletConnection(injectedConnection, 'eip155', 'coinbase')).toThrow(
      'connector does not match',
    );
  });

  it('rejects duplicate, unknown, and cross-namespace account state', () => {
    expect(() =>
      assertWalletConnection(
        connection({
          accounts: [accountA, accountA],
          selectedAccount: accountA,
        }),
        'eip155',
      ),
    ).toThrow('accounts must be unique');

    expect(() =>
      assertWalletConnection(
        connection({
          selectedAccount: {
            chainId: 'eip155:1',
            address: accountB.address,
          },
        }),
        'eip155',
      ),
    ).toThrow('selected wallet account must exist');

    expect(() =>
      assertWalletConnection(
        connection({
          accounts: [{ chainId: 'solana:devnet', address: 'SolanaTestAddress' }],
          selectedAccount: { chainId: 'solana:devnet', address: 'SolanaTestAddress' },
        }),
        'eip155',
      ),
    ).toThrow('namespace does not match');

    const tooManyAccounts = Array.from({ length: 65 }, (_, index) => ({
      chainId: accountA.chainId,
      address: `0x${index.toString(16).padStart(40, '0')}`,
    }));
    expect(() =>
      assertWalletConnection(
        connection({
          accounts: tooManyAccounts,
          selectedAccount: tooManyAccounts[0] ?? accountA,
        }),
        'eip155',
      ),
    ).toThrow('1-64 accounts');
  });

  it('treats EVM address casing as one identity while preserving Solana case', () => {
    expect(() =>
      assertWalletConnection(
        connection({
          accounts: [
            accountA,
            {
              ...accountA,
              address: accountA.address.toUpperCase().replace('0X', '0x'),
            },
          ],
          selectedAccount: accountA,
        }),
        'eip155',
      ),
    ).toThrow('accounts must be unique');

    expect(() =>
      assertWalletConnection(
        {
          ...connection(),
          accounts: [{ chainId: 'solana:devnet', address: '11111111111111111111111111111111' }],
          approvedScopes: [
            {
              chainId: 'solana:devnet',
              methods: ['solana:signIn'],
              events: ['accountChanged'],
            },
          ],
          selectedAccount: {
            chainId: 'solana:devnet',
            address: '1111111111111111111111111111111O',
          },
        },
        'solana',
      ),
    ).toThrow('address is invalid for solana');

    const wrongLengthBase58 = '2'.repeat(32);
    expect(() =>
      assertWalletConnection(
        {
          ...connection(),
          accounts: [{ chainId: 'solana:devnet', address: wrongLengthBase58 }],
          approvedScopes: [
            {
              chainId: 'solana:devnet',
              methods: ['solana:signIn'],
              events: ['accountChanged'],
            },
          ],
          selectedAccount: { chainId: 'solana:devnet', address: wrongLengthBase58 },
        },
        'solana',
      ),
    ).toThrow('address is invalid for solana');
  });

  it('keeps the event target when a provider reports no accounts', () => {
    const event: WalletEvent = {
      type: 'accountsChanged',
      connectionId: 'connection-2',
      connectorId: 'metamask',
      connection: null,
    };

    expect(event).toMatchObject({
      connectionId: 'connection-2',
      connectorId: 'metamask',
      connection: null,
    });
  });

  it('requires an ownership challenge format that matches the chain namespace', () => {
    expect(() => assertOwnershipChallenge(challenge())).not.toThrow();
    expect(() =>
      assertOwnershipChallenge({
        ...challenge(),
        format: 'siws-message',
      }),
    ).toThrow('format does not match');
    expect(() =>
      assertOwnershipChallenge(
        challenge({
          expiresAt: 'not-a-date',
        }),
      ),
    ).toThrow('canonical UTC date-time');
    expect(() =>
      assertOwnershipChallenge(
        challenge({
          expiresAt: '2026-02-31T18:00:00.000Z',
        }),
      ),
    ).toThrow('canonical UTC date-time');
    expect(() =>
      assertOwnershipChallenge(
        challenge({
          nonce: 'short',
        }),
      ),
    ).toThrow('8-64 alphanumeric');
  });

  it('requires the challenge to target the selected account and an approved method', () => {
    const selectedConnection = connection();

    expect(() =>
      assertOwnershipChallengeTargetsConnection(challenge(), selectedConnection),
    ).not.toThrow();
    expect(() =>
      assertOwnershipChallengeTargetsConnection(
        challenge({
          chainId: accountA.chainId,
          address: accountA.address,
        }),
        selectedConnection,
      ),
    ).toThrow('selected wallet account');
    expect(() =>
      assertOwnershipChallengeTargetsConnection(
        challenge(),
        connection({
          approvedScopes: [
            {
              chainId: accountA.chainId,
              methods: ['personal_sign'],
              events: [],
            },
            {
              chainId: accountB.chainId,
              methods: [],
              events: [],
            },
          ],
        }),
      ),
    ).toThrow('has not approved personal_sign');
  });

  it('correlates a signature to the exact server-issued challenge', () => {
    const issuedChallenge = challenge();
    const signature = {
      format: 'siwe' as const,
      challengeId: issuedChallenge.id,
      chainId: issuedChallenge.chainId,
      address: issuedChallenge.address,
      signature: '0xsignature',
    };

    expect(() =>
      assertOwnershipSignatureMatchesChallenge(signature, issuedChallenge),
    ).not.toThrow();
    expect(() =>
      assertOwnershipSignatureMatchesChallenge(
        {
          ...signature,
          address: accountA.address,
        },
        issuedChallenge,
      ),
    ).toThrow('does not match');

    const mixedCaseChallenge = challenge({
      chainId: accountA.chainId,
      address: accountA.address,
    });
    expect(() =>
      assertOwnershipSignatureMatchesChallenge(
        {
          format: 'siwe',
          challengeId: mixedCaseChallenge.id,
          chainId: mixedCaseChallenge.chainId,
          address: accountA.address.toUpperCase().replace('0X', '0x'),
          signature: '0xsignature',
        },
        mixedCaseChallenge,
      ),
    ).not.toThrow();
  });

  it('represents wallet-constructed SIWS sign-in output for server verification', () => {
    const issuedChallenge = {
      id: 'challenge-solana-1',
      format: 'siws-sign-in' as const,
      chainId: 'solana:devnet' as const,
      address: '11111111111111111111111111111111',
      nonce: 'solana123456',
      expiresAt: '2026-08-18T18:05:00.000Z',
      input: {
        domain: 'example.test',
        address: '11111111111111111111111111111111',
        uri: 'https://example.test',
        version: '1' as const,
        chainId: 'solana:devnet' as const,
        nonce: 'solana123456',
        issuedAt: '2026-08-18T18:00:00.000Z',
        expirationTime: '2026-08-18T18:05:00.000Z',
        requestId: 'request-solana-1',
      },
    };
    const signature = {
      format: 'siws-sign-in' as const,
      challengeId: issuedChallenge.id,
      chainId: issuedChallenge.chainId,
      address: issuedChallenge.address,
      account: {
        address: issuedChallenge.address,
        publicKey: new Uint8Array(32),
      },
      signedMessage: new TextEncoder().encode('wallet-constructed SIWS message'),
      signature: new Uint8Array(64).fill(2),
      signatureType: 'ed25519' as const,
    };

    expect(() => assertOwnershipChallenge(issuedChallenge)).not.toThrow();
    expect(() =>
      assertOwnershipSignatureMatchesChallenge(signature, issuedChallenge),
    ).not.toThrow();
    expect(() =>
      assertOwnershipSignatureMatchesChallenge(
        {
          ...signature,
          account: {
            ...signature.account,
            address: 'SysvarRent111111111111111111111111111111111',
          },
        },
        issuedChallenge,
      ),
    ).toThrow('account does not match');
    expect(() =>
      assertOwnershipSignatureMatchesChallenge(
        {
          ...signature,
          account: {
            ...signature.account,
            publicKey: new Uint8Array(32).fill(1),
          },
        },
        issuedChallenge,
      ),
    ).toThrow('public key does not match');
    expect(() =>
      assertOwnershipSignatureMatchesChallenge(
        {
          ...signature,
          signedMessage: new Uint8Array(16_385),
        },
        issuedChallenge,
      ),
    ).toThrow('must not exceed 16384 bytes');
    expect(() =>
      assertOwnershipSignatureMatchesChallenge(
        {
          ...signature,
          signature: {
            byteLength: 64,
            BYTES_PER_ELEMENT: 1,
            [Symbol.toStringTag]: 'Uint8Array',
          },
        },
        issuedChallenge,
      ),
    ).toThrow('must be non-empty bytes');

    const wire = toOwnershipSignatureWire(signature);
    expect(wire).toMatchObject({
      format: 'siws-sign-in',
      account: {
        address: issuedChallenge.address,
        publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      },
    });
    if (wire.format !== 'siws-sign-in') {
      throw new Error('expected SIWS sign-in wire result');
    }
    expect(base64UrlToWalletBytes(wire.signature, 64)).toEqual(signature.signature);
  });

  it('uses bounded, strict base64url for binary wallet payloads', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const encoded = walletBytesToBase64Url(bytes);

    expect(encoded).toBe('AAEC_f7_');
    expect(base64UrlToWalletBytes(encoded)).toEqual(bytes);
    expect(() => base64UrlToWalletBytes('not+base64')).toThrow('malformed');
    expect(() => base64UrlToWalletBytes(encoded, 5)).toThrow('1-5 bytes');
  });
});
