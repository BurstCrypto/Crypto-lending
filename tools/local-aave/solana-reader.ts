import { PublicKey } from '@solana/web3.js';
import { setTimeout as waitForSlot } from 'node:timers/promises';

import {
  balanceRpcRequest,
  parseBalanceRpcResult,
} from '../../apps/api/src/blockchain-sync/infrastructure/rpc/balance-json-rpc';
import {
  NodeHttpsBalanceJsonRpcTransport,
  type BoundedBalanceJsonRpcTransport,
} from '../../apps/api/src/blockchain-sync/infrastructure/rpc/node-https-balance-json-rpc.transport';
import {
  decodeCanonicalSolanaPublicKey,
  encodeSolanaBase58,
} from '../../apps/api/src/mainnet-actions/infrastructure/solana-mainnet-public-key.codec';
import { KAMINO_LEND_SOLANA_MAINNET_IDENTITIES as ID } from '../../apps/api/src/smart-lending/infrastructure/kamino/kamino-lend-solana-finalized-transcript.adapter';
import { units } from './reader';

export const SOLANA_SOURCES = Object.freeze([
  Object.freeze({ name: 'PublicNode', hostname: 'solana-rpc.publicnode.com' }),
  Object.freeze({ name: 'Solana public RPC', hostname: 'api.mainnet-beta.solana.com' }),
]);
export const SOLANA_MINTS = Object.freeze([
  Object.freeze({ symbol: 'USDC', mint: ID.usdcMintAddress, decimals: 6 }),
  Object.freeze({
    symbol: 'USDT',
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    decimals: 6,
  }),
]);
export const KAMINO_LOCAL_SCOPE =
  'Kamino main market: default standard account and default USDC lending account only. Other markets, account IDs, Multiply and vault positions are excluded.';
const TOKEN_PROGRAM = ID.legacyTokenProgramAddress;
const Q60 = 1n << 60n;
const MAX_TOKEN_ACCOUNTS = 64;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_SLOT_SPREAD = 128;
const MAX_READ_MS = 30_000;

export class LocalSolanaReadError extends Error {
  constructor(readonly code: 'INVALID_ADDRESS' | 'UNAVAILABLE' | 'SOURCE_DISAGREEMENT') {
    super(
      code === 'INVALID_ADDRESS'
        ? 'Enter a nonzero Solana public address in base58 format.'
        : code === 'SOURCE_DISAGREEMENT'
          ? 'The Solana sources returned different account data. Refresh to try again.'
          : 'Live Solana data is temporarily unavailable. Please try again.',
    );
  }
}

