import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticationFetch } from '@/lib/authentication/http';
import { API_REQUEST_TIMEOUT_MILLISECONDS } from '@/lib/http/bounded-response';
import {
  WALLET_OWNERSHIP_CHALLENGE_PATH,
  WALLET_OWNERSHIP_PROOF_PATH,
} from '@/lib/wallets/eip1193/ownership';
import {
  HttpSolanaWalletOwnershipClient,
  completeSolanaWalletOwnershipRegistration,
  type IssuedSolanaOwnershipChallenge,
  type RegisteredSolanaWalletResult,
  type SolanaWalletOwnershipClient,
} from '@/lib/wallets/solana/ownership';
import { MAINNET_WALLET_REGISTRY } from '@/lib/wallets/mainnet-network-policy';
import { SOLANA_CAIP_CHAIN_IDS } from '@/lib/wallets/solana/compatibility-network-catalog';
import {
  solanaPublicKeyBytesForAddress,
  walletBytesToBase64Url,
  type SiwsMessageOwnershipSignature,
  type WalletAdapter,
  type WalletConnection,
} from '@/lib/wallets/wallet-adapter';

const ORIGIN = 'https://app.example.test';
const ADDRESS = '11111111111111111111111111111112';
const CHALLENGE_ID = '11111111-1111-4111-8111-111111111111';
const WALLET_ID = '33333333-3333-4333-8333-333333333333';
const NONCE = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const EXPIRES_AT = '2026-09-02T12:05:00.000Z';
const FINGERPRINT = MAINNET_WALLET_REGISTRY.fingerprintSha256;
const CSRF_TOKEN = 'c'.repeat(43);

function message(): string {
  return (
    `app.example.test wants you to sign in with your Solana account:\n` +
    `${ADDRESS}\n\n` +
    `Verify this wallet for Crypto Lending. This proof does not authorize login, transactions, transfers, or loans.\n\n` +
    `URI: ${ORIGIN}/\n` +
    `Version: 1\n` +
    `Chain ID: ${SOLANA_CAIP_CHAIN_IDS.mainnet}\n` +
    `Nonce: ${NONCE}\n` +
    `Issued At: 2026-09-02T12:00:00.000Z\n` +
    `Expiration Time: ${EXPIRES_AT}\n` +
    `Not Before: 2026-09-02T12:00:00.000Z\n` +
    `Request ID: ${CHALLENGE_ID}\n` +
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
    messageFormat: 'SIWS',
    chainId: SOLANA_CAIP_CHAIN_IDS.mainnet,
    address: ADDRESS,
    accountId: `${SOLANA_CAIP_CHAIN_IDS.mainnet}:${ADDRESS}`,
    message: message(),
    expiresAt: EXPIRES_AT,
    registryEnvironment: 'MAINNET',
    registryVersion: 1,
    registryFingerprintSha256: FINGERPRINT,
    ...overrides,
  };
}

function issuedChallenge(): IssuedSolanaOwnershipChallenge {
  return {
    id: CHALLENGE_ID,
    format: 'siws-message',
    chainId: SOLANA_CAIP_CHAIN_IDS.mainnet,
    address: ADDRESS,
    nonce: NONCE,
    expiresAt: EXPIRES_AT,
    message: message(),
    registryEnvironment: 'MAINNET',
    registryVersion: 1,
    registryFingerprintSha256: FINGERPRINT,
  };
}

function registrationResponse(): RegisteredSolanaWalletResult {
  return {
    status: 'registered',
    walletId: WALLET_ID,
    chainId: SOLANA_CAIP_CHAIN_IDS.mainnet,
    address: ADDRESS,
    registeredAt: '2026-09-02T12:01:00.000Z',
    registryEnvironment: 'MAINNET',
    registryVersion: 1,
    registryFingerprintSha256: FINGERPRINT,
  };
}

