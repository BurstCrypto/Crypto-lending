import { describe, expect, it, vi } from 'vitest';

import type { AuthenticationFetch } from '../lib/authentication/http';
import {
  EvmPublicTestnetApiClient,
  EVM_PUBLIC_TESTNET_EXECUTION_INTENTS_PATH,
  EVM_PUBLIC_TESTNET_POSITION_QUERY_PATH,
} from '../lib/evm-public-testnet/client';
import { EVM_PUBLIC_TESTNET_CHAIN_ID } from '../lib/evm-public-testnet/constants';
import {
  EVM_PUBLIC_TESTNET_ACCOUNT,
  EVM_PUBLIC_TESTNET_INTENT_ID,
  EVM_PUBLIC_TESTNET_NOW,
  EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
  evmPublicTestnetIntentResponse,
  evmPublicTestnetPositionResponse,
  evmPublicTestnetRequest,
  evmPublicTestnetSubmissionResponse,
} from './evm-public-testnet.fixtures';

const CSRF_TOKEN = 'c'.repeat(43);

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function client(fetch: AuthenticationFetch): EvmPublicTestnetApiClient {
  return new EvmPublicTestnetApiClient({
    fetch,
    cookieHeader: `__Host-cl_csrf=${CSRF_TOKEN}`,
    now: () => EVM_PUBLIC_TESTNET_NOW,
  });
}

describe('EvmPublicTestnetApiClient', () => {
  it('prepares one exact same-origin Base Sepolia intent', async () => {
    const requestFetch = vi.fn(async () => response(201, evmPublicTestnetIntentResponse()));

    const result = await client(requestFetch).prepare(evmPublicTestnetRequest());

    expect(result.intentId).toBe(EVM_PUBLIC_TESTNET_INTENT_ID);
    expect(requestFetch).toHaveBeenCalledWith(
      EVM_PUBLIC_TESTNET_EXECUTION_INTENTS_PATH,
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
        body: JSON.stringify(evmPublicTestnetRequest()),
      }),
    );
  });

  it('submits one exact transaction hash and queries recovery with an empty object', async () => {
    const requestFetch = vi
      .fn<AuthenticationFetch>()
      .mockResolvedValueOnce(response(200, evmPublicTestnetSubmissionResponse('CONFIRMED')))
      .mockResolvedValueOnce(response(200, evmPublicTestnetSubmissionResponse('PENDING', null)));
    const api = client(requestFetch);

    await expect(
      api.submit(EVM_PUBLIC_TESTNET_INTENT_ID, EVM_PUBLIC_TESTNET_TRANSACTION_HASH),
    ).resolves.toMatchObject({ status: 'CONFIRMED' });
    await expect(api.query(EVM_PUBLIC_TESTNET_INTENT_ID)).resolves.toMatchObject({
      status: 'PENDING',
      transaction: { transactionHash: null },
    });

    const path = `${EVM_PUBLIC_TESTNET_EXECUTION_INTENTS_PATH}/${EVM_PUBLIC_TESTNET_INTENT_ID}/submissions`;
    expect(requestFetch).toHaveBeenNthCalledWith(
      1,
      path,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH }),
      }),
    );
    expect(requestFetch).toHaveBeenNthCalledWith(
      2,
      path,
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
  });

  it('queries the read-only Aave position without preparing a write', async () => {
    const requestFetch = vi.fn(async () => response(200, evmPublicTestnetPositionResponse()));

    const result = await client(requestFetch).queryPosition({
      chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
      account: EVM_PUBLIC_TESTNET_ACCOUNT,
    });

    expect(result).toMatchObject({
      use: 'EVM_PUBLIC_TESTNET_READ_ONLY_POSITION',
      mayAuthorizeFinancialAction: false,
      provider: { name: 'Aave V3' },
    });
    expect(requestFetch).toHaveBeenCalledWith(
      EVM_PUBLIC_TESTNET_POSITION_QUERY_PATH,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
          account: EVM_PUBLIC_TESTNET_ACCOUNT,
        }),
      }),
    );
  });

  it.each([
    [409, 'EVM_PUBLIC_TESTNET_TRANSACTION_REPLACED', 'REPLACED', true],
    [409, 'EVM_PUBLIC_TESTNET_INTENT_CONFLICT', 'CONFLICT', false],
    [410, 'EVM_PUBLIC_TESTNET_INTENT_EXPIRED', 'EXPIRED', false],
    [422, 'EVM_PUBLIC_TESTNET_TRANSACTION_REVERTED', 'REVERTED', true],
    [422, 'EVM_PUBLIC_TESTNET_EVIDENCE_MISMATCH', 'EVIDENCE_MISMATCH', false],
    [503, 'EVM_PUBLIC_TESTNET_RPC_UNAVAILABLE', 'UNAVAILABLE', false],
  ] as const)(
    'maps bounded HTTP %s / %s to %s without leaking details',
    async (status, responseCode, code, safeToRetry) => {
      const secret = 'private RPC and wallet detail';
      const requestFetch = vi.fn(async () =>
        response(status, { code: responseCode, message: secret, safeToRetry }),
      );

      const caught = await client(requestFetch)
        .submit(EVM_PUBLIC_TESTNET_INTENT_ID, EVM_PUBLIC_TESTNET_TRANSACTION_HASH)
        .catch((failure: unknown) => failure);

      expect(caught).toMatchObject({ code, safeToRetry });
      expect(JSON.stringify(caught)).not.toContain(secret);
    },
  );

  it('does not call the API without CSRF or with malformed identifiers', async () => {
    const requestFetch = vi.fn();
    const noCsrf = new EvmPublicTestnetApiClient({ fetch: requestFetch, cookieHeader: '' });

    await expect(noCsrf.prepare(evmPublicTestnetRequest())).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(
      client(requestFetch).submit('not-an-id', EVM_PUBLIC_TESTNET_TRANSACTION_HASH),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(
      client(requestFetch).submit(EVM_PUBLIC_TESTNET_INTENT_ID, '0x1234'),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(requestFetch).not.toHaveBeenCalled();
  });
});
