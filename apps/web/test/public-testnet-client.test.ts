import { describe, expect, it, vi } from 'vitest';

import type { AuthenticationFetch } from '../lib/authentication/http';
import {
  PublicTestnetApiClient,
  PUBLIC_TESTNET_EXECUTION_INTENTS_PATH,
  PUBLIC_TESTNET_POSITION_QUERY_PATH,
} from '../lib/public-testnet/public-testnet-client';
import { PUBLIC_TESTNET_CHAIN_ID } from '../lib/public-testnet/public-testnet-execution';
import {
  PUBLIC_TESTNET_INTENT_ID,
  PUBLIC_TESTNET_NOW,
  PUBLIC_TESTNET_SIGNATURE,
  publicTestnetIntentResponse,
  publicTestnetPositionResponse,
  publicTestnetRequest,
  publicTestnetSubmissionResponse,
} from './public-testnet.fixtures';

const CSRF_TOKEN = 'c'.repeat(43);

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function client(fetch: AuthenticationFetch): PublicTestnetApiClient {
  return new PublicTestnetApiClient({
    fetch,
    cookieHeader: `__Host-cl_csrf=${CSRF_TOKEN}`,
    now: () => PUBLIC_TESTNET_NOW,
  });
}

describe('PublicTestnetApiClient', () => {
  it('creates an exact CSRF-authenticated, portfolio-bound Solana Devnet intent', async () => {
    const requestFetch = vi.fn(async () => response(201, publicTestnetIntentResponse()));

    const result = await client(requestFetch).createIntent(publicTestnetRequest());

    expect(result.intentId).toBe(PUBLIC_TESTNET_INTENT_ID);
    expect(requestFetch).toHaveBeenCalledWith(
      PUBLIC_TESTNET_EXECUTION_INTENTS_PATH,
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
        body: JSON.stringify(publicTestnetRequest()),
      }),
    );
  });

  it('submits only one exact signature and parses finalized verification', async () => {
    const requestFetch = vi.fn(async () => response(200, publicTestnetSubmissionResponse()));

    const result = await client(requestFetch).submitTransaction(
      PUBLIC_TESTNET_INTENT_ID,
      PUBLIC_TESTNET_SIGNATURE,
    );

    expect(result).toMatchObject({
      status: 'VERIFIED',
      confirmation: 'LATEST_SIGNATURE_STATUS_OBSERVATION',
    });
    expect(requestFetch).toHaveBeenCalledWith(
      `${PUBLIC_TESTNET_EXECUTION_INTENTS_PATH}/${PUBLIC_TESTNET_INTENT_ID}/submissions`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ signature: PUBLIC_TESTNET_SIGNATURE }),
      }),
    );
  });

  it('submits one bounded signed transaction for the initial server broadcast', async () => {
    const requestFetch = vi.fn(async () => response(200, publicTestnetSubmissionResponse()));

    await client(requestFetch).submitSignedTransaction(
      PUBLIC_TESTNET_INTENT_ID,
      PUBLIC_TESTNET_SIGNATURE,
      Uint8Array.of(1, 2, 3),
    );

    expect(requestFetch).toHaveBeenCalledWith(
      `${PUBLIC_TESTNET_EXECUTION_INTENTS_PATH}/${PUBLIC_TESTNET_INTENT_ID}/submissions`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          signature: PUBLIC_TESTNET_SIGNATURE,
          signedTransactionBase64: 'AQID',
        }),
      }),
    );
  });

  it('reads a finalized wallet position without creating an execution intent', async () => {
    const requestFetch = vi.fn(async () => response(200, publicTestnetPositionResponse()));

    const result = await client(requestFetch).readPosition({
      chainId: PUBLIC_TESTNET_CHAIN_ID,
      account: publicTestnetRequest().account,
    });

    expect(result).toMatchObject({
      use: 'PUBLIC_TESTNET_READ_ONLY_POSITION',
      mayAuthorizeFinancialAction: false,
      position: { status: 'OPEN', suppliedLiquidityAtomic: '9999999' },
      rate: { supplyApyBasisPoints: 125, historyAvailable: false },
    });
    expect(requestFetch).toHaveBeenCalledWith(
      PUBLIC_TESTNET_POSITION_QUERY_PATH,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          chainId: PUBLIC_TESTNET_CHAIN_ID,
          account: publicTestnetRequest().account,
        }),
      }),
    );
  });

  it.each([
    [410, 'EXPIRED'],
    [409, 'CONFLICT'],
    [422, 'REJECTED'],
    [404, 'UNAVAILABLE'],
    [503, 'UNAVAILABLE'],
  ] as const)(
    'maps submission HTTP %s to fixed error %s without retaining response detail',
    async (status, code) => {
      const secret = 'provider contract internals';
      const requestFetch = vi.fn(async () => response(status, { detail: secret }));

      const error = await client(requestFetch)
        .submitTransaction(PUBLIC_TESTNET_INTENT_ID, PUBLIC_TESTNET_SIGNATURE)
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({ code });
      expect(JSON.stringify(error)).not.toContain(secret);
    },
  );

  it.each([
    ['PUBLIC_TESTNET_BROADCAST_REJECTED', 'BROADCAST_REJECTED'],
    ['PUBLIC_TESTNET_EVIDENCE_MISMATCH', 'REJECTED'],
  ] as const)('maps bounded submission rejection code %s to %s', async (responseCode, code) => {
    const secret = 'private RPC rejection detail';
    const requestFetch = vi.fn(async () =>
      response(422, {
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: secret,
        code: responseCode,
      }),
    );

    const error = await client(requestFetch)
      .submitSignedTransaction(
        PUBLIC_TESTNET_INTENT_ID,
        PUBLIC_TESTNET_SIGNATURE,
        Uint8Array.of(1, 2, 3),
      )
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code });
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  it('does not call the API without a valid CSRF cookie or with malformed input', async () => {
    const requestFetch = vi.fn();
    const noCsrf = new PublicTestnetApiClient({ fetch: requestFetch, cookieHeader: '' });
    await expect(noCsrf.createIntent(publicTestnetRequest())).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(
      client(requestFetch).submitTransaction(PUBLIC_TESTNET_INTENT_ID, 'not-a-signature'),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(
      client(requestFetch).submitSignedTransaction(
        PUBLIC_TESTNET_INTENT_ID,
        PUBLIC_TESTNET_SIGNATURE,
        new Uint8Array(1_233),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it('rejects non-finalized verification semantics as an invalid response', async () => {
    const old = publicTestnetSubmissionResponse();
    old.confirmation = 'FINALIZED_TRANSACTION_OBSERVATION';
    const requestFetch = vi.fn(async () => response(200, old));

    await expect(
      client(requestFetch).submitTransaction(PUBLIC_TESTNET_INTENT_ID, PUBLIC_TESTNET_SIGNATURE),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
