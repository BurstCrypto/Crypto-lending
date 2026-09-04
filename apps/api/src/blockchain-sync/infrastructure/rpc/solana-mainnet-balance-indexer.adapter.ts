import {
  BALANCE_SYNC_POLICY,
  BalanceSyncIndexerFailure,
  normalizeBalanceSyncPosition,
  type BalanceSyncPosition,
  type BalanceSyncSourcePoint,
} from '../../domain/balance-sync';
import type {
  BalanceIndexerCandidate,
  BalanceIndexerReadRequest,
  BalanceIndexerRescanRequest,
  BalanceIndexerRescanResult,
  BalanceSyncClockPort,
  BalanceSyncIndexerPort,
  BalanceSyncWalletAddressResolverPort,
} from '../../application/ports/balance-sync.ports';
import { supportedAssetRegistryForEnvironment } from '../../../blockchain/domain/supported-asset-registry';
import {
  MAX_SOLANA_TOKEN_ACCOUNT_BYTES,
  parseSolanaTokenAccount,
  SOLANA_TOKEN_PROGRAM_IDS,
  type SolanaTokenProgramId,
} from '../../../blockchain/domain/solana-token-account';
import { parseSolanaWalletAddress } from '../../../wallets/domain/wallet-identity';
import {
  allowedRecord,
  canonicalPositionId,
  exactRecord,
  exchangeBalanceRpc,
  type BalanceJsonRpcTransport,
} from './balance-json-rpc';

const SOLANA_MAINNET_NETWORK_ID = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const SOLANA_MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const PYUSD_MINT = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const MAX_TOKEN_ACCOUNTS_PER_ASSET = 512;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_BASE64_TOKEN_ACCOUNT_LENGTH = Math.ceil(MAX_SOLANA_TOKEN_ACCOUNT_BYTES / 3) * 4;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

const SOLANA_TOKEN_PROGRAM_BY_MINT = Object.freeze({
  [PYUSD_MINT]: SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022,
  [USDC_MINT]: SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
  [USDT_MINT]: SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
} as const);

const SOLANA_ASSETS = Object.freeze(
  supportedAssetRegistryForEnvironment('MAINNET')
    .latest.assets.filter(
      (asset) =>
        asset.networkId === SOLANA_MAINNET_NETWORK_ID && asset.activationState === 'ACTIVE',
    )
    .sort((left, right) => left.identity.localeCompare(right.identity)),
);

interface SolanaBlockHeader {
  readonly position: bigint;
  readonly hash: string;
  readonly parentPosition: bigint;
  readonly parentHash: string;
}

interface SolanaReadBundle {
  readonly candidate: BalanceIndexerCandidate;
  readonly header: SolanaBlockHeader;
}

/**
 * Dormant confirmed/finalized Solana mainnet reader. The display-only
 * provisional tier intentionally uses confirmed because getBlock cannot prove
 * a processed bank's parent chain. No endpoint/client is registered.
 */
export class SolanaMainnetBalanceIndexerAdapter implements BalanceSyncIndexerPort {
  constructor(
    private readonly transport: BalanceJsonRpcTransport,
    private readonly addresses: BalanceSyncWalletAddressResolverPort,
    private readonly clock: BalanceSyncClockPort,
  ) {
    if (
      SOLANA_ASSETS.length !== 3 ||
      SOLANA_ASSETS.some(
        (asset) => tokenProgramBinding(asset.identity) === undefined || asset.decimals !== 6,
      )
    ) {
      throw new TypeError('invalid Solana asset registry binding');
    }
  }

  async readCurrent(request: BalanceIndexerReadRequest): Promise<unknown> {
    return this.guarded(async () => (await this.readBundle(request)).candidate);
  }

