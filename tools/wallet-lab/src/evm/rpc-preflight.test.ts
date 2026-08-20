import { describe, expect, it, vi } from 'vitest';

import { preflightEvmTestnetRpcs } from './rpc-preflight';
import { resolveEvmRuntimeSettings, type ReadyEvmRuntimeSettings } from './runtime-env';

function settings(): ReadyEvmRuntimeSettings {
  const result = resolveEvmRuntimeSettings(
    {
      DEV: true,
      VITE_WALLET_LAB_ENABLED: 'true',
      VITE_WALLETCONNECT_TERMS_ACCEPTED: 'false',
      VITE_SEPOLIA_RPC_URL: 'https://sepolia.example.test',
      VITE_BASE_SEPOLIA_RPC_URL: 'https://base.example.test',
    },
    'https://127.0.0.1:4173',
  );
  if (!result.enabled) throw new Error(`Expected ready settings: ${result.reason}`);
  return result;
}

function streamBody(value: string): ReadableStream<Uint8Array<ArrayBuffer>> {
  const bytes = new TextEncoder().encode(value);
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function response(result: unknown, overrides: Partial<Response> = {}): Response {
  return {
    body: streamBody(JSON.stringify({ jsonrpc: '2.0', id: 1, result })),
    ok: true,
    redirected: false,
    headers: new Headers(),
    ...overrides,
  } as unknown as Response;
}

describe('preflightEvmTestnetRpcs', () => {
  it('accepts only exact Sepolia and Base Sepolia chain identities', async () => {
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response('0xaa36a7'))
      .mockResolvedValueOnce(response('0x14a34'));

    await expect(
      preflightEvmTestnetRpcs(settings(), { fetch: fetchSpy, timeoutMs: 100 }),
    ).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
    });
  });

  it.each([
    ['Ethereum mainnet', '0x1', '0x14a34'],
    ['Base mainnet', '0xaa36a7', '0x2105'],
    ['swapped endpoints', '0x14a34', '0xaa36a7'],
    ['missing result', undefined, '0x14a34'],
  ])('blocks %s', async (_label, first, second) => {
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(first))
      .mockResolvedValueOnce(response(second));

    await expect(
      preflightEvmTestnetRpcs(settings(), { fetch: fetchSpy, timeoutMs: 100 }),
    ).rejects.toThrow('evm-rpc-preflight-failed');
  });

  it.each([
    ['HTTP failure', response('0xaa36a7', { ok: false })],
    ['redirect', response('0xaa36a7', { redirected: true })],
  ])('blocks a %s', async (_label, first) => {
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(response('0x14a34'));
    await expect(
      preflightEvmTestnetRpcs(settings(), { fetch: fetchSpy, timeoutMs: 100 }),
    ).rejects.toThrow('evm-rpc-preflight-failed');
  });

  it('blocks malformed JSON, network failures, and timeouts with one safe error code', async () => {
    const malformed = response('0xaa36a7', {
      body: streamBody('{not-json'),
    });
    const malformedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(malformed)
      .mockResolvedValueOnce(response('0x14a34'));
    await expect(
      preflightEvmTestnetRpcs(settings(), { fetch: malformedFetch, timeoutMs: 100 }),
    ).rejects.toThrow('evm-rpc-preflight-failed');

    const networkFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error('private detail'));
    await expect(
      preflightEvmTestnetRpcs(settings(), { fetch: networkFetch, timeoutMs: 100 }),
    ).rejects.toThrow('evm-rpc-preflight-failed');

    const timeoutFetch = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted')));
        }),
    );
    await expect(
      preflightEvmTestnetRpcs(settings(), { fetch: timeoutFetch, timeoutMs: 1 }),
    ).rejects.toThrow('evm-rpc-preflight-failed');
  });

  it('cancels a chunked response as soon as it exceeds the byte limit', async () => {
    const cancel = vi.fn();
    const oversizedBody = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.enqueue(new Uint8Array(4_096));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel,
    });
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response('0xaa36a7', { body: oversizedBody }))
      .mockResolvedValueOnce(response('0x14a34'));

    await expect(
      preflightEvmTestnetRpcs(settings(), { fetch: fetchSpy, timeoutMs: 100 }),
    ).rejects.toThrow('evm-rpc-preflight-failed');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels a response rejected from its declared byte length', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({ cancel });
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response('0xaa36a7', {
          body,
          headers: new Headers({ 'content-length': '4097' }),
        }),
      )
      .mockResolvedValueOnce(response('0x14a34'));

    await expect(
      preflightEvmTestnetRpcs(settings(), { fetch: fetchSpy, timeoutMs: 100 }),
    ).rejects.toThrow('evm-rpc-preflight-failed');
    expect(cancel).toHaveBeenCalledOnce();
  });
});
