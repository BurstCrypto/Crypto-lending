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
import { parseEvmWalletAddress } from '../../../wallets/domain/wallet-identity';
import {
  allowedRecord,
  canonicalPositionId,
  exchangeBalanceRpc,
  type BalanceJsonRpcTransport,
} from './balance-json-rpc';

const ETHEREUM_MAINNET_NETWORK_ID = 'eip155:1' as const;
const ETHEREUM_MAINNET_CHAIN_ID = '0x1';
const BLOCK_HASH = /^0x[0-9a-f]{64}$/u;
const HEX_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const HEX_DATA = /^0x(?:[0-9a-f]{2})*$/u;
const UINT256_RESULT = /^0x[0-9a-f]{64}$/u;
const BALANCE_OF_SELECTOR = '70a08231';
const MAX_UINT64 = (1n << 64n) - 1n;

const ETHEREUM_BLOCK_KEYS = Object.freeze([
  'baseFeePerGas',
  'blobGasUsed',
  'difficulty',
  'excessBlobGas',
  'extraData',
  'gasLimit',
  'gasUsed',
  'hash',
  'logsBloom',
  'miner',
  'mixHash',
  'nonce',
  'number',
  'parentBeaconBlockRoot',
  'parentHash',
  'receiptsRoot',
  'requestsHash',
  'sha3Uncles',
  'size',
  'stateRoot',
  'timestamp',
  'totalDifficulty',
  'transactions',
  'transactionsRoot',
  'uncles',
  'withdrawals',
  'withdrawalsRoot',
] as const);

const ETHEREUM_ASSETS = Object.freeze(
  supportedAssetRegistryForEnvironment('MAINNET')
    .latest.assets.filter(
      (asset) =>
        asset.networkId === ETHEREUM_MAINNET_NETWORK_ID && asset.activationState === 'ACTIVE',
    )
    .sort((left, right) => left.identity.localeCompare(right.identity)),
);

interface EthereumBlockHeader {
  readonly position: bigint;
  readonly hash: string;
  readonly parentHash: string;
}

interface EthereumReadBundle {
  readonly candidate: BalanceIndexerCandidate;
  readonly header: EthereumBlockHeader;
}

/**
 * Dormant, provider-neutral Ethereum mainnet reader. Construction requires an
 * injected transcript transport and scoped address resolver; this class owns
 * no endpoint and is intentionally absent from Nest runtime registration.
 */
export class EthereumMainnetBalanceIndexerAdapter implements BalanceSyncIndexerPort {
  constructor(
    private readonly transport: BalanceJsonRpcTransport,
    private readonly addresses: BalanceSyncWalletAddressResolverPort,
    private readonly clock: BalanceSyncClockPort,
  ) {
    if (ETHEREUM_ASSETS.length !== 3)
      throw new TypeError('invalid Ethereum asset registry binding');
  }

  async readCurrent(request: BalanceIndexerReadRequest): Promise<unknown> {
    return this.guarded(async () => (await this.readBundle(request)).candidate);
  }