  async rescanFromCheckpoint(request: BalanceIndexerRescanRequest): Promise<unknown> {
    return this.guarded(async () => {
      validateSolanaRequest(request);
      if (
        !Number.isSafeInteger(request.maximumReadUnits) ||
        request.maximumReadUnits < 1 ||
        request.maximumReadUnits > BALANCE_SYNC_POLICY.maximumRecoveryReadUnits
      ) {
        throw new BalanceSyncIndexerFailure('REORG_RECOVERY_FAILED');
      }
      const anchor = parseSolanaAnchor(request.fromFinalizedSource);
      const bundle = await this.readBundle(request);
      const distance = bundle.header.position - anchor.position;
      if (distance < 0n || distance > BigInt(request.maximumReadUnits)) {
        throw new BalanceSyncIndexerFailure('REORG_RECOVERY_FAILED');
      }
      if (distance === 0n) {
        if (bundle.header.hash !== anchor.hash || bundle.header.parentHash !== anchor.parentHash) {
          throw new BalanceSyncIndexerFailure('REORG_RECOVERY_FAILED');
        }
        return recoveryResult(bundle.candidate, anchor.position, 1);
      }

      let previousPosition = anchor.position;
      let previousHash = anchor.hash;
      for (
        let position = anchor.position + 1n;
        position <= bundle.header.position;
        position += 1n
      ) {
        const header =
          position === bundle.header.position
            ? bundle.header
            : await this.readBlock(position, request.selector);
        if (header === null) continue;
        if (header.parentPosition !== previousPosition || header.parentHash !== previousHash) {
          throw new BalanceSyncIndexerFailure('REORG_RECOVERY_FAILED');
        }
        previousPosition = header.position;
        previousHash = header.hash;
      }
      if (previousPosition !== bundle.header.position || previousHash !== bundle.header.hash) {
        throw new BalanceSyncIndexerFailure('REORG_RECOVERY_FAILED');
      }
      await this.assertMainnetIdentity();
      return recoveryResult(bundle.candidate, anchor.position, Number(distance));
    });
  }

  private async readBundle(request: BalanceIndexerReadRequest): Promise<SolanaReadBundle> {
    validateSolanaRequest(request);
    await this.assertMainnetIdentity();
    const address = await this.resolveAddress(request);
    const commitment = request.selector;
    const slotResult = await exchangeBalanceRpc(this.transport, 'getSlot', [
      Object.freeze({ commitment }),
    ]);
    const slot = parseSafeSlot(slotResult, 'PROVIDER_INVALID_DATA');
    const positions: BalanceSyncPosition[] = [];

    for (const asset of SOLANA_ASSETS) {
      const program = tokenProgramBinding(asset.identity);
      if (program === undefined) throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
      const result = await exchangeBalanceRpc(this.transport, 'getTokenAccountsByOwner', [
        address,
        Object.freeze({ mint: asset.identity }),
        Object.freeze({ commitment, encoding: 'base64', minContextSlot: slot }),
      ]);
      const amountAtomic = parseTokenAccounts(result, address, asset.identity, slot, program);
      positions.push(
        Object.freeze({
          positionId: canonicalPositionId([
            request.accountId,
            request.walletId,
            request.networkId,
            asset.identity,
          ]),
          stablecoin: asset.stablecoin,
          assetIdentity: asset.identity,
          amountAtomic,
        }),
      );
    }
    const header = await this.readBlock(BigInt(slot), commitment);
    if (header === null) throw new BalanceSyncIndexerFailure('PROVIDER_UNAVAILABLE');
    await this.assertMainnetIdentity();
    const retrievedAt = canonicalClockTime(this.clock);
    return Object.freeze({
      header,
      candidate: Object.freeze({
        walletId: request.walletId,
        networkId: SOLANA_MAINNET_NETWORK_ID,
        tier: request.tier,
        source: Object.freeze({
          position: header.position.toString(10),
          hash: header.hash,
          parentHash: header.parentHash,
          selector: commitment,
          retrievedAt,
          identityValidated: true,
        }),
        positions: Object.freeze(positions),
      }),
    });
  }

