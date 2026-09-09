import { isProxy } from 'node:util/types';

import { parseAccountId } from '../../accounts/domain/account-profile';
import {
  createBalanceSyncExecutionContext,
  type BalanceSyncCheckpointPort,
  type BalanceSyncScope,
  type BalanceSyncWalletAddressResolverPort,
} from '../../blockchain-sync/application/ports/balance-sync.ports';
import type { BalanceConsumerConfig } from '../../blockchain-sync/infrastructure/config/balance-consumer.config';
import { PostgresBalanceSyncCheckpointRepository } from '../../blockchain-sync/infrastructure/postgres/postgres-balance-sync-checkpoint.repository';
import { PostgresBalanceSyncWalletAddressResolver } from '../../blockchain-sync/infrastructure/postgres/postgres-balance-sync-wallet-address.resolver';
import type { NodeHttpsBalanceJsonRpcTransportConfig } from '../../blockchain-sync/infrastructure/rpc/node-https-balance-json-rpc.transport';
import type { PostgresService } from '../../infrastructure/database/postgres.service';
import {
  createAaveV3EthereumPositionRpcTranscriptSource,
  type AaveV3EthereumPositionRpcSourceBinding,
} from './aave-v3-ethereum-position-rpc-transcript.source';
import {
  AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE,
  DormantAaveV3EthereumProviderPositionSource,
  type AaveV3EthereumDurableTargetContextReaderPort,
  type AaveV3EthereumDurableTargetContextV1,
  type ReadAaveV3EthereumDurableTargetContextRequestV1,
} from './dormant-aave-v3-ethereum-provider-position.source';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH = /^0x[0-9a-f]{64}$/u;
const MAX_DURATION_MS = 30_000;
const REQUEST_KEYS = [
  'contextVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'accountId',
  'correlationId',
  'walletId',
  'networkId',
  'sourceFamilyId',
  'sourceId',
  'deadlineAt',
  'signal',
] as const;

export class AaveV3EthereumPositionContextUnavailableError extends Error {
  readonly code = 'AAVE_V3_ETHEREUM_POSITION_CONTEXT_UNAVAILABLE' as const;
  constructor() {
    super('Aave V3 Ethereum wallet context is unavailable.');
    this.name = 'AaveV3EthereumPositionContextUnavailableError';
  }
}
function unavailable(): never {
  throw new AaveV3EthereumPositionContextUnavailableError();
}

function fields(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input) || isProxy(input))
    return unavailable();
  const prototype = Object.getPrototypeOf(input) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== keys.length) return unavailable();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) return unavailable();
    result[key] = descriptor.value;
  }
  return result;
}

function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    return unavailable();
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString() !== value) return unavailable();
  return result;
}

function isAborted(signal: unknown): boolean {
  const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
  if (getter === undefined) return unavailable();
  return getter.call(signal) as boolean;
}

function reviewedRequest(
  input: unknown,
  now: number,
): Readonly<ReadAaveV3EthereumDurableTargetContextRequestV1> {
  const value = fields(input, REQUEST_KEYS);
  if (
    value.contextVersion !== 1 ||
    value.use !== AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE ||
    value.mayAuthorizeFinancialAction !== false ||
    value.mayPersist !== false ||
    value.networkId !== 'eip155:1' ||
    typeof value.walletId !== 'string' ||
    !UUID.test(value.walletId) ||
    typeof value.correlationId !== 'string' ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u.test(value.correlationId) ||
    [value.sourceFamilyId, value.sourceId].some(
      (item) => typeof item !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(item),
    ) ||
    value.sourceFamilyId === 'durable-postgres' ||
    value.sourceId === 'aave-wallet-checkpoint' ||
    isAborted(value.signal) ||
    timestamp(value.deadlineAt) <= now ||
    timestamp(value.deadlineAt) - now > MAX_DURATION_MS
  )
    return unavailable();
  parseAccountId(value.accountId);
  return Object.freeze(value) as unknown as ReadAaveV3EthereumDurableTargetContextRequestV1;
}