  async rescanFromCheckpoint(request: BalanceIndexerRescanRequest): Promise<unknown> {
    return this.guarded(async () => {
      validateEthereumRequest(request);
      if (
        !Number.isSafeInteger(request.maximumReadUnits) ||
        request.maximumReadUnits < 1 ||
        request.maximumReadUnits > BALANCE_SYNC_POLICY.maximumRecoveryReadUnits
      ) {
        throw new BalanceSyncIndexerFailure('REORG_RECOVERY_FAILED');
      }
      const anchor = parseEthereumAnchor(request.fromFinalizedSource);
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
            : await this.readBlock(toHexQuantity(position), position);
        if (header.position !== previousPosition + 1n || header.parentHash !== previousHash) {
          throw new BalanceSyncIndexerFailure('REORG_RECOVERY_FAILED');
        }
        previousPosition = header.position;
        previousHash = header.hash;
      }
      await this.assertMainnetIdentity();
      return recoveryResult(bundle.candidate, anchor.position, Number(distance));
    });
  }

  private async readBundle(request: BalanceIndexerReadRequest): Promise<EthereumReadBundle> {
    validateEthereumRequest(request);
    await this.assertMainnetIdentity();
    const address = await this.resolveAddress(request);
    const header = await this.readBlock(request.selector);
    const exactCanonicalBlock = Object.freeze({
      blockHash: header.hash,
      requireCanonical: true as const,
    });
    const positions: BalanceSyncPosition[] = [];

    for (const asset of ETHEREUM_ASSETS) {
      const code = await exchangeBalanceRpc(this.transport, 'eth_getCode', [
        asset.identity,
        exactCanonicalBlock,
      ]);
      if (typeof code !== 'string' || !HEX_DATA.test(code) || code === '0x') {
        throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
      }
      const result = await exchangeBalanceRpc(this.transport, 'eth_call', [
        Object.freeze({
          data: `0x${BALANCE_OF_SELECTOR}${'0'.repeat(24)}${address.slice(2)}`,
          to: asset.identity,
        }),
        exactCanonicalBlock,
      ]);
      if (typeof result !== 'string' || !UINT256_RESULT.test(result)) {
        throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
      }
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
          amountAtomic: normalizeBalanceSyncPosition(BigInt(result).toString(10)),
        }),
      );
    }
    await this.assertMainnetIdentity();
    const retrievedAt = canonicalClockTime(this.clock);
    return Object.freeze({
      header,
      candidate: Object.freeze({
        walletId: request.walletId,
        networkId: ETHEREUM_MAINNET_NETWORK_ID,
        tier: request.tier,
        source: Object.freeze({
          position: header.position.toString(10),
          hash: header.hash,
          parentHash: header.parentHash,
          selector: request.selector,
          retrievedAt,
          identityValidated: true,
        }),
        positions: Object.freeze(positions),
      }),
    });
  }

  private async assertMainnetIdentity(): Promise<void> {
    const chainId = await exchangeBalanceRpc(this.transport, 'eth_chainId', []);
    if (chainId !== ETHEREUM_MAINNET_CHAIN_ID) {
      throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
    }
  }

  private async resolveAddress(request: BalanceIndexerReadRequest): Promise<string> {
    let value: unknown;
    try {
      value = await this.addresses.resolveActiveAddress(
        Object.freeze({
          accountId: request.accountId,
          walletId: request.walletId,
          networkId: ETHEREUM_MAINNET_NETWORK_ID,
        }),
      );
      return parseEvmWalletAddress(value);
    } catch (error) {
      if (error instanceof BalanceSyncIndexerFailure) throw error;
      throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
    }
  }

  private async readBlock(
    selector: string,
    expectedPosition?: bigint,
  ): Promise<EthereumBlockHeader> {
    const result = await exchangeBalanceRpc(this.transport, 'eth_getBlockByNumber', [
      selector,
      false,
    ]);
    const record = allowedRecord(
      result,
      ['number', 'hash', 'parentHash', 'transactions', 'uncles'],
      ETHEREUM_BLOCK_KEYS,
    );
    validateKnownEthereumBlockFields(record);
    if (
      typeof record.number !== 'string' ||
      !HEX_QUANTITY.test(record.number) ||
      typeof record.hash !== 'string' ||
      !BLOCK_HASH.test(record.hash) ||
      typeof record.parentHash !== 'string' ||
      !BLOCK_HASH.test(record.parentHash) ||
      record.hash === record.parentHash
    ) {
      throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
    }
    const position = BigInt(record.number);
    if (position > MAX_UINT64) {
      throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
    }
    if (expectedPosition !== undefined && position !== expectedPosition) {
      throw new BalanceSyncIndexerFailure('REORG_RECOVERY_FAILED');
    }
    return Object.freeze({ position, hash: record.hash, parentHash: record.parentHash });
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

function validateKnownEthereumBlockFields(record: Record<string, unknown>): void {
  const quantityFields = [
    'baseFeePerGas',
    'blobGasUsed',
    'difficulty',
    'excessBlobGas',
    'gasLimit',
    'gasUsed',
    'size',
    'timestamp',
    'totalDifficulty',
  ];
  const dataFields = ['extraData', 'logsBloom', 'mixHash', 'nonce'];
  const hashFields = [
    'parentBeaconBlockRoot',
    'receiptsRoot',
    'requestsHash',
    'sha3Uncles',
    'stateRoot',
    'transactionsRoot',
    'withdrawalsRoot',
  ];
  for (const key of quantityFields) {
    if (key in record && (typeof record[key] !== 'string' || !HEX_QUANTITY.test(record[key]))) {
      throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
    }
  }
  for (const key of dataFields) {
    if (key in record && (typeof record[key] !== 'string' || !HEX_DATA.test(record[key]))) {
      throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
    }
  }
  for (const key of hashFields) {
    if (
      key in record &&
      record[key] !== null &&
      (typeof record[key] !== 'string' || !BLOCK_HASH.test(record[key]))
    ) {
      throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
    }
  }
  if (
    'miner' in record &&
    (typeof record.miner !== 'string' || !/^0x[0-9a-f]{40}$/u.test(record.miner))
  ) {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
  validateHashArray(record.transactions, 100_000);
  validateHashArray(record.uncles, 128);
  if (
    'withdrawals' in record &&
    (!Array.isArray(record.withdrawals) ||
      record.withdrawals.length > 128 ||
      record.withdrawals.some((withdrawal) => {
        try {
          const item = allowedRecord(
            withdrawal,
            ['address', 'amount', 'index', 'validatorIndex'],
            ['address', 'amount', 'index', 'validatorIndex'],
          );
          return !(
            typeof item.address === 'string' &&
            /^0x[0-9a-f]{40}$/u.test(item.address) &&
            typeof item.amount === 'string' &&
            HEX_QUANTITY.test(item.amount) &&
            typeof item.index === 'string' &&
            HEX_QUANTITY.test(item.index) &&
            typeof item.validatorIndex === 'string' &&
            HEX_QUANTITY.test(item.validatorIndex)
          );
        } catch {
          return true;
        }
      }))
  ) {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
}

function validateHashArray(value: unknown, maximumLength: number): void {
  if (value === undefined) return;
  if (
    !Array.isArray(value) ||
    value.length > maximumLength ||
    value.some((entry) => typeof entry !== 'string' || !BLOCK_HASH.test(entry))
  ) {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
}

function validateEthereumRequest(request: BalanceIndexerReadRequest): void {
  if (
    request.networkId !== ETHEREUM_MAINNET_NETWORK_ID ||
    !(
      (request.tier === 'PROVISIONAL' && request.selector === 'latest') ||
      (request.tier === 'CANONICAL' && request.selector === 'safe') ||
      (request.tier === 'FINANCIAL' && request.selector === 'finalized')
    )
  ) {
    throw new BalanceSyncIndexerFailure('PERMANENT_PROVIDER_FAILURE');
  }
}

function parseEthereumAnchor(source: BalanceSyncSourcePoint): EthereumBlockHeader {
  if (
    source.selector !== 'finalized' ||
    !/^(?:0|[1-9][0-9]{0,77})$/u.test(source.position) ||
    !BLOCK_HASH.test(source.hash) ||
    !BLOCK_HASH.test(source.parentHash) ||
    source.hash === source.parentHash
  ) {
    throw new BalanceSyncIndexerFailure('REORG_RECOVERY_FAILED');
  }
  return Object.freeze({
    position: BigInt(source.position),
    hash: source.hash,
    parentHash: source.parentHash,
  });
}

function toHexQuantity(value: bigint): string {
  if (value < 0n || value > (1n << 256n) - 1n) {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
  return `0x${value.toString(16)}`;
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
