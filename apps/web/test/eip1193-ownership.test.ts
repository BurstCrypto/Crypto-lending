import { describe, expect, it, vi } from 'vitest';

import type { AuthenticationFetch } from '@/lib/authentication/http';
import {
  InjectedEip1193WalletAdapter,
  type InjectedEip1193WalletAdapterOptions,
} from '@/lib/wallets/eip1193/adapter';
import { KAN61_EVM_TESTNET_CATALOG } from '@/lib/wallets/eip1193/networks';
import {
  HttpEvmWalletOwnershipClient,
  WALLET_OWNERSHIP_CHALLENGE_PATH,
  WALLET_OWNERSHIP_HANDOFF_ERROR_CODES,
  WALLET_OWNERSHIP_PROOF_PATH,
  completeEvmWalletOwnershipRegistration,
  type EvmWalletOwnershipClient,
  type IssuedEvmOwnershipChallenge,
  type RegisteredEvmWalletResult,
} from '@/lib/wallets/eip1193/ownership';
import type { Eip1193Provider, Eip1193RequestArguments } from '@/lib/wallets/eip1193/provider';

const ORIGIN = 'https://app.example.test';
const ADDRESS = '0x1111111111111111111111111111111111111111';
const CHALLENGE_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const WALLET_ID = '33333333-3333-4333-8333-333333333333';
const NONCE = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const EXPIRES_AT = '2026-08-24T12:05:00.000Z';
const FINGERPRINT = 'ab'.repeat(32);
const CSRF_TOKEN = 'c'.repeat(43);
const SIGNATURE = `0x${'ab'.repeat(65)}`;

function message(overrides: { requestId?: string; nonce?: string } = {}): string {
  return (
    `app.example.test wants you to sign in with your Ethereum account:\n` +
    `${ADDRESS}\n\n` +
    `Verify this wallet for Crypto Lending. This proof does not authorize login, transactions, transfers, or loans.\n\n` +
    `URI: ${ORIGIN}/\n` +
    `Version: 1\n` +
    `Chain ID: 11155111\n` +
    `Nonce: ${overrides.nonce ?? NONCE}\n` +
    `Issued At: 2026-08-24T12:00:00.000Z\n` +
    `Expiration Time: ${EXPIRES_AT}\n` +
    `Not Before: 2026-08-24T12:00:00.000Z\n` +
    `Request ID: ${overrides.requestId ?? CHALLENGE_ID}\n` +
    `Resources:\n` +
    `- urn:crypto-lending:wallet-ownership:v1\n` +
    `- urn:crypto-lending:wallet-subject-binding:hmac-sha-256:${'cd'.repeat(32)}\n` +
    `- urn:crypto-lending:wallet-operation:register-wallet`
  );
}

function challengeResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    challengeId: CHALLENGE_ID,
    messageFormat: 'SIWE',
    chainId: 'eip155:11155111',
    address: ADDRESS,
    accountId: ACCOUNT_ID,
    message: message(),
    expiresAt: EXPIRES_AT,
    registryEnvironment: 'TESTNET',
    registryVersion: 1,
    registryFingerprintSha256: FINGERPRINT,
    ...overrides,
  };
}

function issuedChallenge(): IssuedEvmOwnershipChallenge {
  return {
    id: CHALLENGE_ID,
    format: 'siwe',
    chainId: 'eip155:11155111',
    address: ADDRESS,
    nonce: NONCE,
    expiresAt: EXPIRES_AT,
    message: message(),
    registryEnvironment: 'TESTNET',
    registryVersion: 1,
    registryFingerprintSha256: FINGERPRINT,
  };
}

