import type { EnabledSmartLendingExternalFeedConfig } from './smart-lending-external-feed.config';
import {
  FixedSmartLendingExternalFeedClient,
  SmartLendingExternalFeedError,
} from './smart-lending-external-feed.client';
import {
  SmartLendingExternalFeedDestination,
  type LifiQuoteQuery,
} from './smart-lending-external-feed.types';

const ETHEREUM_ADDRESS = `0x${'1'.repeat(40)}`;
const SOLANA_ADDRESS = '11111111111111111111111111111111';

function enabledConfig(
  overrides: Partial<EnabledSmartLendingExternalFeedConfig> = {},
): EnabledSmartLendingExternalFeedConfig {
  return {
    mode: 'enabled',
    approval: null,
    lifiApiKey: null,
    killSwitches: {
      [SmartLendingExternalFeedDestination.DefiLlamaYields]: false,
      [SmartLendingExternalFeedDestination.LifiQuote]: false,
    },
    ...overrides,
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers },
  });
}

function lifiQuery(): LifiQuoteQuery {
  return {
    fromChain: '1',
    toChain: 'SOL',
    fromToken: '0x1111111111111111111111111111111111111111',
    toToken: 'So11111111111111111111111111111111111111112',
    fromAmount: '1000000',
    fromAddress: ETHEREUM_ADDRESS,
    toAddress: SOLANA_ADDRESS,
    slippage: '0.005',
    integrator: 'crypto-lending',
    allowBridges: 'mayan',
    denyExchanges: 'all',
    allowDestinationCall: 'false',
    order: 'CHEAPEST',
  };
}