function requireData(condition: unknown): asserts condition {
  if (!condition) throw new LocalSolanaReadError('UNAVAILABLE');
}
function agree(condition: unknown): asserts condition {
  if (!condition) throw new LocalSolanaReadError('SOURCE_DISAGREEMENT');
}
function record(value: unknown): Record<string, unknown> {
  requireData(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function integer(value: unknown): number {
  requireData(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
  return value;
}
function publicKey(value: unknown): string {
  decodeCanonicalSolanaPublicKey(value);
  return value as string;
}
export function solanaWalletAddress(value: unknown): string | null {
  if (value === null || value === '') return null;
  try {
    requireData(decodeCanonicalSolanaPublicKey(value).some((byte) => byte !== 0));
    return value as string;
  } catch {
    throw new LocalSolanaReadError('INVALID_ADDRESS');
  }
}

/** Only PDA derivation; no keypair, signer, wallet secret or SDK RPC client is constructed. */
export function kaminoDefaultObligations(
  wallet: string,
): readonly { address: string; tag: 0 | 2; label: string }[] {
  const owner = decodeCanonicalSolanaPublicKey(wallet);
  const market = decodeCanonicalSolanaPublicKey(ID.lendingMarketAddress);
  return ([0, 2] as const).map((tag) => {
    const seed = tag === 0 ? Buffer.alloc(32) : decodeCanonicalSolanaPublicKey(ID.usdcMintAddress);
    const [address] = PublicKey.findProgramAddressSync(
      [Buffer.from([tag]), Buffer.from([0]), owner, market, seed, seed],
      new PublicKey(ID.programAddress),
    );
    return {
      address: address.toBase58(),
      tag,
      label: tag === 0 ? 'Standard borrow/lend' : 'USDC lending',
    };
  });
}

interface Account {
  owner: string;
  executable: false;
  lamports: number;
  data: Buffer;
}
function account(value: unknown): Account | null {
  if (value === null) return null;
  const a = record(value);
  requireData(
    a.executable === false &&
      Array.isArray(a.data) &&
      a.data.length === 2 &&
      a.data[1] === 'base64' &&
      typeof a.data[0] === 'string' &&
      a.data[0].length <= 24_000,
  );
  const data = Buffer.from(a.data[0], 'base64');
  requireData(data.toString('base64') === a.data[0] && integer(a.space) === data.length);
  return { owner: publicKey(a.owner), executable: false, lamports: integer(a.lamports), data };
}
function context(value: unknown, minimum: number): { slot: number; value: unknown[] } {
  const r = record(value);
  const slot = integer(record(r.context).slot);
  requireData(slot >= minimum && Array.isArray(r.value));
  return { slot, value: r.value };
}
function keyAt(data: Buffer, offset: number): string {
  return encodeSolanaBase58(data.subarray(offset, offset + 32));
}
function wide(data: Buffer, offset: number, words = 2): bigint {
  let value = 0n;
  for (let i = words - 1; i >= 0; i--)
    value = (value << 64n) + data.readBigUInt64LE(offset + i * 8);
  return value;
}
function tokenAmount(a: Account | null, wallet: string, mint: string): bigint {
  requireData(
    a &&
      a.owner === TOKEN_PROGRAM &&
      a.data.length === 165 &&
      keyAt(a.data, 0) === mint &&
      keyAt(a.data, 32) === wallet &&
      [1, 2].includes(a.data[108]!),
  );
  return a.data.readBigUInt64LE(64);
}
function tokenAddresses(
  value: unknown,
  wallet: string,
  mint: string,
  minimum: number,
): { slot: number; addresses: string[] } {
  const r = context(value, minimum);
  requireData(r.value.length <= MAX_TOKEN_ACCOUNTS);
  const addresses = r.value
    .map((item) => {
      const row = record(item);
      const address = publicKey(row.pubkey);
      tokenAmount(account(row.account), wallet, mint);
      return address;
    })
    .sort();
  requireData(new Set(addresses).size === addresses.length);
  return { slot: r.slot, addresses };
}

interface Reserve {
  totalSupplySf: bigint;
  borrowedSf: bigint;
  available: bigint;
  collateralSupply: bigint;
  cumulativeBorrowRate: bigint;
  lastUpdateSlot: number;
}
function reserveData(a: Account | null, market: Account | null, slot: number): Reserve {
  requireData(
    market &&
      market.owner === ID.programAddress &&
      market.data.length === 4664 &&
      market.data.subarray(0, 8).equals(Buffer.from([246, 114, 50, 98, 72, 157, 28, 120])) &&
      market.data.readBigUInt64LE(8) === 1n,
  );
  requireData(a && a.owner === ID.programAddress && a.data.length === 8624);
  const d = a.data;
  requireData(
    d.subarray(0, 8).equals(Buffer.from([43, 242, 204, 202, 26, 247, 59, 127])) &&
      d.readBigUInt64LE(8) === 1n &&
      keyAt(d, 32) === ID.lendingMarketAddress &&
      keyAt(d, 128) === ID.usdcMintAddress &&
      keyAt(d, 408) === TOKEN_PROGRAM &&
      d.readBigUInt64LE(272) === 6n,
  );
  const lastUpdate = d.readBigUInt64LE(16);
  requireData(lastUpdate > 0n && lastUpdate <= BigInt(slot));
  const available = d.readBigUInt64LE(224);
  const borrowedSf = wide(d, 232);
  const totalSupplySf = available * Q60 + borrowedSf - wide(d, 344) - wide(d, 360) - wide(d, 376);
  const collateralSupply = d.readBigUInt64LE(2592);
  const cumulativeBorrowRate = wide(d, 296, 4);
  requireData(totalSupplySf > 0n && collateralSupply > 0n && cumulativeBorrowRate > 0n);
  return {
    totalSupplySf,
    borrowedSf,
    available,
    collateralSupply,
    cumulativeBorrowRate,
    lastUpdateSlot: Number(lastUpdate),
  };
}

export interface LocalKaminoPosition {
  label: string;
  address: string;
  status: 'FOUND' | 'NOT_FOUND';
  suppliedUsdc: string;
  borrowedUsdc: string;
  lastUpdateSlot: number | null;
}
function position(
  a: Account | null,
  wallet: string,
  target: { address: string; tag: 0 | 2; label: string },
  reserve: Reserve,
  slot: number,
): LocalKaminoPosition {
  let supplied = 0n;
  let borrowed = 0n;
  let lastUpdateSlot: number | null = null;
  if (a !== null) {
    const d = a.data;
    requireData(
      a.owner === ID.programAddress &&
        d.length === 3344 &&
        d.subarray(0, 8).equals(Buffer.from([168, 206, 141, 106, 88, 76, 172, 167])) &&
        d.readBigUInt64LE(8) === BigInt(target.tag) &&
        keyAt(d, 32) === ID.lendingMarketAddress &&
        keyAt(d, 64) === wallet,
    );
    const lastUpdate = d.readBigUInt64LE(16);
    requireData(lastUpdate <= BigInt(slot));
    lastUpdateSlot = Number(lastUpdate);
    for (let i = 0; i < 8; i++) {
      const offset = 96 + i * 136;
      if (keyAt(d, offset) === ID.usdcReserveAddress)
        supplied +=
          (d.readBigUInt64LE(offset + 32) * reserve.totalSupplySf) /
          (reserve.collateralSupply * Q60);
    }
    for (let i = 0; i < 5; i++) {
      const offset = 1208 + i * 200;
      if (keyAt(d, offset) === ID.usdcReserveAddress) {
        const index = wide(d, offset + 32, 4);
        const debtSf = wide(d, offset + 88);
        requireData(index > 0n && index <= reserve.cumulativeBorrowRate);
        // Estimate using the reserve's recorded index; this is not a payoff quote.
        borrowed += (debtSf * reserve.cumulativeBorrowRate + index * Q60 - 1n) / (index * Q60);
      }
    }
  }
  return {
    label: target.label,
    address: target.address,
    status: a ? 'FOUND' : 'NOT_FOUND',
    suppliedUsdc: units(supplied, 6),
    borrowedUsdc: units(borrowed, 6),
    lastUpdateSlot,
  };
}

export interface LocalSolanaSnapshot {
  mode: 'LOCAL_READ_ONLY';
  network: 'Solana mainnet';
  protocol: 'Kamino Lend';
  mayAuthorizeFinancialAction: false;
  observedAt: string;
  walletAddress: string | null;
  sources: readonly string[];
  agreement: 'MATCHED_ACCOUNT_DATA';
  contextSlots: number[];
  block: { number: string; hash: string; timestamp: string; finality: 'finalized' };
  walletBalances: { symbol: string; amount: string; decimals: number }[] | null;
  market: {
    symbol: 'USDC';
    totalSupplied: string;
    totalBorrowed: string;
    availableLiquidity: string;
    lastUpdateSlot: number;
  };
  positions: LocalKaminoPosition[] | null;
  positionCoverage: string;
}

interface Session {
  read(method: string, params: readonly unknown[]): Promise<unknown>;
}

function isMinimumSlotLag(value: unknown, id: string, params: readonly unknown[]): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const envelope = value as Record<string, unknown>;
  if (
    envelope.jsonrpc !== '2.0' ||
    envelope.id !== id ||
    Object.keys(envelope).sort().join(',') !== 'error,id,jsonrpc'
  )
    return false;
  const error = envelope.error;
  if (error === null || typeof error !== 'object' || Array.isArray(error)) return false;
  const e = error as Record<string, unknown>;
  const options = params.at(-1);
  if (
    e.code !== -32016 ||
    typeof e.message !== 'string' ||
    e.message.length > 512 ||
    !['code,data,message', 'code,message'].includes(Object.keys(e).sort().join(',')) ||
    options === null ||
    typeof options !== 'object'
  )
    return false;
  const floor = (options as Record<string, unknown>).minContextSlot;
  if (typeof floor !== 'number' || !Number.isSafeInteger(floor) || floor < 1) return false;
  if (e.data === undefined) return true;
  if (e.data === null || typeof e.data !== 'object' || Array.isArray(e.data)) return false;
  const data = e.data as Record<string, unknown>;
  return (
    Object.keys(data).join(',') === 'contextSlot' &&
    typeof data.contextSlot === 'number' &&
    Number.isSafeInteger(data.contextSlot) &&
    data.contextSlot >= 0 &&
    data.contextSlot < floor &&
    floor - data.contextSlot <= MAX_SLOT_SPREAD
  );
}

export class LocalSolanaReader {
  constructor(
    private readonly transports: readonly BoundedBalanceJsonRpcTransport[] = SOLANA_SOURCES.map(
      ({ hostname }) =>
        new NodeHttpsBalanceJsonRpcTransport({
          networkId: ID.networkId,
          hostname,
          path: '/',
          credential: { kind: 'NONE' },
        }),
    ),
  ) {
    if (transports.length !== 2) throw new Error('Two Solana RPC sources are required');
  }

  async read(input: string | null, signal: AbortSignal): Promise<LocalSolanaSnapshot> {
    const wallet = solanaWalletAddress(input);
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const timer = setTimeout(() => controller.abort(), MAX_READ_MS);
    let previousTime = Date.now();
    const check = (): void => {
      const now = Date.now();
      requireData(!combined.aborted && now >= previousTime);
      previousTime = now;
    };
    const together = async <T>(operations: Promise<T>[]): Promise<T[]> => {
      const outcomes = await Promise.allSettled(
        operations.map((op) =>
          op.catch((error) => {
            controller.abort();
            throw error;
          }),
        ),
      );
      const failure = outcomes.find((r) => r.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      check();
      return outcomes.map((r) => (r as PromiseFulfilledResult<T>).value);
    };
    const sessions: Session[] = this.transports.map((transport) => {
      let remaining = MAX_BODY_BYTES;
      return {
        read: async (method, params) => {
          check();
          requireData(remaining > 0);
          const request = balanceRpcRequest(method, params);
          for (let attempt = 0; ; attempt++) {
            requireData(remaining > 0);
            const response = await transport.exchangeBounded(request, combined, remaining);
            check();
            requireData(
              Number.isSafeInteger(response.bodyBytes) &&
                response.bodyBytes > 0 &&
                response.bodyBytes <= remaining,
            );
            remaining -= response.bodyBytes;
            if (attempt < 2 && isMinimumSlotLag(response.value, request.id, params)) {
              // A floor is not an exact-slot request. Give a lagging finalized RPC
              // at most one second to catch up, within the shared deadline/budget.
              await waitForSlot(500, undefined, { signal: combined });
              check();
              continue;
            }
            return parseBalanceRpcResult(response.value, request.id);
          }
        },
      };
    });
    try {
      const heads = await together(
        sessions.map(async (s) => {
          requireData((await s.read('getGenesisHash', [])) === ID.genesisHash);
          return integer(await s.read('getSlot', [{ commitment: 'finalized' }]));
        }),
      );
      let floor = Math.max(...heads);
      requireData(floor > 0 && floor - Math.min(...heads) <= MAX_SLOT_SPREAD);
      const discovery: { mint: string; symbol: string; addresses: string[] }[] = [];
      if (wallet)
        for (const asset of SOLANA_MINTS) {
          const found = tokenAddresses(
            await sessions[1]!.read('getTokenAccountsByOwner', [
              wallet,
              { mint: asset.mint },
              { commitment: 'finalized', encoding: 'base64', minContextSlot: floor },
            ]),
            wallet,
            asset.mint,
            floor,
          );
          floor = found.slot;
          discovery.push({ ...asset, addresses: found.addresses });
        }
      const targets = wallet ? kaminoDefaultObligations(wallet) : [];
      const addresses = [
        ID.lendingMarketAddress,
        ID.usdcReserveAddress,
        ...SOLANA_MINTS.map((a) => a.mint),
        ...(wallet ? [wallet] : []),
        ...targets.map((t) => t.address),
        ...discovery.flatMap((d) => d.addresses),
      ];
      requireData(addresses.length <= 100 && new Set(addresses).size === addresses.length);
      const fetchAccounts = () =>
        together(
          sessions.map(async (s) => {
            const r = context(
              await s.read('getMultipleAccounts', [
                addresses,
                { commitment: 'finalized', encoding: 'base64', minContextSlot: floor },
              ]),
              floor,
            );
            requireData(r.value.length === addresses.length && r.slot - floor <= MAX_SLOT_SPREAD);
            return { slot: r.slot, accounts: r.value.map(account) };
          }),
        );
      let reads = await fetchAccounts();
      const matches = () =>
        JSON.stringify(reads[0]!.accounts) === JSON.stringify(reads[1]!.accounts);
      // One bounded retry for an account refreshed between the two finalized reads.
      if (!matches()) {
        floor = Math.max(...reads.map((r) => r.slot));
        reads = await fetchAccounts();
      }
      agree(matches());
      const slots = reads.map((r) => r.slot);
      requireData(Math.max(...slots) - Math.min(...slots) <= MAX_SLOT_SPREAD);
      const slot = Math.min(...slots);
      const accounts = reads[0]!.accounts;
      const reserve = reserveData(accounts[1]!, accounts[0]!, slot);
      SOLANA_MINTS.forEach((_asset, index) => {
        const mint = accounts[2 + index];
        requireData(
          mint &&
            mint.owner === TOKEN_PROGRAM &&
            mint.data.length === 82 &&
            mint.data[44] === 6 &&
            mint.data[45] === 1,
        );
      });
      let walletBalances: LocalSolanaSnapshot['walletBalances'] = null;
      let positions: LocalSolanaSnapshot['positions'] = null;
      if (wallet) {
        walletBalances = [
          { symbol: 'SOL', amount: units(BigInt(accounts[4]?.lamports ?? 0), 9), decimals: 9 },
        ];
        positions = targets.map((target, index) =>
          position(accounts[5 + index]!, wallet, target, reserve, slot),
        );
        let offset = 5 + targets.length;
        for (const asset of discovery) {
          let total = 0n;
          for (let i = 0; i < asset.addresses.length; i++)
            total += tokenAmount(accounts[offset++]!, wallet, asset.mint);
          walletBalances.push({ symbol: asset.symbol, amount: units(total, 6), decimals: 6 });
          const again = tokenAddresses(
            await sessions[1]!.read('getTokenAccountsByOwner', [
              wallet,
              { mint: asset.mint },
              { commitment: 'finalized', encoding: 'base64', minContextSlot: Math.max(...slots) },
            ]),
            wallet,
            asset.mint,
            Math.max(...slots),
          );
          agree(JSON.stringify(again.addresses) === JSON.stringify(asset.addresses));
        }
      }
      const blocks = await together(
        sessions.map(async (s) => {
          const b = record(
            await s.read('getBlock', [
              slot,
              {
                commitment: 'finalized',
                transactionDetails: 'none',
                rewards: false,
                maxSupportedTransactionVersion: 0,
              },
            ]),
          );
          const timestamp = integer(b.blockTime);
          const parent = integer(b.parentSlot);
          requireData(
            parent < slot &&
              timestamp * 1000 <= Date.now() &&
              Date.now() - timestamp * 1000 < 120_000,
          );
          const hash = publicKey(b.blockhash);
          const previous = publicKey(b.previousBlockhash);
          requireData(
            hash !== previous && decodeCanonicalSolanaPublicKey(hash).some((byte) => byte !== 0),
          );
          requireData((await s.read('getGenesisHash', [])) === ID.genesisHash);
          return { hash, parent, previous, timestamp };
        }),
      );
      agree(JSON.stringify(blocks[0]) === JSON.stringify(blocks[1]));
      check();
      return {
        mode: 'LOCAL_READ_ONLY',
        network: 'Solana mainnet',
        protocol: 'Kamino Lend',
        mayAuthorizeFinancialAction: false,
        observedAt: new Date().toISOString(),
        walletAddress: wallet,
        sources: SOLANA_SOURCES.map((s) => s.name),
        agreement: 'MATCHED_ACCOUNT_DATA',
        contextSlots: slots,
        block: {
          number: String(slot),
          hash: blocks[0]!.hash,
          timestamp: new Date(blocks[0]!.timestamp * 1000).toISOString(),
          finality: 'finalized',
        },
        walletBalances,
        market: {
          symbol: 'USDC',
          totalSupplied: units(reserve.totalSupplySf / Q60, 6),
          totalBorrowed: units(reserve.borrowedSf / Q60, 6),
          availableLiquidity: units(reserve.available, 6),
          lastUpdateSlot: reserve.lastUpdateSlot,
        },
        positions,
        positionCoverage: KAMINO_LOCAL_SCOPE,
      };
    } catch (error) {
      if (error instanceof LocalSolanaReadError) throw error;
      throw new LocalSolanaReadError('UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
