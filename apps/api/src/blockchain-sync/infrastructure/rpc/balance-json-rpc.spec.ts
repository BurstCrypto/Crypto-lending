import { BalanceSyncIndexerFailure } from '../../domain/balance-sync';
import {
  createBalanceSyncExecutionContext,
  reviewBalanceSyncExecutionContext,
  type BalanceSyncExecutionContext,
} from '../../application/ports/balance-sync.ports';
import {
  BalanceJsonRpcTransportFailure,
  balanceRpcRequest,
  canonicalPositionId,
  exchangeBalanceRpc,
  parseBalanceRpcResult,
  type BalanceJsonRpcRequest,
  type BalanceJsonRpcTransport,
} from './balance-json-rpc';

const EXPECTED_ID = 'a'.repeat(64);

function success(id: string, result: unknown): unknown {
  return { jsonrpc: '2.0', id, result };
}

function transportWith(
  exchange: (request: BalanceJsonRpcRequest, signal: AbortSignal) => Promise<unknown>,
): BalanceJsonRpcTransport {
  return { exchange };
}

const TEST_EXECUTION = createBalanceSyncExecutionContext();

async function rejection(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error('expected operation to reject');
}

describe('balance JSON-RPC boundary', () => {
  describe('request snapshots', () => {
    it('creates canonical IDs from an owned deeply frozen JSON tree', () => {
      const nested = { z: [1, true, null], a: { value: 'original' } };
      const request = balanceRpcRequest('test_Method1', [nested]);
      const reordered = balanceRpcRequest('test_Method1', [
        { a: { value: 'original' }, z: [1, true, null] },
      ]);

      nested.a.value = 'mutated';
      nested.z.push(2);

      expect(request.id).toMatch(/^[0-9a-f]{64}$/u);
      expect(request.id).toBe(reordered.id);
      expect(request.params).toEqual([{ a: { value: 'original' }, z: [1, true, null] }]);
      expect(request.params).not.toBe(nested);
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(request.params)).toBe(true);
      const copied = request.params[0] as Record<string, unknown>;
      expect(Object.isFrozen(copied)).toBe(true);
      expect(Object.isFrozen(copied.a)).toBe(true);
      expect(Object.isFrozen(copied.z)).toBe(true);
      expect(balanceRpcRequest('differentMethod', reordered.params).id).not.toBe(request.id);
    });

    it('supports data-only null-prototype records without retaining their identity', () => {
      const input = Object.assign(Object.create(null) as Record<string, unknown>, { value: 1 });
      const request = balanceRpcRequest('method', [input]);
      const copied = request.params[0] as Record<string, unknown>;

      expect(copied).not.toBe(input);
      expect(Object.getPrototypeOf(copied)).toBeNull();
      expect(Object.isFrozen(copied)).toBe(true);
      expect(copied.value).toBe(1);
    });

    it('rejects accessors without invoking them', () => {
      let getterReads = 0;
      const value: Record<string, unknown> = {};
      Object.defineProperty(value, 'secret', {
        enumerable: true,
        get: () => {
          getterReads += 1;
          return 'must-not-run';
        },
      });

      expect(() => balanceRpcRequest('method', [value])).toThrow(
        new TypeError('invalid JSON-RPC params'),
      );
      expect(getterReads).toBe(0);
    });

    it.each([
      ['undefined', [undefined]],
      ['function', [() => undefined]],
      ['symbol value', [Symbol('value')]],
      ['bigint', [1n]],
      ['NaN', [Number.NaN]],
      ['positive infinity', [Number.POSITIVE_INFINITY]],
      ['date', [new Date(0)]],
      ['class instance', [new (class Example {})()]],
    ])('rejects non-JSON %s params', (_name, params) => {
      expect(() => balanceRpcRequest('method', params)).toThrow(
        new TypeError('invalid JSON-RPC params'),
      );
    });

    it('rejects ambiguous, sparse, decorated, cyclic, deep, numerous, and oversized trees', () => {
      const sparse = new Array(1) as unknown[];
      const decorated = [null] as unknown[] & { extra?: boolean };
      decorated.extra = true;
      const hidden = {};
      Object.defineProperty(hidden, 'value', { enumerable: false, value: 1 });
      const symbolKey = { value: 1 } as Record<PropertyKey, unknown>;
      symbolKey[Symbol('extra')] = true;
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      let deep: Record<string, unknown> = {};
      for (let index = 0; index < 34; index += 1) deep = { child: deep };

      for (const params of [
        sparse,
        decorated,
        [hidden],
        [symbolKey],
        [cyclic],
        [deep],
        Array.from({ length: 200_000 }, () => null),
        ['x'.repeat(4 * 1024 * 1024)],
      ]) {
        expect(() => balanceRpcRequest('method', params)).toThrow(
          new TypeError('invalid JSON-RPC params'),
        );
      }
    });

    it('rejects runtime non-arrays and invalid methods before transport use', () => {
      expect(() => balanceRpcRequest('1method', [])).toThrow(
        new TypeError('invalid JSON-RPC method'),
      );
      expect(() => balanceRpcRequest('method-name', [])).toThrow(
        new TypeError('invalid JSON-RPC method'),
      );
      expect(() => balanceRpcRequest('m'.repeat(65), [])).toThrow(
        new TypeError('invalid JSON-RPC method'),
      );
      expect(() => balanceRpcRequest('method', null as unknown as readonly unknown[])).toThrow(
        new TypeError('invalid JSON-RPC params'),
      );
    });
  });

  describe('response snapshots', () => {
    it('returns an owned deeply frozen result and never reads through property getters', () => {
      const original = { nested: { value: 'original' }, items: [1, 2] };
      let propertyReads = 0;
      const response = new Proxy(success(EXPECTED_ID, original) as Record<string, unknown>, {
        get: () => {
          propertyReads += 1;
          throw new Error('property access is forbidden');
        },
      });
      const parsed = parseBalanceRpcResult(response, EXPECTED_ID) as {
        nested: { value: string };
        items: number[];
      };

      original.nested.value = 'mutated';
      original.items.push(3);

      expect(propertyReads).toBe(0);
      expect(parsed).not.toBe(original);
      expect(parsed).toEqual({ items: [1, 2], nested: { value: 'original' } });
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(Object.isFrozen(parsed.nested)).toBe(true);
      expect(Object.isFrozen(parsed.items)).toBe(true);
    });

    it('rejects accessor-backed responses without invoking accessors', () => {
      let getterReads = 0;
      const response: Record<string, unknown> = { jsonrpc: '2.0', id: EXPECTED_ID };
      Object.defineProperty(response, 'result', {
        enumerable: true,
        get: () => {
          getterReads += 1;
          return 'secret';
        },
      });

      expect(() => parseBalanceRpcResult(response, EXPECTED_ID)).toThrow(
        expect.objectContaining({ code: 'PROVIDER_INVALID_DATA' }),
      );
      expect(getterReads).toBe(0);
    });

    it.each([
      { jsonrpc: '2.0', id: EXPECTED_ID },
      { jsonrpc: '2.0', id: 'b'.repeat(64), result: 1 },
      { jsonrpc: '1.0', id: EXPECTED_ID, result: 1 },
      { jsonrpc: '2.0', id: EXPECTED_ID, result: 1, error: { code: -1, message: 'x' } },
      { jsonrpc: '2.0', id: EXPECTED_ID, result: 1, extra: true },
      Object.create({ jsonrpc: '2.0', id: EXPECTED_ID, result: 1 }),
    ])('rejects an invalid response envelope', (response) => {
      expect(() => parseBalanceRpcResult(response, EXPECTED_ID)).toThrow(
        expect.objectContaining({ code: 'PROVIDER_INVALID_DATA' }),
      );
    });

    it.each([
      [{ code: 'bad', message: 'message' }],
      [{ code: 1.5, message: 'message' }],
      [{ code: 1, message: '' }],
      [{ code: 1, message: 'x'.repeat(513) }],
      [{ code: 1, message: 'message', data: 'unreviewed' }],
    ])('rejects malformed provider error data', (error) => {
      expect(() =>
        parseBalanceRpcResult({ jsonrpc: '2.0', id: EXPECTED_ID, error }, EXPECTED_ID),
      ).toThrow(expect.objectContaining({ code: 'PROVIDER_INVALID_DATA' }));
    });

    it.each([
      [-32601, 'PERMANENT_PROVIDER_FAILURE'],
      [-32602, 'PERMANENT_PROVIDER_FAILURE'],
      [-32000, 'PROVIDER_UNAVAILABLE'],
    ] as const)('maps provider error %i to %s without retaining its message', (code, expected) => {
      const providerSecret = 'provider-secret-must-not-escape';
      let thrown: unknown;
      try {
        parseBalanceRpcResult(
          { jsonrpc: '2.0', id: EXPECTED_ID, error: { code, message: providerSecret } },
          EXPECTED_ID,
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toMatchObject({ code: expected, message: expected });
      expect(JSON.stringify(thrown)).not.toContain(providerSecret);
      expect(String(thrown)).not.toContain(providerSecret);
      expect(Object.prototype.hasOwnProperty.call(thrown, 'cause')).toBe(false);
    });

    it('rejects non-JSON values anywhere in a bounded response', () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      const decorated = [1] as number[] & { extra?: boolean };
      decorated.extra = true;
      for (const value of [undefined, 1n, Number.NaN, Symbol('x'), cyclic, decorated]) {
        expect(() => parseBalanceRpcResult(success(EXPECTED_ID, value), EXPECTED_ID)).toThrow(
          expect.objectContaining({ code: 'PROVIDER_INVALID_DATA' }),
        );
      }
      expect(() => parseBalanceRpcResult(success(EXPECTED_ID, 1), 'not-an-id')).toThrow(
        expect.objectContaining({ code: 'PROVIDER_INVALID_DATA' }),
      );
    });
  });

  describe('transport failure isolation', () => {
    it.each([
      ['TIMEOUT', undefined, 'PROVIDER_TIMEOUT'],
      ['RATE_LIMITED', 17, 'RATE_LIMITED'],
      ['UNAVAILABLE', undefined, 'PROVIDER_UNAVAILABLE'],
      ['PERMANENT', undefined, 'PERMANENT_PROVIDER_FAILURE'],
    ] as const)('maps a branded %s failure', async (code, retryAfterSeconds, expected) => {
      let calls = 0;
      const failure = new BalanceJsonRpcTransportFailure(
        code,
        retryAfterSeconds === undefined ? {} : { retryAfterSeconds },
      );
      const error = await rejection(
        exchangeBalanceRpc(
          transportWith(async () => {
            calls += 1;
            throw failure;
          }),
          'method',
          [],
          TEST_EXECUTION.context,
        ),
      );

      expect(error).toMatchObject({
        code: expected,
        message: expected,
        retryAfterSeconds,
      });
      expect(calls).toBe(1);
    });

    it('keeps response parsing outside the transport catch', async () => {
      let calls = 0;
      const error = await rejection(
        exchangeBalanceRpc(
          transportWith(async (request) => {
            calls += 1;
            return { jsonrpc: '2.0', id: request.id, unexpected: true };
          }),
          'method',
          [],
          TEST_EXECUTION.context,
        ),
      );

      expect(error).toMatchObject({
        code: 'PROVIDER_INVALID_DATA',
        message: 'PROVIDER_INVALID_DATA',
      });
      expect(calls).toBe(1);
    });

    it('does not trust raw, domain-shaped, forged, proxied, or hostile thrown values', async () => {
      const providerSecret = 'raw-provider-secret';
      const genuine = new BalanceJsonRpcTransportFailure('PERMANENT');
      const forged = Object.create(
        BalanceJsonRpcTransportFailure.prototype,
        Object.getOwnPropertyDescriptors(genuine),
      ) as BalanceJsonRpcTransportFailure;
      let proxyReads = 0;
      const proxied = new Proxy(genuine, {
        get: () => {
          proxyReads += 1;
          throw new Error('must not inspect');
        },
      });
      const hostile = new Proxy(
        {},
        {
          get: () => {
            throw new Error('must not inspect');
          },
          getPrototypeOf: () => {
            throw new Error('must not inspect');
          },
          ownKeys: () => {
            throw new Error('must not inspect');
          },
        },
      );
      const thrownValues: readonly unknown[] = [
        new Error(providerSecret),
        providerSecret,
        { code: 'PERMANENT', message: providerSecret },
        new BalanceSyncIndexerFailure('PERMANENT_PROVIDER_FAILURE'),
        forged,
        proxied,
        hostile,
      ];

      for (const thrownValue of thrownValues) {
        const error = await rejection(
          exchangeBalanceRpc(
            transportWith(async () => {
              throw thrownValue;
            }),
            'method',
            [],
            TEST_EXECUTION.context,
          ),
        );
        expect(error).toMatchObject({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'PROVIDER_UNAVAILABLE',
        });
        expect(JSON.stringify(error)).not.toContain(providerSecret);
        expect(Object.prototype.hasOwnProperty.call(error, 'cause')).toBe(false);
      }
      expect(proxyReads).toBe(0);
    });

    it.each([
      ['DEADLINE', 'PROVIDER_TIMEOUT'],
      ['SHUTDOWN', 'PROVIDER_UNAVAILABLE'],
    ] as const)(
      'rejects a pre-aborted %s execution without invoking transport',
      async (kind, code) => {
        const execution = createBalanceSyncExecutionContext();
        execution.abort(kind);
        const exchange = jest.fn(async () => undefined);

        await expect(
          exchangeBalanceRpc(transportWith(exchange), 'method', [], execution.context),
        ).rejects.toMatchObject({ code, message: code });
        expect(exchange).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['DEADLINE', 'PROVIDER_TIMEOUT'],
      ['SHUTDOWN', 'PROVIDER_UNAVAILABLE'],
    ] as const)(
      'passes one exact signal and maps a compliant mid-flight %s abort',
      async (kind, code) => {
        const execution = createBalanceSyncExecutionContext();
        let receivedSignal: AbortSignal | undefined;
        const pending = exchangeBalanceRpc(
          transportWith(
            async (_request, signal) =>
              new Promise((_resolve, reject) => {
                receivedSignal = signal;
                signal.addEventListener('abort', () => reject(new Error('raw abort detail')), {
                  once: true,
                });
              }),
          ),
          'method',
          [],
          execution.context,
        );
        await new Promise<void>((resolve) => setImmediate(resolve));

        execution.abort(kind);
        await expect(pending).rejects.toMatchObject({ code, message: code });
        expect(receivedSignal).toBe(reviewSignal(execution.context));
      },
    );

    it('lets an execution abort win over a valid response resolved afterward', async () => {
      const execution = createBalanceSyncExecutionContext();
      let resolveTransport: (() => void) | undefined;
      const pending = exchangeBalanceRpc(
        transportWith(
          async (request) =>
            new Promise((resolve) => {
              resolveTransport = () => resolve(success(request.id, 'late-valid-result'));
            }),
        ),
        'method',
        [],
        execution.context,
      );
      await new Promise<void>((resolve) => setImmediate(resolve));

      execution.abort('DEADLINE');
      resolveTransport?.();

      await expect(pending).rejects.toMatchObject({
        code: 'PROVIDER_TIMEOUT',
        message: 'PROVIDER_TIMEOUT',
      });
    });

    it('rejects counterfeit and proxied execution contexts without inspecting them', async () => {
      let reads = 0;
      const hostile = new Proxy(Object.create(null) as object, {
        get: () => {
          reads += 1;
          throw new Error('must not read context');
        },
        getPrototypeOf: () => {
          reads += 1;
          throw new Error('must not inspect context');
        },
      });
      const exchange = jest.fn(async () => undefined);
      for (const context of [{ signal: new AbortController().signal }, hostile]) {
        await expect(
          exchangeBalanceRpc(
            transportWith(exchange),
            'method',
            [],
            context as BalanceSyncExecutionContext,
          ),
        ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
      }
      expect(exchange).not.toHaveBeenCalled();
      expect(reads).toBe(0);
    });

    it('validates requests before invoking the transport', async () => {
      let calls = 0;
      const error = await rejection(
        exchangeBalanceRpc(
          transportWith(async () => {
            calls += 1;
            return undefined;
          }),
          'invalid-method',
          [],
          TEST_EXECUTION.context,
        ),
      );

      expect(error).toEqual(new TypeError('invalid JSON-RPC method'));
      expect(calls).toBe(0);
    });
  });

  describe('transport failures and position IDs', () => {
    it('brands and freezes only valid constructed transport failures', () => {
      const failure = new BalanceJsonRpcTransportFailure('RATE_LIMITED', {
        retryAfterSeconds: 0,
      });
      expect(Object.isFrozen(failure)).toBe(true);
      expect(failure).toMatchObject({
        code: 'RATE_LIMITED',
        message: 'RATE_LIMITED',
        retryAfterSeconds: 0,
      });

      for (const retryAfterSeconds of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        expect(
          () => new BalanceJsonRpcTransportFailure('RATE_LIMITED', { retryAfterSeconds }),
        ).toThrow(new TypeError('invalid balance JSON-RPC transport failure'));
      }
      expect(() => new BalanceJsonRpcTransportFailure('UNKNOWN' as unknown as 'TIMEOUT')).toThrow(
        new TypeError('invalid balance JSON-RPC transport failure'),
      );
    });

    it('preserves valid position IDs while rejecting the NUL-delimiter collision', () => {
      const valid = canonicalPositionId(['account', 'wallet', 'network', 'asset']);
      expect(valid).toMatch(/^[0-9a-f]{64}$/u);
      expect(canonicalPositionId(['account', 'wallet', 'network', 'asset'])).toBe(valid);

      expect(() => canonicalPositionId(['a', 'b\0c'])).toThrow(
        new TypeError('invalid balance position id parts'),
      );
      expect(() => canonicalPositionId(['a\0b', 'c'])).toThrow(
        new TypeError('invalid balance position id parts'),
      );
      expect(() => canonicalPositionId([1 as unknown as string])).toThrow(
        new TypeError('invalid balance position id parts'),
      );
      expect(() => canonicalPositionId(null as unknown as readonly string[])).toThrow(
        new TypeError('invalid balance position id parts'),
      );
    });
  });
});

function reviewSignal(context: BalanceSyncExecutionContext): AbortSignal | undefined {
  return reviewBalanceSyncExecutionContext(context)?.signal;
}