describe('FixedSmartLendingExternalFeedClient', () => {
  it('fails before fetch when feeds are globally disabled', async () => {
    const fetcher = jest.fn();
    const client = new FixedSmartLendingExternalFeedClient({ mode: 'disabled' }, fetcher);
    await expect(
      client.get(SmartLendingExternalFeedDestination.DefiLlamaYields, {}),
    ).rejects.toMatchObject({ code: 'FEEDS_DISABLED' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails before fetch when a destination kill switch is active', async () => {
    const fetcher = jest.fn();
    const client = new FixedSmartLendingExternalFeedClient(
      enabledConfig({
        killSwitches: {
          [SmartLendingExternalFeedDestination.DefiLlamaYields]: true,
          [SmartLendingExternalFeedDestination.LifiQuote]: false,
        },
      }),
      fetcher,
    );
    await expect(
      client.get(SmartLendingExternalFeedDestination.DefiLlamaYields, {}),
    ).rejects.toMatchObject({ code: 'DESTINATION_DISABLED' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'rejects prototype property %s as an invalid runtime destination',
    async (destination) => {
      const fetcher = jest.fn();
      const client = new FixedSmartLendingExternalFeedClient(enabledConfig(), fetcher);

      await expect(client.get(destination as never, {} as never)).rejects.toMatchObject({
        code: 'INVALID_DESTINATION',
        message: 'Smart-lending external feed is unavailable',
      });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('uses only the fixed DefiLlama URL and locked-down GET options', async () => {
    const fetcher = jest.fn(async () => jsonResponse({ data: [{ pool: 'one' }] }));
    const client = new FixedSmartLendingExternalFeedClient(enabledConfig(), fetcher);

    await expect(
      client.get(SmartLendingExternalFeedDestination.DefiLlamaYields, {}),
    ).resolves.toEqual({ data: [{ pool: 'one' }] });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [input, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(input.href).toBe('https://yields.llama.fi/pools');
    expect(init).toMatchObject({
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    expect(init.body).toBeUndefined();
  });

  it('rejects all DefiLlama query parameters and accessor properties', async () => {
    const fetcher = jest.fn();
    const client = new FixedSmartLendingExternalFeedClient(enabledConfig(), fetcher);
    await expect(
      client.get(SmartLendingExternalFeedDestination.DefiLlamaYields, {
        endpoint: 'https://attacker.invalid',
      } as never),
    ).rejects.toMatchObject({ code: 'INVALID_QUERY' });

    const accessor = Object.defineProperty({}, 'endpoint', {
      enumerable: true,
      get: () => 'https://attacker.invalid',
    });
    await expect(
      client.get(SmartLendingExternalFeedDestination.DefiLlamaYields, accessor as never),
    ).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('builds a deterministic allowlisted LI.FI query and scopes the API key to LI.FI', async () => {
    const fetcher = jest.fn(async () => jsonResponse({ estimate: { toAmountMin: '999000' } }));
    const client = new FixedSmartLendingExternalFeedClient(
      enabledConfig({ lifiApiKey: 'server-only-key' }),
      fetcher,
    );
    await client.get(SmartLendingExternalFeedDestination.LifiQuote, lifiQuery());

    const [input, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(input.origin + input.pathname).toBe('https://li.quest/v1/quote');
    expect([...input.searchParams.keys()]).toEqual([
      'fromChain',
      'toChain',
      'fromToken',
      'toToken',
      'fromAmount',
      'fromAddress',
      'toAddress',
      'slippage',
      'integrator',
      'allowBridges',
      'denyExchanges',
      'allowDestinationCall',
      'order',
    ]);
    expect(init.headers).toEqual({
      accept: 'application/json',
      'x-lifi-api-key': 'server-only-key',
    });
  });

  it('never sends the LI.FI key to DefiLlama', async () => {
    const fetcher = jest.fn(async () => jsonResponse({ data: [] }));
    const client = new FixedSmartLendingExternalFeedClient(
      enabledConfig({ lifiApiKey: 'server-only-key' }),
      fetcher,
    );
    await client.get(SmartLendingExternalFeedDestination.DefiLlamaYields, {});
    const [, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.headers).toEqual({ accept: 'application/json' });
  });

  it.each([
    { ...lifiQuery(), toChain: 'ETH' },
    { ...lifiQuery(), fromChain: 'ETH' },
    { ...lifiQuery(), fromChain: '8453' },
    { ...lifiQuery(), slippage: '0.01' },
    { ...lifiQuery(), integrator: 'other' },
    { ...lifiQuery(), fromAmount: '0' },
    { ...lifiQuery(), fromAddress: SOLANA_ADDRESS },
    { ...lifiQuery(), unexpected: 'value' },
    { ...lifiQuery(), denyBridges: 'mayan' },
    { ...lifiQuery(), allowBridges: 'all,mayan' },
    { ...lifiQuery(), denyExchanges: '*' },
    { ...lifiQuery(), allowDestinationCall: 'true' },
    { ...lifiQuery(), order: 'FASTEST' },
  ])('rejects a non-allowlisted or invalid LI.FI query', async (query) => {
    const fetcher = jest.fn();
    const client = new FixedSmartLendingExternalFeedClient(enabledConfig(), fetcher);
    await expect(
      client.get(SmartLendingExternalFeedDestination.LifiQuote, query as LifiQuoteQuery),
    ).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires status 200, the exact URL, and JSON content type', async () => {
    const mismatchedUrl = jsonResponse({});
    Object.defineProperty(mismatchedUrl, 'url', {
      configurable: true,
      value: 'https://attacker.invalid/',
    });
    const responses = [
      new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }),
      new Response('{}', { status: 200, headers: { 'content-type': 'text/html' } }),
      mismatchedUrl,
    ];
    for (const response of responses) {
      const client = new FixedSmartLendingExternalFeedClient(
        enabledConfig(),
        jest.fn(async () => response),
      );
      await expect(
        client.get(SmartLendingExternalFeedDestination.DefiLlamaYields, {}),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
      expect(response.bodyUsed).toBe(true);
    }
  });

  it('sanitizes an invalid response object without evaluating it outside the error boundary', async () => {
    const malformed = Object.create(null) as Response;
    Object.defineProperty(malformed, 'status', {
      enumerable: true,
      get: () => {
        throw new Error('attacker-controlled response detail');
      },
    });
    const client = new FixedSmartLendingExternalFeedClient(
      enabledConfig(),
      jest.fn(async () => malformed),
    );

    await expect(
      client.get(SmartLendingExternalFeedDestination.DefiLlamaYields, {}),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'Smart-lending external feed is unavailable',
    });
  });

  it('rejects declared oversized responses and malformed JSON', async () => {
    const oversized = new Response('{}', {
      headers: {
        'content-type': 'application/json',
        'content-length': String(32 * 1_024 * 1_024 + 1),
      },
    });
    const oversizedClient = new FixedSmartLendingExternalFeedClient(
      enabledConfig(),
      jest.fn(async () => oversized),
    );
    await expect(
      oversizedClient.get(SmartLendingExternalFeedDestination.DefiLlamaYields, {}),
    ).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
    expect(oversized.bodyUsed).toBe(true);

    const malformedClient = new FixedSmartLendingExternalFeedClient(
      enabledConfig(),
      jest.fn(
        async () =>
          new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    await expect(
      malformedClient.get(SmartLendingExternalFeedDestination.DefiLlamaYields, {}),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('sanitizes transport failures without exposing URL, response body, or API key', async () => {
    const sensitive = 'server-only-key';
    const client = new FixedSmartLendingExternalFeedClient(
      enabledConfig({ lifiApiKey: sensitive }),
      jest.fn(async () => {
        throw new Error(`${sensitive} https://li.quest/private response-body`);
      }),
    );
    try {
      await client.get(SmartLendingExternalFeedDestination.LifiQuote, lifiQuery());
      throw new Error('expected request failure');
    } catch (error) {
      expect(error).toBeInstanceOf(SmartLendingExternalFeedError);
      expect(error).toMatchObject({ code: 'REQUEST_FAILED' });
      expect(String(error)).not.toContain(sensitive);
      expect(String(error)).not.toContain('li.quest');
      expect(String(error)).not.toContain('response-body');
    }
  });

  it('aborts a request at the fixed destination timeout', async () => {
    jest.useFakeTimers();
    try {
      const fetcher = jest.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            });
          }),
      );
      const client = new FixedSmartLendingExternalFeedClient(enabledConfig(), fetcher);
      const pending = client.get(SmartLendingExternalFeedDestination.LifiQuote, lifiQuery());
      const rejection = expect(pending).rejects.toMatchObject({ code: 'REQUEST_FAILED' });
      await jest.advanceTimersByTimeAsync(7_000);
      await rejection;
    } finally {
      jest.useRealTimers();
    }
  });
});
