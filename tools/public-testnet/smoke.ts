import { validatePublicTestnetProfiles, type PublicTestnetProfile } from './profiles';

const MAX_RESPONSE_BYTES = 65_536;
const REQUEST_TIMEOUT_MS = 7_000;
const EVM_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu;
const EVM_HASH = /^0x[0-9a-f]{64}$/iu;
const ALLOWED_METHODS = new Set([
  'eth_chainId',
  'eth_getBlockByNumber',
  'getGenesisHash',
  'getSlot',
]);

export type PublicTestnetSmokeResult = Readonly<{
  family: PublicTestnetProfile['family'];
  name: string;
  networkId: PublicTestnetProfile['networkId'];
  identity: string;
  finalizedPosition: string;
}>;

export type PublicTestnetSmokeDependencies = Readonly<{
  fetch: typeof fetch;
  timeoutMs: number;
}>;

const DEFAULT_DEPENDENCIES: PublicTestnetSmokeDependencies = Object.freeze({
  fetch: globalThis.fetch.bind(globalThis),
  timeoutMs: REQUEST_TIMEOUT_MS,
});

export class PublicTestnetSmokeError extends Error {
  constructor(code: string, networkId?: string) {
    super(networkId ? `${code}:${networkId}` : code);
    this.name = 'PublicTestnetSmokeError';
  }
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A response that cannot be safely drained still fails closed.
  }
}

async function readBoundedBody(response: Response): Promise<string> {
  if (!response.body) throw new PublicTestnetSmokeError('PUBLIC_TESTNET_RESPONSE_INVALID');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let complete = false;
  let length = 0;

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        complete = true;
        break;
      }
      length += chunk.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        throw new PublicTestnetSmokeError('PUBLIC_TESTNET_RESPONSE_TOO_LARGE');
      }
      chunks.push(chunk.value);
    }
  } finally {
    if (!complete) {
      try {
        await reader.cancel();
      } catch {
        // The bounded read still fails closed when cancellation is rejected.
      }
    }
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function rpcRead(
  profile: PublicTestnetProfile,
  id: number,
  method: string,
  params: readonly unknown[],
  dependencies: PublicTestnetSmokeDependencies,
): Promise<unknown> {
  if (!ALLOWED_METHODS.has(method)) {
    throw new PublicTestnetSmokeError('PUBLIC_TESTNET_METHOD_BLOCKED', profile.networkId);
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), dependencies.timeoutMs);

  try {
    const response = await dependencies.fetch(profile.endpoint, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      cache: 'no-store',
      credentials: 'omit',
      headers: Object.freeze({
        accept: 'application/json',
        'content-type': 'application/json',
      }),
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });

    const contentLength = response.headers.get('content-length');
    const declaredLength = contentLength === null ? null : Number(contentLength);
    if (
      !response.ok ||
      response.redirected ||
      (declaredLength !== null &&
        (!Number.isSafeInteger(declaredLength) ||
          declaredLength < 0 ||
          declaredLength > MAX_RESPONSE_BYTES))
    ) {
      await cancelBody(response);
      throw new PublicTestnetSmokeError('PUBLIC_TESTNET_HTTP_FAILED', profile.networkId);
    }

    const body = await readBoundedBody(response);
    const payload: unknown = JSON.parse(body);
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload) ||
      Reflect.get(payload, 'jsonrpc') !== '2.0' ||
      Reflect.get(payload, 'id') !== id ||
      Reflect.has(payload, 'error') ||
      !Reflect.has(payload, 'result')
    ) {
      throw new PublicTestnetSmokeError('PUBLIC_TESTNET_RPC_FAILED', profile.networkId);
    }
    return Reflect.get(payload, 'result');
  } catch (error) {
    if (error instanceof PublicTestnetSmokeError) throw error;
    throw new PublicTestnetSmokeError('PUBLIC_TESTNET_REQUEST_FAILED', profile.networkId);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function parseEvmFinalizedBlock(value: unknown, networkId: string): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    typeof Reflect.get(value, 'number') !== 'string' ||
    !EVM_QUANTITY.test(Reflect.get(value, 'number') as string) ||
    typeof Reflect.get(value, 'hash') !== 'string' ||
    !EVM_HASH.test(Reflect.get(value, 'hash') as string) ||
    typeof Reflect.get(value, 'parentHash') !== 'string' ||
    !EVM_HASH.test(Reflect.get(value, 'parentHash') as string)
  ) {
    throw new PublicTestnetSmokeError('PUBLIC_TESTNET_FINALIZED_HEAD_INVALID', networkId);
  }

  return BigInt(Reflect.get(value, 'number') as string).toString(10);
}

function parseSolanaFinalizedSlot(value: unknown, networkId: string): string {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new PublicTestnetSmokeError('PUBLIC_TESTNET_FINALIZED_HEAD_INVALID', networkId);
  }
  return String(value);
}

async function probeProfile(
  profile: PublicTestnetProfile,
  dependencies: PublicTestnetSmokeDependencies,
): Promise<PublicTestnetSmokeResult> {
  const identity = await rpcRead(
    profile,
    1,
    profile.identityProbe.method,
    profile.identityProbe.params,
    dependencies,
  );
  if (identity !== profile.identityProbe.expectedResult) {
    throw new PublicTestnetSmokeError('PUBLIC_TESTNET_IDENTITY_MISMATCH', profile.networkId);
  }

  const finalized = await rpcRead(
    profile,
    2,
    profile.finalizedProbe.method,
    profile.finalizedProbe.params,
    dependencies,
  );

  return Object.freeze({
    family: profile.family,
    name: profile.name,
    networkId: profile.networkId,
    identity,
    finalizedPosition:
      profile.family === 'EVM'
        ? parseEvmFinalizedBlock(finalized, profile.networkId)
        : parseSolanaFinalizedSlot(finalized, profile.networkId),
  });
}

/**
 * Performs exactly two standard JSON-RPC reads per configured public testnet:
 * immutable network identity followed by a finalized head/slot observation.
 */
export async function runPublicTestnetSmoke(
  profiles: readonly PublicTestnetProfile[],
  dependencies: PublicTestnetSmokeDependencies = DEFAULT_DEPENDENCIES,
): Promise<readonly PublicTestnetSmokeResult[]> {
  validatePublicTestnetProfiles(profiles);
  if (
    typeof dependencies.fetch !== 'function' ||
    !Number.isSafeInteger(dependencies.timeoutMs) ||
    dependencies.timeoutMs < 1 ||
    dependencies.timeoutMs > 30_000
  ) {
    throw new PublicTestnetSmokeError('PUBLIC_TESTNET_DEPENDENCIES_INVALID');
  }

  const results: PublicTestnetSmokeResult[] = [];
  for (const profile of profiles) {
    results.push(await probeProfile(profile, dependencies));
  }
  return Object.freeze(results);
}