function registrationResponse(
  status: 'registered' | 'already_registered' = 'registered',
): RegisteredEvmWalletResult {
  return {
    status,
    walletId: WALLET_ID,
    chainId: 'eip155:11155111',
    address: ADDRESS,
    registeredAt: '2026-08-24T12:01:00.000Z',
    registryEnvironment: 'TESTNET',
    registryVersion: 1,
    registryFingerprintSha256: FINGERPRINT,
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function httpClient(fetch: AuthenticationFetch) {
  return new HttpEvmWalletOwnershipClient({
    fetch,
    cookieHeader: `__Host-cl_csrf=${CSRF_TOKEN}`,
    publicOrigin: ORIGIN,
  });
}

describe('HttpEvmWalletOwnershipClient', () => {
  it('uses the exact KAN-56 endpoints, CSRF contract, challenge, and proof DTO', async () => {
    const requestFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(201, challengeResponse()))
      .mockResolvedValueOnce(jsonResponse(201, registrationResponse()));
    const client = httpClient(requestFetch);

    const challenge = await client.issueChallenge({
      chainId: 'eip155:11155111',
      address: ADDRESS.toUpperCase().replace('0X', '0x'),
      registryEnvironment: 'TESTNET',
    });
    const result = await client.submitProof({
      challenge,
      signature: {
        format: 'siwe',
        challengeId: challenge.id,
        chainId: challenge.chainId,
        address: challenge.address,
        signature: SIGNATURE,
      },
    });

    expect(challenge).toMatchObject({
      id: CHALLENGE_ID,
      format: 'siwe',
      nonce: NONCE,
      registryEnvironment: 'TESTNET',
    });
    expect(result).toEqual(registrationResponse());
    expect(requestFetch).toHaveBeenNthCalledWith(
      1,
      WALLET_OWNERSHIP_CHALLENGE_PATH,
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-CSRF-Token': CSRF_TOKEN,
        },
        body: JSON.stringify({ chainId: 'eip155:11155111', address: ADDRESS }),
      }),
    );
    expect(requestFetch).toHaveBeenNthCalledWith(
      2,
      WALLET_OWNERSHIP_PROOF_PATH,
      expect.objectContaining({
        body: JSON.stringify({
          kind: 'EVM_EIP191_EOA',
          challengeId: CHALLENGE_ID,
          message: message(),
          signature: SIGNATURE,
        }),
      }),
    );
  });

  it.each([
    ['wrong request binding', { message: message({ requestId: ACCOUNT_ID }) }],
    [
      'unexpected signing statement',
      { message: message().replace('does not authorize login', 'authorizes login') },
    ],
    ['wrong environment', { registryEnvironment: 'MAINNET' }],
    ['wrong account', { address: '0x2222222222222222222222222222222222222222' }],
    ['noncanonical signature context', { registryFingerprintSha256: FINGERPRINT.toUpperCase() }],
    ['extra response field', { unexpected: true }],
  ])('rejects a malformed %s response without surfacing its fields', async (_name, overrides) => {
    const requestFetch = vi.fn(async () => jsonResponse(201, challengeResponse(overrides)));

    await expect(
      httpClient(requestFetch).issueChallenge({
        chainId: 'eip155:11155111',
        address: ADDRESS,
        registryEnvironment: 'TESTNET',
      }),
    ).rejects.toMatchObject({
      code: WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unavailable,
      message: 'Wallet ownership service is unavailable',
    });
  });

  it('maps rate limits and API rejection without reading or retaining response detail', async () => {
    const secret = 'challenge row and account detail';
    const rateLimitedFetch = vi.fn(async () =>
      jsonResponse(429, { message: secret }, { 'Retry-After': '12' }),
    );
    const rateLimit = await httpClient(rateLimitedFetch)
      .issueChallenge({
        chainId: 'eip155:11155111',
        address: ADDRESS,
        registryEnvironment: 'TESTNET',
      })
      .catch((error: unknown) => error);
    expect(rateLimit).toMatchObject({
      code: WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unavailable,
      retryAfterSeconds: 12,
    });
    expect(JSON.stringify(rateLimit)).not.toContain(secret);

    const rejectedFetch = vi.fn(async () => jsonResponse(400, { message: secret }));
    await expect(
      httpClient(rejectedFetch).issueChallenge({
        chainId: 'eip155:11155111',
        address: ADDRESS,
        registryEnvironment: 'TESTNET',
      }),
    ).rejects.toMatchObject({ code: WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected });
  });

  it('requires a valid session CSRF token before making any request', async () => {
    const requestFetch = vi.fn();
    const client = new HttpEvmWalletOwnershipClient({
      fetch: requestFetch,
      cookieHeader: '',
      publicOrigin: ORIGIN,
    });

    await expect(
      client.issueChallenge({
        chainId: 'eip155:11155111',
        address: ADDRESS,
        registryEnvironment: 'TESTNET',
      }),
    ).rejects.toMatchObject({
      code: WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unauthenticated,
    });
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it('maps proof conflicts and validates status/result correlation', async () => {
    const conflictFetch = vi.fn(async () => jsonResponse(409, { message: 'private conflict' }));
    await expect(
      httpClient(conflictFetch).submitProof({
        challenge: issuedChallenge(),
        signature: {
          format: 'siwe',
          challengeId: CHALLENGE_ID,
          chainId: 'eip155:11155111',
          address: ADDRESS,
          signature: SIGNATURE,
        },
      }),
    ).rejects.toMatchObject({ code: WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.conflict });

    const mismatchedFetch = vi.fn(async () =>
      jsonResponse(200, registrationResponse('registered')),
    );
    await expect(
      httpClient(mismatchedFetch).submitProof({
        challenge: issuedChallenge(),
        signature: {
          format: 'siwe',
          challengeId: CHALLENGE_ID,
          chainId: 'eip155:11155111',
          address: ADDRESS,
          signature: SIGNATURE,
        },
      }),
    ).rejects.toMatchObject({ code: WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unavailable });
  });
});

