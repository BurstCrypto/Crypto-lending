import { EVM_TESTNET_CHAIN_IDS, type EvmTestnetChainId } from './chains';
import type { ReadyEvmRuntimeSettings } from './runtime-env';

const MAX_RESPONSE_BYTES = 4_096;
const DEFAULT_TIMEOUT_MS = 5_000;

export class EvmRpcPreflightError extends Error {
  constructor() {
    super('evm-rpc-preflight-failed');
    this.name = 'EvmRpcPreflightError';
  }
}

export type EvmRpcPreflightDependencies = Readonly<{
  fetch: typeof fetch;
  timeoutMs: number;
}>;

const dependencies: EvmRpcPreflightDependencies = Object.freeze({
  fetch: globalThis.fetch.bind(globalThis),
  timeoutMs: DEFAULT_TIMEOUT_MS,
});

function expectedChainId(chainId: EvmTestnetChainId): string {
  return `0x${chainId.toString(16)}`;
}

async function probe(
  url: string,
  chainId: EvmTestnetChainId,
  injected: EvmRpcPreflightDependencies,
): Promise<void> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), injected.timeoutMs);

  try {
    const response = await injected.fetch(url, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    const declaredLength = Number(response.headers.get('content-length'));
    if (
      !response.ok ||
      response.redirected ||
      (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES)
    ) {
      throw new EvmRpcPreflightError();
    }

    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
      throw new EvmRpcPreflightError();
    }

    const payload: unknown = JSON.parse(body);
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Reflect.get(payload, 'jsonrpc') !== '2.0' ||
      Reflect.get(payload, 'id') !== 1 ||
      Reflect.get(payload, 'result') !== expectedChainId(chainId) ||
      Reflect.has(payload, 'error')
    ) {
      throw new EvmRpcPreflightError();
    }
  } catch {
    throw new EvmRpcPreflightError();
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

/** Verifies that each configured public RPC actually serves its labeled testnet. */
export async function preflightEvmTestnetRpcs(
  settings: ReadyEvmRuntimeSettings,
  injected: EvmRpcPreflightDependencies = dependencies,
): Promise<void> {
  if (!Number.isFinite(injected.timeoutMs) || injected.timeoutMs <= 0) {
    throw new EvmRpcPreflightError();
  }

  await Promise.all([
    probe(settings.rpcUrls[EVM_TESTNET_CHAIN_IDS.sepolia], EVM_TESTNET_CHAIN_IDS.sepolia, injected),
    probe(
      settings.rpcUrls[EVM_TESTNET_CHAIN_IDS.baseSepolia],
      EVM_TESTNET_CHAIN_IDS.baseSepolia,
      injected,
    ),
  ]);
}