  private async assertMainnetIdentity(): Promise<void> {
    const genesisHash = await exchangeBalanceRpc(this.transport, 'getGenesisHash', []);
    if (genesisHash !== SOLANA_MAINNET_GENESIS_HASH) {
      throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
    }
  }

  private async resolveAddress(request: BalanceIndexerReadRequest): Promise<string> {
    try {
      return parseSolanaWalletAddress(await this.addresses.resolveActiveAddress(request));
    } catch (error) {
      if (error instanceof BalanceSyncIndexerFailure) throw error;
      throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
    }
  }

  private async readBlock(
    position: bigint,
    commitment: 'confirmed' | 'finalized',
  ): Promise<SolanaBlockHeader | null> {
    if (position < 0n || position > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new BalanceSyncIndexerFailure('REORG_RECOVERY_FAILED');
    }
    const result = await exchangeBalanceRpc(this.transport, 'getBlock', [
      Number(position),
      Object.freeze({ commitment, transactionDetails: 'none', rewards: false }),
    ]);
    if (result === null) return null;
    const record = allowedRecord(
      result,
      ['blockhash', 'parentSlot', 'previousBlockhash'],
      [
        'blockHeight',
        'blockTime',
        'blockhash',
        'numRewardPartitions',
        'parentSlot',
        'previousBlockhash',
        'rewards',
        'signatures',
        'transactions',
      ],
    );
    const hash = parseSolanaHash(record.blockhash);
    const parentHash = parseSolanaHash(record.previousBlockhash);
    const parentPosition = BigInt(parseSafeSlot(record.parentSlot, 'PROVIDER_INVALID_DATA'));
    validateOptionalSolanaBlockFields(record);
    if (hash === parentHash || parentPosition >= position) {
      throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
    }
    return Object.freeze({ position, hash, parentPosition, parentHash });
  }

  private async guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof BalanceSyncIndexerFailure) throw error;
      throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
    }
  }
}

function validateSolanaRequest(
  request: BalanceIndexerReadRequest,
): asserts request is BalanceIndexerReadRequest & { selector: 'confirmed' | 'finalized' } {
  if (
    request.networkId !== SOLANA_MAINNET_NETWORK_ID ||
    !(
      ((request.tier === 'PROVISIONAL' || request.tier === 'CANONICAL') &&
        request.selector === 'confirmed') ||
      (request.tier === 'FINANCIAL' && request.selector === 'finalized')
    )
  ) {
    throw new BalanceSyncIndexerFailure('PERMANENT_PROVIDER_FAILURE');
  }
}

