import { toFunctionSelector } from 'viem';

import {
  balanceRpcRequest,
  parseBalanceRpcResult,
} from '../../apps/api/src/blockchain-sync/infrastructure/rpc/balance-json-rpc';
import {
  NodeHttpsBalanceJsonRpcTransport,
  type BoundedBalanceJsonRpcTransport,
} from '../../apps/api/src/blockchain-sync/infrastructure/rpc/node-https-balance-json-rpc.transport';
import { AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST as manifest } from '../../apps/api/src/smart-lending/infrastructure/aave/aave-v3-ethereum-deployment.manifest';

export const PUBLIC_SOURCES = Object.freeze([
  Object.freeze({ name: 'PublicNode', hostname: 'ethereum-rpc.publicnode.com' }),
  Object.freeze({ name: 'dRPC', hostname: 'eth.drpc.org' }),
]);
export const ASSETS = Object.freeze([manifest.assets.USDC, manifest.assets.USDT]);
export const RESERVE_DATA_SELECTOR = toFunctionSelector('getReserveData(address)');
const BALANCE_OF = '0x70a08231';
const MAX_WIRE_BYTES = 1024 * 1024;
const MAX_DURATION_MS = 30_000;
const FINALITY_STALL_MS = 30 * 60 * 1000;
const HASH = /^0x[0-9a-f]{64}$/;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/;

export class LocalAaveReadError extends Error {
  constructor(readonly code: 'UNAVAILABLE' | 'SOURCE_DISAGREEMENT' | 'INVALID_ADDRESS') {
    super(
      code === 'SOURCE_DISAGREEMENT'
        ? 'The two Ethereum sources disagree. Refresh to try a new finalized block.'
        : code === 'INVALID_ADDRESS'
          ? 'Enter a nonzero Ethereum address with 0x followed by 40 hexadecimal characters.'
          : 'Live Aave data is temporarily unavailable. Please try again.',
    );
  }
}

function unavailable(): never {
  throw new LocalAaveReadError('UNAVAILABLE');
}
function agree(condition: boolean): void {
  if (!condition) throw new LocalAaveReadError('SOURCE_DISAGREEMENT');
}

export function walletAddress(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/.test(value)) {
    throw new LocalAaveReadError('INVALID_ADDRESS');
  }
  return value.toLowerCase();
}

export function units(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  return `${value / scale}.${(value % scale).toString().padStart(decimals, '0')}`;
}

function words(value: unknown, count: number): bigint[] {
  if (typeof value !== 'string' || !new RegExp(`^0x[0-9a-f]{${count * 64}}$`).test(value))
    return unavailable();
  return Array.from({ length: count }, (_, index) =>
    BigInt(`0x${value.slice(2 + index * 64, 66 + index * 64)}`),
  );
}

interface Block {
  number: string;
  hash: string;
  timestamp: string;
}
function block(value: unknown, now: number): Block {
  if (typeof value !== 'object' || value === null) return unavailable();
  const b = value as Record<string, unknown>;
  if (
    typeof b.number !== 'string' ||
    !QUANTITY.test(b.number) ||
    typeof b.hash !== 'string' ||
    !HASH.test(b.hash) ||
    /^0x0{64}$/.test(b.hash) ||
    typeof b.timestamp !== 'string' ||
    !QUANTITY.test(b.timestamp)
  )
    return unavailable();
  const time = BigInt(b.timestamp) * 1000n;
  if (time > BigInt(now) || BigInt(now) - time >= BigInt(FINALITY_STALL_MS)) return unavailable();
  return { number: b.number, hash: b.hash, timestamp: b.timestamp };
}

interface Session {
  read(method: string, params: readonly unknown[]): Promise<unknown>;
}

export interface LocalAaveAsset {
  symbol: string;
  supplyAprPercent: string;
  variableBorrowAprPercent: string;
  totalSupplied: string;
  totalVariableDebt: string;
  availableLiquidity: string;
  walletSupply: string | null;
  walletVariableDebt: string | null;
}

export interface LocalAaveSnapshot {
  mode: 'LOCAL_READ_ONLY';
  network: 'Ethereum mainnet';
  protocol: 'Aave V3';
  mayAuthorizeFinancialAction: false;
  observedAt: string;
  block: { number: string; hash: string; timestamp: string; finality: 'finalized' };
  sources: readonly string[];
  agreement: 'MATCHED';
  walletAddress: string | null;
  assets: LocalAaveAsset[];
}

function callData(selector: string, address: string): string {
  return `${selector}${address.slice(2).padStart(64, '0')}`;
}

