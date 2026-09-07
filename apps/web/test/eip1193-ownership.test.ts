import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticationFetch } from '@/lib/authentication/http';
import { API_REQUEST_TIMEOUT_MILLISECONDS } from '@/lib/http/bounded-response';
import {
  InjectedEip1193WalletAdapter,
  type InjectedEip1193WalletAdapterOptions,
} from '@/lib/wallets/eip1193/adapter';
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
import {
  MAINNET_EVM_WALLET_NETWORKS,
  MAINNET_WALLET_REGISTRY,
} from '@/lib/wallets/mainnet-network-policy';

import { KAN61_EVM_NETWORK_CATALOG } from './eip1193-network-catalog.fixture';

const ORIGIN = 'https://app.example.test';
const ADDRESS = '0x1111111111111111111111111111111111111111';
const CHALLENGE_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = `eip155:1:${ADDRESS}`;
const WRONG_REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const WALLET_ID = '33333333-3333-4333-8333-333333333333';
const NONCE = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const EXPIRES_AT = '2026-08-24T12:05:00.000Z';
const FINGERPRINT = MAINNET_WALLET_REGISTRY.fingerprintSha256;
const CSRF_TOKEN = 'c'.repeat(43);
const SIGNATURE = `0x${'ab'.repeat(65)}`;

function message(overrides: { requestId?: string; nonce?: string } = {}): string {
  return (
    `app.example.test wants you to sign in with your Ethereum account:\n` +
    `${ADDRESS}\n\n` +
    `Verify this wallet for Crypto Lending. This proof does not authorize login, transactions, transfers, or loans.\n\n` +
    `URI: ${ORIGIN}/\n` +
    `Version: 1\n` +
    `Chain ID: 1\n` +
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
    chainId: 'eip155:1',
    address: ADDRESS,
    accountId: ACCOUNT_ID,
    message: message(),
    expiresAt: EXPIRES_AT,
    registryEnvironment: 'MAINNET',
    registryVersion: 1,
    registryFingerprintSha256: FINGERPRINT,
    ...overrides,
  };
}