function captureMethod<T extends object, K extends keyof T>(input: T, key: K): T[K] {
  if (typeof input !== 'object' || input === null || isProxy(input)) return unavailable();
  let owner: object | null = input;
  for (let depth = 0; owner !== null && depth < 4; depth++) {
    if (isProxy(owner)) return unavailable();
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') return unavailable();
      return Function.prototype.bind.call(descriptor.value, input) as T[K];
    }
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return unavailable();
}

/** Resolves active wallet ownership and a previously retained finalized floor. */
export class AaveV3EthereumPositionContextReader implements AaveV3EthereumDurableTargetContextReaderPort {
  readonly contextVersion = 1 as const;
  readonly sourceFamilyId = 'durable-postgres';
  readonly sourceId = 'aave-wallet-checkpoint';
  readonly #resolve: BalanceSyncWalletAddressResolverPort['resolveActiveAddress'];
  readonly #load: BalanceSyncCheckpointPort['load'];
  readonly #issued = new WeakMap<
    object,
    {
      request: ReadAaveV3EthereumDurableTargetContextRequestV1;
      value: Readonly<ReadAaveV3EthereumDurableTargetContextRequestV1>;
      checkedAt: number;
    }
  >();

  constructor(
    wallets: BalanceSyncWalletAddressResolverPort,
    checkpoints: Pick<BalanceSyncCheckpointPort, 'load'>,
  ) {
    this.#resolve = captureMethod(wallets, 'resolveActiveAddress');
    this.#load = captureMethod(checkpoints, 'load');
    Object.freeze(this);
  }