class SigningProvider implements Eip1193Provider {
  readonly request = vi.fn(async ({ method, params }: Eip1193RequestArguments) => {
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return [ADDRESS];
      case 'eth_chainId':
        return '0xaa36a7';
      case 'personal_sign':
        expect(params).toEqual([message(), ADDRESS]);
        return SIGNATURE;
      default:
        throw new Error('unexpected test method');
    }
  });
  readonly on = vi.fn<Eip1193Provider['on']>();
  readonly removeListener = vi.fn<Eip1193Provider['removeListener']>();
}

function signingAdapter(provider: SigningProvider): InjectedEip1193WalletAdapter {
  const selection: InjectedEip1193WalletAdapterOptions['selection'] = {
    descriptor: {
      selectionId: 'explicit-metamask-selection',
      connectorId: 'metamask',
      displayName: 'MetaMask',
      supportedNetworks: KAN61_EVM_TESTNET_CATALOG,
    },
    provider,
  };
  return new InjectedEip1193WalletAdapter({
    selection,
    createConnectionId: () => 'connection-metamask',
    now: () => new Date('2026-08-24T12:00:00.000Z'),
  });
}

describe('completeEvmWalletOwnershipRegistration', () => {
  it('hands the selected connection through issue, exact signing, and submit', async () => {
    const provider = new SigningProvider();
    const adapter = signingAdapter(provider);
    const connection = await adapter.connect();
    const result = registrationResponse();
    const client: EvmWalletOwnershipClient = {
      issueChallenge: vi.fn(async () => issuedChallenge()),
      submitProof: vi.fn(async () => result),
    };

    await expect(
      completeEvmWalletOwnershipRegistration({ adapter, connection, client }),
    ).resolves.toEqual(result);
    expect(client.issueChallenge).toHaveBeenCalledWith(
      {
        chainId: 'eip155:11155111',
        address: ADDRESS,
        registryEnvironment: 'TESTNET',
      },
      undefined,
    );
    expect(client.submitProof).toHaveBeenCalledWith(
      {
        challenge: issuedChallenge(),
        signature: {
          format: 'siwe',
          challengeId: CHALLENGE_ID,
          chainId: 'eip155:11155111',
          address: ADDRESS,
          signature: SIGNATURE,
        },
      },
      undefined,
    );
  });

  it('does not issue a challenge for a stale or foreign connection', async () => {
    const provider = new SigningProvider();
    const adapter = signingAdapter(provider);
    const connection = await adapter.connect();
    const client: EvmWalletOwnershipClient = {
      issueChallenge: vi.fn(async () => issuedChallenge()),
      submitProof: vi.fn(async () => registrationResponse()),
    };

    await expect(
      completeEvmWalletOwnershipRegistration({
        adapter,
        connection: { ...connection, connectorId: 'coinbase' },
        client,
      }),
    ).rejects.toMatchObject({ code: WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected });
    expect(client.issueChallenge).not.toHaveBeenCalled();

    await adapter.disconnect(connection.connectionId);
    await expect(
      completeEvmWalletOwnershipRegistration({ adapter, connection, client }),
    ).rejects.toMatchObject({ code: WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected });
    expect(client.issueChallenge).not.toHaveBeenCalled();
  });
});