function issuedChallenge(): IssuedEvmOwnershipChallenge {
  return {
    id: CHALLENGE_ID,
    format: 'siwe',
    chainId: 'eip155:1',
    address: ADDRESS,
    nonce: NONCE,
    expiresAt: EXPIRES_AT,
    message: message(),
    registryEnvironment: 'MAINNET',
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
    chainId: 'eip155:1',
    address: ADDRESS,
    registeredAt: '2026-08-24T12:01:00.000Z',
    registryEnvironment: 'MAINNET',
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

afterEach(() => vi.useRealTimers());

describe('HttpEvmWalletOwnershipClient', () => {
  it('uses the exact KAN-56 endpoints, CSRF contract, challenge, and proof DTO', async () => {
    const requestFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(201, challengeResponse()))
      .mockResolvedValueOnce(jsonResponse(201, registrationResponse()));
    const client = httpClient(requestFetch);

    const challenge = await client.issueChallenge({
      chainId: 'eip155:1',
      address: ADDRESS.toUpperCase().replace('0X', '0x'),
      registryEnvironment: 'MAINNET',
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
      registryEnvironment: 'MAINNET',
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
        body: JSON.stringify({ chainId: 'eip155:1', address: ADDRESS }),
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
    ['wrong request binding', { message: message({ requestId: WRONG_REQUEST_ID }) }],
    [
      'unexpected signing statement',
      { message: message().replace('does not authorize login', 'authorizes login') },
    ],
    ['unsupported Base chain response', { chainId: 'eip155:8453' }],
    ['wrong environment', { registryEnvironment: 'TESTNET' }],
    ['wrong account', { address: '0x2222222222222222222222222222222222222222' }],
    ['noncanonical signature context', { registryFingerprintSha256: FINGERPRINT.toUpperCase() }],
    ['extra response field', { unexpected: true }],
  ])('rejects a malformed %s response without surfacing its fields', async (_name, overrides) => {
    const requestFetch = vi.fn(async () => jsonResponse(201, challengeResponse(overrides)));

    await expect(
      httpClient(requestFetch).issueChallenge({
        chainId: 'eip155:1',
        address: ADDRESS,
        registryEnvironment: 'MAINNET',
      }),
    ).rejects.toMatchObject({
      code: WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unavailable,
      message: 'Wallet ownership service is unavailable',
    });
  });

  it('rejects Base and testnet ownership inputs before calling the API', async () => {
    const requestFetch = vi.fn();
    const client = httpClient(requestFetch);

    await expect(
      client.issueChallenge({
        chainId: 'eip155:8453',
        address: ADDRESS,
        registryEnvironment: 'MAINNET',
      } as never),
    ).rejects.toMatchObject({ code: WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected });
    await expect(
      client.issueChallenge({
        chainId: 'eip155:1',
        address: ADDRESS,
        registryEnvironment: 'TESTNET',
      } as never),
    ).rejects.toMatchObject({ code: WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected });
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['version', { registryVersion: MAINNET_WALLET_REGISTRY.version + 1 }],
    ['fingerprint', { registryFingerprintSha256: 'cd'.repeat(32) }],
  ])('rejects MAINNET challenge registry %s drift', async (_name, overrides) => {
    const requestFetch = vi.fn(async () =>
      jsonResponse(
        201,
        challengeResponse({
          registryEnvironment: MAINNET_WALLET_REGISTRY.environment,
          registryVersion: MAINNET_WALLET_REGISTRY.version,
          registryFingerprintSha256: MAINNET_WALLET_REGISTRY.fingerprintSha256,
          ...overrides,
        }),
      ),
    );

    await expect(
      httpClient(requestFetch).issueChallenge({
        chainId: 'eip155:1',
        address: ADDRESS,
        registryEnvironment: 'MAINNET',
      }),
    ).rejects.toMatchObject({ code: WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unavailable });
  });

  it.each([
    ['version', { registryVersion: MAINNET_WALLET_REGISTRY.version + 1 }],
    ['fingerprint', { registryFingerprintSha256: 'cd'.repeat(32) }],
  ])('rejects MAINNET registration registry %s drift', async (_name, overrides) => {
    const challenge: IssuedEvmOwnershipChallenge = {
      ...issuedChallenge(),
      registryEnvironment: MAINNET_WALLET_REGISTRY.environment,
      registryVersion: MAINNET_WALLET_REGISTRY.version,
      registryFingerprintSha256: MAINNET_WALLET_REGISTRY.fingerprintSha256,
    };
    const requestFetch = vi.fn(async () =>
      jsonResponse(201, {
        ...registrationResponse(),
        registryEnvironment: MAINNET_WALLET_REGISTRY.environment,
        registryVersion: MAINNET_WALLET_REGISTRY.version,
        registryFingerprintSha256: MAINNET_WALLET_REGISTRY.fingerprintSha256,
        ...overrides,
      }),
    );

    await expect(
      httpClient(requestFetch).submitProof({
        challenge,
        signature: {
          format: 'siwe',
          challengeId: challenge.id,
          chainId: challenge.chainId,
          address: challenge.address,
          signature: SIGNATURE,
        },
      }),
    ).rejects.toMatchObject({ code: WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unavailable });
  });

  it('maps rate limits and API rejection without reading or retaining response detail', async () => {
    const secret = 'challenge row and account detail';
    const rateLimitedFetch = vi.fn(async () =>
      jsonResponse(429, { message: secret }, { 'Retry-After': '12' }),
    );
    const rateLimit = await httpClient(rateLimitedFetch)
      .issueChallenge({
        chainId: 'eip155:1',
        address: ADDRESS,
        registryEnvironment: 'MAINNET',
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
        chainId: 'eip155:1',
        address: ADDRESS,
        registryEnvironment: 'MAINNET',
      }),
    ).rejects.toMatchObject({ code: WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected });
  });

  it('bounds and cancels an oversized chunked ownership response', async () => {
    const cancel = vi.fn();
    const chunk = new Uint8Array(9_000).fill(0x20);
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(chunk);
        },
        cancel,
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    );

    await expect(
      httpClient(async () => response).issueChallenge({
        chainId: 'eip155:1',
        address: ADDRESS,
        registryEnvironment: 'MAINNET',
      }),
    ).rejects.toMatchObject({ code: WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unavailable });
    expect(response.headers.has('content-length')).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('maps a stalled ownership body deadline to unavailable', async () => {
    vi.useFakeTimers();
    const pendingPull = Promise.withResolvers<void>();
    const cancel = vi.fn(() => pendingPull.resolve());
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull() {
          return pendingPull.promise;
        },
        cancel,
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    );
    const issue = httpClient(async () => response).issueChallenge({
      chainId: 'eip155:1',
      address: ADDRESS,
      registryEnvironment: 'MAINNET',
    });
    const failure = expect(issue).rejects.toMatchObject({
      code: WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unavailable,
    });

    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MILLISECONDS);

    await failure;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves caller cancellation while awaiting the ownership API', async () => {
    const lateResponse = Promise.withResolvers<Response>();
    const controller = new AbortController();
    const reason = new DOMException('wallet screen closed', 'AbortError');
    const issue = httpClient(async () => lateResponse.promise).issueChallenge(
      {
        chainId: 'eip155:1',
        address: ADDRESS,
        registryEnvironment: 'MAINNET',
      },
      controller.signal,
    );

    controller.abort(reason);

    await expect(issue).rejects.toBe(reason);
    lateResponse.resolve(jsonResponse(201, challengeResponse()));
    await Promise.resolve();
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
        chainId: 'eip155:1',
        address: ADDRESS,
        registryEnvironment: 'MAINNET',
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
          chainId: 'eip155:1',
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
          chainId: 'eip155:1',
          address: ADDRESS,
          signature: SIGNATURE,
        },
      }),
    ).rejects.toMatchObject({ code: WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unavailable });
  });

  it.each([
    [400, WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected],
    [401, WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unauthenticated],
  ] as const)(
    'separates a rejected ownership proof from an expired account session (%s)',
    async (status, expectedCode) => {
      const requestFetch = vi.fn(async () => jsonResponse(status, { message: 'private detail' }));
      await expect(
        httpClient(requestFetch).submitProof({
          challenge: issuedChallenge(),
          signature: {
            format: 'siwe',
            challengeId: CHALLENGE_ID,
            chainId: 'eip155:1',
            address: ADDRESS,
            signature: SIGNATURE,
          },
        }),
      ).rejects.toMatchObject({ code: expectedCode });
    },
  );
});