  async readContext(
    input: ReadAaveV3EthereumDurableTargetContextRequestV1,
  ): Promise<AaveV3EthereumDurableTargetContextV1> {
    const owner = createBalanceSyncExecutionContext();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let detach: (() => void) | undefined;
    try {
      let lastTime = Date.now();
      const value = reviewedRequest(input, lastTime);
      const deadline = timestamp(value.deadlineAt);
      const abort = (): void => owner.abort('SHUTDOWN');
      AbortSignal.prototype.addEventListener.call(value.signal, 'abort', abort, { once: true });
      detach = () => AbortSignal.prototype.removeEventListener.call(value.signal, 'abort', abort);
      timer = setTimeout(() => owner.abort('DEADLINE'), deadline - lastTime);
      const check = (): void => {
        const now = Date.now();
        if (
          isAborted(value.signal) ||
          owner.context.signal.aborted ||
          now < lastTime ||
          now >= deadline
        )
          return unavailable();
        lastTime = now;
      };
      const scope: BalanceSyncScope = Object.freeze({
        accountId: value.accountId,
        walletId: value.walletId,
        networkId: 'eip155:1',
      });
      check();
      const address = await this.#resolve(scope, owner.context);
      check();
      if (
        typeof address !== 'string' ||
        !/^0x[0-9a-f]{40}$/u.test(address) ||
        /^0x0{40}$/u.test(address)
      )
        return unavailable();
      const checkpoint = await this.#load(scope, owner.context);
      check();
      if (checkpoint !== null) {
        fields(checkpoint, [
          'revision',
          'scope',
          'currentObservation',
          'lastFinalizedSource',
          'freshness',
          'staleSince',
          'lastFailureCode',
        ]);
        fields(checkpoint.scope, ['accountId', 'walletId', 'networkId']);
      }
      if (
        checkpoint === null ||
        checkpoint.freshness !== 'CURRENT' ||
        !Number.isSafeInteger(checkpoint.revision) ||
        checkpoint.revision < 1 ||
        checkpoint.scope.accountId !== scope.accountId ||
        checkpoint.scope.walletId !== scope.walletId ||
        checkpoint.scope.networkId !== scope.networkId ||
        checkpoint.lastFinalizedSource === null
      )
        return unavailable();
      const finalized = fields(checkpoint.lastFinalizedSource, [
        'position',
        'hash',
        'parentHash',
        'selector',
        'retrievedAt',
      ]);
      if (
        finalized.selector !== 'finalized' ||
        typeof finalized.position !== 'string' ||
        !/^(?:0|[1-9][0-9]{0,19})$/u.test(finalized.position) ||
        BigInt(finalized.position) > (1n << 64n) - 1n ||
        typeof finalized.hash !== 'string' ||
        !HASH.test(finalized.hash) ||
        /^0x0{64}$/u.test(finalized.hash) ||
        typeof finalized.parentHash !== 'string' ||
        !HASH.test(finalized.parentHash) ||
        timestamp(finalized.retrievedAt) > lastTime
      )
        return unavailable();
      // Recheck active ownership after the checkpoint read. Neither value comes from RPC.
      if ((await this.#resolve(scope, owner.context)) !== address) return unavailable();
      check();
      const reread = reviewedRequest(input, lastTime);
      if (REQUEST_KEYS.some((key) => reread[key] !== value[key])) return unavailable();
      const result: AaveV3EthereumDurableTargetContextV1 = Object.freeze({
        contextVersion: 1,
        use: AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE,
        mayAuthorizeFinancialAction: false,
        mayPersist: false,
        accountId: value.accountId,
        correlationId: value.correlationId,
        walletId: value.walletId,
        networkId: 'eip155:1',
        contextSourceFamilyId: this.sourceFamilyId,
        contextSourceId: this.sourceId,
        walletAddress: address,
        continuityFloor: Object.freeze({
          kind: 'EVM_BLOCK',
          blockNumber: finalized.position,
          blockHash: finalized.hash,
        }),
        resolvedAt: new Date(lastTime).toISOString(),
      });
      this.#issued.set(result, { request: input, value, checkedAt: lastTime });
      return result;
    } catch {
      return unavailable();
    } finally {
      owner.abort('SHUTDOWN');
      if (timer !== undefined) clearTimeout(timer);
      detach?.();
    }
  }

  verifyContext(
    capability: unknown,
    request: ReadAaveV3EthereumDurableTargetContextRequestV1,
  ): boolean {
    if (typeof capability !== 'object' || capability === null) return false;
    const issued = this.#issued.get(capability);
    if (issued === undefined || request !== issued.request) return false;
    try {
      const now = Date.now();
      const current = reviewedRequest(request, now);
      if (
        now < issued.checkedAt ||
        REQUEST_KEYS.some((key) => current[key] !== issued.value[key])
      ) {
        this.#issued.delete(capability);
        return false;
      }
      issued.checkedAt = now;
      return true;
    } catch {
      this.#issued.delete(capability);
      return false;
    }
  }
}

/**
 * Private, read-only composition. Requires an owned database connection with
 * the existing balance-reader grants and metadata decryption configuration.
 * It creates no grants, checkpoints, source approval, deployment or API route.
 */
export function createPostgresAaveV3EthereumPositionSource(
  postgres: PostgresService,
  walletConfig: BalanceConsumerConfig,
  binding: AaveV3EthereumPositionRpcSourceBinding,
  rpcConfig: NodeHttpsBalanceJsonRpcTransportConfig,
): DormantAaveV3EthereumProviderPositionSource {
  if (fields(walletConfig, ['mode', 'walletMetadataSealKeys']).mode !== 'enabled')
    return unavailable();
  const wallets = new PostgresBalanceSyncWalletAddressResolver(postgres, walletConfig);
  const checkpoints = new PostgresBalanceSyncCheckpointRepository(postgres);
  const context = new AaveV3EthereumPositionContextReader(wallets, checkpoints);
  const transcript = createAaveV3EthereumPositionRpcTranscriptSource(binding, rpcConfig);
  return new DormantAaveV3EthereumProviderPositionSource(context, transcript, {
    now: () => new Date(),
  });
}