function signature(challenge = issuedChallenge()): SiwsMessageOwnershipSignature {
  return {
    format: 'siws-message',
    challengeId: challenge.id,
    chainId: challenge.chainId,
    address: challenge.address,
    signedMessage: new TextEncoder().encode(challenge.message),
    signature: new Uint8Array(64).fill(7),
    signatureType: 'ed25519',
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.useRealTimers());

describe('HttpSolanaWalletOwnershipClient', () => {
  it('uses the chain-bound SIWS challenge and exact Ed25519 proof body', async () => {
    const requestFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(201, challengeResponse()))
      .mockResolvedValueOnce(jsonResponse(201, registrationResponse()));
    const client = new HttpSolanaWalletOwnershipClient({
      fetch: requestFetch as AuthenticationFetch,
      cookieHeader: `__Host-cl_csrf=${CSRF_TOKEN}`,
      publicOrigin: ORIGIN,
    });

    const challenge = await client.issueChallenge({
      chainId: SOLANA_CAIP_CHAIN_IDS.mainnet,
      address: ADDRESS,
      registryEnvironment: 'MAINNET',
    });
    const proof = signature(challenge);
    const result = await client.submitProof({ challenge, signature: proof });

    expect(challenge).toMatchObject({
      id: CHALLENGE_ID,
      format: 'siws-message',
      chainId: SOLANA_CAIP_CHAIN_IDS.mainnet,
    });
    expect(result).toEqual(registrationResponse());
    expect(requestFetch).toHaveBeenNthCalledWith(
      1,
      WALLET_OWNERSHIP_CHALLENGE_PATH,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ chainId: SOLANA_CAIP_CHAIN_IDS.mainnet, address: ADDRESS }),
        headers: expect.objectContaining({ 'X-CSRF-Token': CSRF_TOKEN }),
      }),
    );
    expect(requestFetch).toHaveBeenNthCalledWith(
      2,
      WALLET_OWNERSHIP_PROOF_PATH,
      expect.objectContaining({
        body: JSON.stringify({
          kind: 'SOLANA_ED25519',
          challengeId: CHALLENGE_ID,
          address: ADDRESS,
          publicKey: walletBytesToBase64Url(solanaPublicKeyBytesForAddress(ADDRESS)),
          signedMessage: walletBytesToBase64Url(proof.signedMessage),
          signature: walletBytesToBase64Url(proof.signature),
        }),
      }),
    );
  });

  it('rejects a challenge that is not bound to the exact chain account', async () => {
    const requestFetch = vi.fn(async () =>
      jsonResponse(201, challengeResponse({ accountId: `${SOLANA_CAIP_CHAIN_IDS.mainnet}:other` })),
    );
    const client = new HttpSolanaWalletOwnershipClient({
      fetch: requestFetch as AuthenticationFetch,
      cookieHeader: `__Host-cl_csrf=${CSRF_TOKEN}`,
      publicOrigin: ORIGIN,
    });

    await expect(
      client.issueChallenge({
        chainId: SOLANA_CAIP_CHAIN_IDS.mainnet,
        address: ADDRESS,
        registryEnvironment: 'MAINNET',
      }),
    ).rejects.toMatchObject({ code: 'WALLET_OWNERSHIP_UNAVAILABLE' });
  });

  it.each([
    ['version', { registryVersion: MAINNET_WALLET_REGISTRY.version + 1 }],
    ['fingerprint', { registryFingerprintSha256: 'cd'.repeat(32) }],
  ])('rejects MAINNET challenge registry %s drift', async (_name, overrides) => {
    const requestFetch = vi.fn(async () => jsonResponse(201, challengeResponse(overrides)));
    const client = new HttpSolanaWalletOwnershipClient({
      fetch: requestFetch as AuthenticationFetch,
      cookieHeader: `__Host-cl_csrf=${CSRF_TOKEN}`,
      publicOrigin: ORIGIN,
    });

    await expect(
      client.issueChallenge({
        chainId: SOLANA_CAIP_CHAIN_IDS.mainnet,
        address: ADDRESS,
        registryEnvironment: 'MAINNET',
      }),
    ).rejects.toMatchObject({ code: 'WALLET_OWNERSHIP_UNAVAILABLE' });
  });

  it.each([
    ['version', { registryVersion: MAINNET_WALLET_REGISTRY.version + 1 }],
    ['fingerprint', { registryFingerprintSha256: 'cd'.repeat(32) }],
  ])('rejects MAINNET registration registry %s drift', async (_name, overrides) => {
    const requestFetch = vi.fn(async () =>
      jsonResponse(201, { ...registrationResponse(), ...overrides }),
    );
    const client = new HttpSolanaWalletOwnershipClient({
      fetch: requestFetch as AuthenticationFetch,
      cookieHeader: `__Host-cl_csrf=${CSRF_TOKEN}`,
      publicOrigin: ORIGIN,
    });
    const challenge = issuedChallenge();

    await expect(
      client.submitProof({ challenge, signature: signature(challenge) }),
    ).rejects.toMatchObject({ code: 'WALLET_OWNERSHIP_UNAVAILABLE' });
  });

  it('rejects a successful ownership response with no body stream', async () => {
    const client = new HttpSolanaWalletOwnershipClient({
      fetch: async () =>
        new Response(null, { status: 201, headers: { 'Content-Type': 'application/json' } }),
      cookieHeader: `__Host-cl_csrf=${CSRF_TOKEN}`,
      publicOrigin: ORIGIN,
    });

    await expect(
      client.issueChallenge({
        chainId: SOLANA_CAIP_CHAIN_IDS.mainnet,
        address: ADDRESS,
        registryEnvironment: 'MAINNET',
      }),
    ).rejects.toMatchObject({ code: 'WALLET_OWNERSHIP_UNAVAILABLE' });
  });

  it('times out an abort-ignorant ownership request and ignores its late response', async () => {
    vi.useFakeTimers();
    const lateResponse = Promise.withResolvers<Response>();
    let requestSignal: AbortSignal | undefined;
    const client = new HttpSolanaWalletOwnershipClient({
      fetch: async (_input, init) => {
        requestSignal = init?.signal ?? undefined;
        return lateResponse.promise;
      },
      cookieHeader: `__Host-cl_csrf=${CSRF_TOKEN}`,
      publicOrigin: ORIGIN,
    });
    const issue = client.issueChallenge({
      chainId: SOLANA_CAIP_CHAIN_IDS.mainnet,
      address: ADDRESS,
      registryEnvironment: 'MAINNET',
    });
    const failure = expect(issue).rejects.toMatchObject({
      code: 'WALLET_OWNERSHIP_UNAVAILABLE',
    });

    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MILLISECONDS);
    await failure;

    expect(requestSignal?.aborted).toBe(true);
    lateResponse.resolve(jsonResponse(201, challengeResponse()));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('completeSolanaWalletOwnershipRegistration', () => {
  it('connects one explicit Solana account to the issue-sign-submit handoff', async () => {
    const connection: WalletConnection = {
      connectionId: 'phantom-mainnet-connection',
      connectorId: 'phantom',
      accounts: [{ chainId: SOLANA_CAIP_CHAIN_IDS.mainnet, address: ADDRESS }],
      approvedScopes: [
        {
          chainId: SOLANA_CAIP_CHAIN_IDS.mainnet,
          methods: ['solana:signMessage'],
          events: ['accountChanged', 'disconnect'],
        },
      ],
      selectedAccount: { chainId: SOLANA_CAIP_CHAIN_IDS.mainnet, address: ADDRESS },
      restored: false,
    };
    const challenge = issuedChallenge();
    const signed = signature(challenge);
    const adapter: WalletAdapter = {
      connectorId: 'phantom',
      namespace: 'solana',
      connect: vi.fn(async () => connection),
      restore: vi.fn(async () => null),
      disconnect: vi.fn(async () => undefined),
      signOwnershipChallenge: vi.fn(async () => signed),
      subscribe: vi.fn(() => vi.fn()),
    };
    const client: SolanaWalletOwnershipClient = {
      issueChallenge: vi.fn(async () => challenge),
      submitProof: vi.fn(async () => registrationResponse()),
    };

    await expect(
      completeSolanaWalletOwnershipRegistration({ adapter, connection, client }),
    ).resolves.toEqual(registrationResponse());
    expect(client.issueChallenge).toHaveBeenCalledWith(
      {
        chainId: SOLANA_CAIP_CHAIN_IDS.mainnet,
        address: ADDRESS,
        registryEnvironment: 'MAINNET',
      },
      undefined,
    );
    expect(adapter.signOwnershipChallenge).toHaveBeenCalledWith(connection.connectionId, challenge);
    expect(client.submitProof).toHaveBeenCalledWith({ challenge, signature: signed }, undefined);
  });
});