class SigningProvider implements Eip1193Provider {
  constructor(private readonly providerChainId = '0x1') {}

  readonly request = vi.fn(async ({ method, params }: Eip1193RequestArguments) => {
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return [ADDRESS];
      case 'eth_chainId':
        return this.providerChainId;
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

function signingAdapter(
  provider: SigningProvider,
  supportedNetworks = MAINNET_EVM_WALLET_NETWORKS,
): InjectedEip1193WalletAdapter {
  const selection: InjectedEip1193WalletAdapterOptions['selection'] = {
    descriptor: {
      selectionId: 'explicit-metamask-selection',
      connectorId: 'metamask',
      displayName: 'MetaMask',
      supportedNetworks,
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
    const controller = new AbortController();
    const signOwnershipChallenge = vi.spyOn(adapter, 'signOwnershipChallenge');
    const client: EvmWalletOwnershipClient = {
      issueChallenge: vi.fn(async () => issuedChallenge()),
      submitProof: vi.fn(async () => result),
    };

    await expect(
      completeEvmWalletOwnershipRegistration({
        adapter,
        connection,
        client,
        signal: controller.signal,
      }),
    ).resolves.toEqual(result);
    expect(client.issueChallenge).toHaveBeenCalledWith(
      {
        chainId: 'eip155:1',
        address: ADDRESS,
        registryEnvironment: 'MAINNET',
      },
      controller.signal,
    );
    expect(signOwnershipChallenge).toHaveBeenCalledWith(
      connection.connectionId,
      issuedChallenge(),
      {
        signal: controller.signal,
      },
    );
    expect(client.submitProof).toHaveBeenCalledWith(
      {
        challenge: issuedChallenge(),
        signature: {
          format: 'siwe',
          challengeId: CHALLENGE_ID,
          chainId: 'eip155:1',
          address: ADDRESS,
          signature: SIGNATURE,
        },
      },
      controller.signal,
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

  it('rejects a Base connection even when a compatibility adapter labels it MAINNET', async () => {
    const provider = new SigningProvider('0x2105');
    const adapter = signingAdapter(provider, KAN61_EVM_NETWORK_CATALOG);
    const connection = await adapter.connect();
    const client: EvmWalletOwnershipClient = {
      issueChallenge: vi.fn(async () => issuedChallenge()),
      submitProof: vi.fn(async () => registrationResponse()),
    };

    await expect(
      completeEvmWalletOwnershipRegistration({ adapter, connection, client }),
    ).rejects.toMatchObject({ code: WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected });
    expect(connection.selectedAccount.chainId).toBe('eip155:8453');
    expect(client.issueChallenge).not.toHaveBeenCalled();
  });
});