async function readAssets(
  session: Session,
  anchor: Block,
  wallet: string | null,
): Promise<LocalAaveAsset[]> {
  const at = Object.freeze({ blockHash: anchor.hash, requireCanonical: true });
  const call = (to: string, data: string): Promise<unknown> =>
    session.read('eth_call', [{ to, data }, at]);
  for (const [to, selector] of [
    [manifest.contracts.poolAddressesProvider, manifest.selectors.getPool],
    [manifest.contracts.protocolDataProvider, manifest.selectors.pool],
  ]) {
    if (words(await call(to!, selector!), 1)[0] !== BigInt(manifest.contracts.poolProxy))
      return unavailable();
  }
  const result: LocalAaveAsset[] = [];
  for (const asset of ASSETS) {
    const mapping = words(
      await call(
        manifest.contracts.protocolDataProvider,
        callData(manifest.selectors.getReserveTokensAddresses, asset.underlyingAsset),
      ),
      3,
    );
    if (
      mapping[0] !== BigInt(asset.aToken) ||
      mapping[1] !== 0n ||
      mapping[2] !== BigInt(asset.variableDebtToken)
    )
      return unavailable();
    const reserve = words(
      await call(
        manifest.contracts.protocolDataProvider,
        callData(RESERVE_DATA_SELECTOR, asset.underlyingAsset),
      ),
      12,
    );
    if (reserve[3] !== 0n || reserve[11]! > BigInt(anchor.timestamp)) return unavailable();
    const liquidity = words(
      await call(asset.underlyingAsset, callData(BALANCE_OF, asset.aToken)),
      1,
    )[0]!;
    let supplied: bigint | null = null;
    let debt: bigint | null = null;
    if (wallet !== null) {
      supplied = words(await call(asset.aToken, callData(BALANCE_OF, wallet)), 1)[0]!;
      debt = words(await call(asset.variableDebtToken, callData(BALANCE_OF, wallet)), 1)[0]!;
    }
    result.push({
      symbol: asset.symbol,
      supplyAprPercent: units(reserve[5]! * 100n, 27),
      variableBorrowAprPercent: units(reserve[6]! * 100n, 27),
      totalSupplied: units(reserve[2]!, asset.decimals),
      totalVariableDebt: units(reserve[4]!, asset.decimals),
      availableLiquidity: units(liquidity, asset.decimals),
      walletSupply: supplied === null ? null : units(supplied, asset.decimals),
      walletVariableDebt: debt === null ? null : units(debt, asset.decimals),
    });
  }
  const after = block(
    await session.read('eth_getBlockByNumber', [anchor.number, false]),
    Date.now(),
  );
  agree(JSON.stringify(after) === JSON.stringify(anchor));
  if ((await session.read('eth_chainId', [])) !== '0x1') return unavailable();
  return result;
}

/** A public-address lookup, with no account, ownership, approval or portfolio capability. */
export class LocalAaveReader {
  constructor(
    private readonly transports: readonly BoundedBalanceJsonRpcTransport[] = PUBLIC_SOURCES.map(
      ({ hostname }) =>
        new NodeHttpsBalanceJsonRpcTransport({
          networkId: 'eip155:1',
          hostname,
          path: '/',
          credential: { kind: 'NONE' },
        }),
    ),
  ) {
    if (transports.length !== 2) throw new Error('Two local RPC sources are required');
  }

  async read(input: string | null, signal: AbortSignal): Promise<LocalAaveSnapshot> {
    const wallet = walletAddress(input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MAX_DURATION_MS);
    const combined = AbortSignal.any([signal, controller.signal]);
    let previousTime = Date.now();
    const check = (): void => {
      const now = Date.now();
      if (combined.aborted || now < previousTime) return unavailable();
      previousTime = now;
    };
    const together = async <T>(operations: readonly Promise<T>[]): Promise<T[]> => {
      const outcomes = await Promise.allSettled(
        operations.map((p) =>
          p.catch((error) => {
            controller.abort();
            throw error;
          }),
        ),
      );
      const failed = outcomes.find((outcome) => outcome.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      check();
      return outcomes.map((outcome) => (outcome as PromiseFulfilledResult<T>).value);
    };
    const sessions: Session[] = this.transports.map((transport) => {
      let remaining = MAX_WIRE_BYTES;
      return {
        read: async (method, params) => {
          check();
          if (remaining < 1) return unavailable();
          const request = balanceRpcRequest(method, params);
          const response = await transport.exchangeBounded(request, combined, remaining);
          check();
          if (
            !Number.isSafeInteger(response.bodyBytes) ||
            response.bodyBytes < 1 ||
            response.bodyBytes > remaining
          )
            return unavailable();
          remaining -= response.bodyBytes;
          return parseBalanceRpcResult(response.value, request.id);
        },
      };
    });
    try {
      const heads = await together(
        sessions.map(async (session) => {
          if ((await session.read('eth_chainId', [])) !== '0x1') return unavailable();
          return block(
            await session.read('eth_getBlockByNumber', ['finalized', false]),
            Date.now(),
          );
        }),
      );
      const anchor = BigInt(heads[0]!.number) <= BigInt(heads[1]!.number) ? heads[0]! : heads[1]!;
      const common = await together(
        sessions.map(async (session, index) =>
          heads[index]!.number === anchor.number
            ? heads[index]!
            : block(await session.read('eth_getBlockByNumber', [anchor.number, false]), Date.now()),
        ),
      );
      agree(common.every((value) => JSON.stringify(value) === JSON.stringify(anchor)));
      const results = await together(
        sessions.map((session) => readAssets(session, anchor, wallet)),
      );
      agree(JSON.stringify(results[0]) === JSON.stringify(results[1]));
      return {
        mode: 'LOCAL_READ_ONLY',
        network: 'Ethereum mainnet',
        protocol: 'Aave V3',
        mayAuthorizeFinancialAction: false,
        observedAt: new Date().toISOString(),
        block: {
          number: BigInt(anchor.number).toString(),
          hash: anchor.hash,
          timestamp: new Date(Number(BigInt(anchor.timestamp) * 1000n)).toISOString(),
          finality: 'finalized',
        },
        sources: PUBLIC_SOURCES.map(({ name }) => name),
        agreement: 'MATCHED',
        walletAddress: wallet,
        assets: results[0]!,
      };
    } catch (error) {
      if (error instanceof LocalAaveReadError) throw error;
      return unavailable();
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