function parseTokenAccounts(
  value: unknown,
  expectedOwner: string,
  expectedMint: string,
  expectedSlot: number,
  expectedProgram: SolanaTokenProgramId,
): string {
  const result = exactRecord(value, ['context', 'value']);
  const context = allowedRecord(result.context, ['slot'], ['apiVersion', 'slot']);
  if (parseSafeSlot(context.slot, 'PROVIDER_INVALID_DATA') !== expectedSlot) {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
  if (!Array.isArray(result.value) || result.value.length > MAX_TOKEN_ACCOUNTS_PER_ASSET) {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
  const publicKeys = new Set<string>();
  let total = 0n;
  for (const item of result.value) {
    const keyedAccount = exactRecord(item, ['account', 'pubkey']);
    const publicKey = parseSolanaHash(keyedAccount.pubkey);
    if (publicKeys.has(publicKey)) throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
    publicKeys.add(publicKey);
    const account = allowedRecord(
      keyedAccount.account,
      ['data', 'executable', 'lamports', 'owner', 'rentEpoch', 'space'],
      ['data', 'executable', 'lamports', 'owner', 'rentEpoch', 'space'],
    );
    if (account.executable !== false || account.owner !== expectedProgram) {
      throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
    }
    const data = parseBase64TokenAccount(account.data);
    if (
      !isNonnegativeInteger(account.lamports) ||
      !isNonnegativeInteger(account.rentEpoch) ||
      !isNonnegativeInteger(account.space) ||
      account.space !== data.byteLength ||
      new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(109, true) !== 0
    ) {
      throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
    }
    let parsed;
    try {
      parsed = parseSolanaTokenAccount({
        data,
        tokenProgramId: expectedProgram,
        expectedOwner,
      });
    } catch {
      throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
    }
    if (parsed.mint !== expectedMint || (parsed.state !== 'ACTIVE' && parsed.state !== 'FROZEN')) {
      throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
    }
    const amount = parsed.amountBaseUnits;
    total += amount;
    if (total > MAX_UINT256) throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
  return normalizeBalanceSyncPosition(total.toString(10));
}

function tokenProgramBinding(mint: string): SolanaTokenProgramId | undefined {
  return SOLANA_TOKEN_PROGRAM_BY_MINT[mint as keyof typeof SOLANA_TOKEN_PROGRAM_BY_MINT];
}

function parseBase64TokenAccount(value: unknown): Uint8Array {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
  const [encoded, encoding] = value as readonly unknown[];
  if (
    typeof encoded !== 'string' ||
    encoding !== 'base64' ||
    encoded.length < 1 ||
    encoded.length > MAX_BASE64_TOKEN_ACCOUNT_LENGTH ||
    !CANONICAL_BASE64.test(encoded)
  ) {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
  const decoded = Buffer.from(encoded, 'base64');
  if (
    decoded.byteLength > MAX_SOLANA_TOKEN_ACCOUNT_BYTES ||
    decoded.toString('base64') !== encoded
  ) {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
  return Uint8Array.from(decoded);
}

function validateOptionalSolanaBlockFields(record: Record<string, unknown>): void {
  if (
    ('blockHeight' in record &&
      record.blockHeight !== null &&
      !isNonnegativeInteger(record.blockHeight)) ||
    ('blockTime' in record && record.blockTime !== null && !isInteger(record.blockTime)) ||
    ('numRewardPartitions' in record &&
      record.numRewardPartitions !== null &&
      !isNonnegativeInteger(record.numRewardPartitions)) ||
    ('rewards' in record && (!Array.isArray(record.rewards) || record.rewards.length !== 0)) ||
    ('signatures' in record &&
      (!Array.isArray(record.signatures) || record.signatures.length !== 0)) ||
    ('transactions' in record &&
      (!Array.isArray(record.transactions) || record.transactions.length !== 0))
  ) {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return isInteger(value) && value >= 0;
}

function parseSolanaAnchor(source: BalanceSyncSourcePoint): SolanaBlockHeader {
  if (source.selector !== 'finalized') {
    throw new BalanceSyncIndexerFailure('REORG_RECOVERY_FAILED');
  }
  const position = BigInt(normalizeBalanceSyncPosition(source.position));
  return Object.freeze({
    position,
    hash: parseSolanaHash(source.hash),
    parentPosition: position === 0n ? 0n : position - 1n,
    parentHash: parseSolanaHash(source.parentHash),
  });
}

function parseSolanaHash(value: unknown): string {
  try {
    return parseSolanaWalletAddress(value);
  } catch {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
}

function parseSafeSlot(
  value: unknown,
  code: 'PROVIDER_INVALID_DATA' | 'REORG_RECOVERY_FAILED',
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new BalanceSyncIndexerFailure(code);
  }
  return value;
}

function canonicalClockTime(clock: BalanceSyncClockPort): string {
  const value = clock.now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
  return value.toISOString();
}

function recoveryResult(
  candidate: BalanceIndexerCandidate,
  fromPosition: bigint,
  readUnits: number,
): BalanceIndexerRescanResult {
  return Object.freeze({
    ...candidate,
    replay: Object.freeze({
      fromPosition: fromPosition.toString(10),
      throughPosition: candidate.source.position,
      readUnits,
      complete: true,
    }),
  });
}
