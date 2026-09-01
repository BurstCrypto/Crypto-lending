import { encodeFunctionData, isAddress } from 'viem';

import {
  EVM_PUBLIC_TESTNET_AMOUNT_HEX,
  EVM_PUBLIC_TESTNET_CHAIN_ID,
  EVM_PUBLIC_TESTNET_CHAIN_NAME,
  EVM_PUBLIC_TESTNET_EXPLORER_ORIGIN,
  EVM_PUBLIC_TESTNET_GATEWAY,
  EVM_PUBLIC_TESTNET_ATOKEN,
  EVM_PUBLIC_TESTNET_POOL,
  EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
  EVM_PUBLIC_TESTNET_RPC_URL,
  EVM_PUBLIC_TESTNET_ZERO_VALUE_HEX,
} from '@/lib/evm-public-testnet/constants';
import {
  evmPublicTestnetWithdrawalInput,
  type EvmPublicTestnetWithdrawalStep,
} from '@/lib/evm-public-testnet/withdrawal';
import { hasCompetingEvmPublicTestnetOperation } from '@/lib/evm-public-testnet/operation-lock';

import type { SelectedEip1193Provider } from './discovery';
import {
  isEip1193Provider,
  type Eip1193Listener,
  type Eip1193Provider,
  type Eip1193RequestArguments,
} from './provider';

const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const HASH = /^0x[0-9a-f]{64}$/u;
const HEX_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/u;
const TRANSACTION_DATA = /^0x[0-9a-f]+$/u;
const EXPECTED_TRANSACTION_DATA_LENGTH = 2 + 132 * 2;
const DEPOSIT_ETH_ABI = [
  {
    type: 'function',
    name: 'depositETH',
    stateMutability: 'payable',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'referralCode', type: 'uint16' },
    ],
    outputs: [],
  },
] as const;
const PROVIDERS_WITH_PENDING_SEND = new WeakSet<object>();

export type EvmPublicTestnetWalletErrorCode =
  | 'ABORTED'
  | 'ACCOUNT_CHANGED'
  | 'COMMIT_AMBIGUOUS'
  | 'DISCONNECTED'
  | 'INVALID_RESPONSE'
  | 'REQUEST_PENDING'
  | 'UNSUPPORTED'
  | 'USER_REJECTED';

const ERROR_MESSAGES: Readonly<Record<EvmPublicTestnetWalletErrorCode, string>> = Object.freeze({
  ABORTED: 'Wallet operation aborted',
  ACCOUNT_CHANGED: 'The selected wallet account or network changed',
  COMMIT_AMBIGUOUS: 'The wallet did not return a conclusive transaction result',
  DISCONNECTED: 'The selected wallet disconnected',
  INVALID_RESPONSE: 'The wallet returned an invalid response',
  REQUEST_PENDING: 'A wallet request is already pending',
  UNSUPPORTED: 'The wallet does not support the required Base Sepolia transaction',
  USER_REJECTED: 'The wallet request was rejected',
});

export class EvmPublicTestnetWalletError extends Error {
  constructor(readonly code: EvmPublicTestnetWalletErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'EvmPublicTestnetWalletError';
  }
}

export interface EvmPublicTestnetWalletSnapshot {
  readonly account: string;
  readonly chainId: typeof EVM_PUBLIC_TESTNET_CHAIN_ID;
  readonly providerChainId: typeof EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID;
  readonly correctNetwork: true;
}

export interface EvmPublicTestnetTransactionRequest {
  readonly from: string;
  readonly to: string;
  readonly value: `0x${string}`;
  readonly data: `0x${string}`;
  readonly nonce: `0x${string}`;
}

export interface EvmPublicTestnetTransactionResult {
  readonly transactionHash: string;
}

export interface EvmPublicTestnetWithdrawalTransactionRequest {
  readonly step: EvmPublicTestnetWithdrawalStep;
  readonly intentId: string;
  readonly from: string;
  readonly to: string;
  readonly value: typeof EVM_PUBLIC_TESTNET_ZERO_VALUE_HEX;
  readonly data: `0x${string}`;
  readonly nonce: `0x${string}`;
}

export interface EvmPublicTestnetWalletPort {
  connect(signal?: AbortSignal): Promise<string>;
  readSnapshot(signal?: AbortSignal): Promise<EvmPublicTestnetWalletSnapshot>;
  sendTransaction(
    request: EvmPublicTestnetTransactionRequest,
    expectedAccount: string,
    signal?: AbortSignal,
  ): Promise<EvmPublicTestnetTransactionResult>;
  subscribeInvalidation(listener: () => void): () => void;
  dispose(): void;
}

export interface EvmPublicTestnetWithdrawalWalletPort extends EvmPublicTestnetWalletPort {
  sendWithdrawalTransaction(
    request: EvmPublicTestnetWithdrawalTransactionRequest,
    expectedAccount: string,
    signal?: AbortSignal,
  ): Promise<EvmPublicTestnetTransactionResult>;
}

type PlainRecord = Record<string, unknown>;

function error(code: EvmPublicTestnetWalletErrorCode): EvmPublicTestnetWalletError {
  return new EvmPublicTestnetWalletError(code);
}

function exactRecord(value: unknown, keys: readonly string[]): PlainRecord {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw error('INVALID_RESPONSE');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Object.keys(descriptors);
  if (
    names.length !== keys.length ||
    names.some((name) => !keys.includes(name)) ||
    keys.some((key) => {
      const descriptor = descriptors[key];
      return descriptor === undefined || !Object.hasOwn(descriptor, 'value');
    })
  ) {
    throw error('INVALID_RESPONSE');
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]?.value]));
}

function safeRead(value: unknown, key: PropertyKey): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function providerCode(value: unknown): string | number | undefined {
  const code = safeRead(value, 'code');
  if (typeof code === 'number' && Number.isSafeInteger(code)) return code;
  if (typeof code === 'string' && /^-?[A-Z0-9_-]{1,64}$/iu.test(code)) return code;
  return undefined;
}

function classifiedProviderFailure(
  value: unknown,
  sendInvoked: boolean,
  signal?: AbortSignal,
): EvmPublicTestnetWalletError {
  const code = providerCode(value);
  if (code === 4001 || code === '4001' || code === 'USER_REJECTED') {
    return error('USER_REJECTED');
  }
  if (code === -32002 || code === '-32002' || code === 'REQUEST_PENDING') {
    return error('REQUEST_PENDING');
  }
  // After invoking `eth_sendTransaction`, no provider-supplied exception type
  // is trusted to prove absence. Only the standardized rejection/pending codes
  // above are conclusive; every other failure crosses the ambiguous boundary.
  if (sendInvoked) return error('COMMIT_AMBIGUOUS');
  if (value instanceof EvmPublicTestnetWalletError) return value;
  return error(signal?.aborted ? 'ABORTED' : 'INVALID_RESPONSE');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw error('ABORTED');
}

function canonicalAddress(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/u.test(value) ||
    !isAddress(value, { strict: true }) ||
    value.toLowerCase() === ZERO_ADDRESS
  ) {
    throw error('INVALID_RESPONSE');
  }
  return value.toLowerCase();
}

function parseAccounts(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw error('INVALID_RESPONSE');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const first = descriptors['0'];
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    first === undefined ||
    !Object.hasOwn(first, 'value') ||
    length === undefined ||
    !Object.hasOwn(length, 'value') ||
    length.value !== 1
  ) {
    throw error('INVALID_RESPONSE');
  }
  return Object.freeze([canonicalAddress(first.value)]);
}

function canonicalHash(value: unknown): string {
  if (typeof value !== 'string' || !HASH.test(value)) throw error('COMMIT_AMBIGUOUS');
  return value;
}

function validTargetNetwork(selection: SelectedEip1193Provider): boolean {
  try {
    return selection.descriptor.supportedNetworks.some(
      (network) =>
        network.chainId === EVM_PUBLIC_TESTNET_CHAIN_ID &&
        network.providerChainId === EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID &&
        network.environment === 'TESTNET',
    );
  } catch {
    return false;
  }
}

function parseTransactionRequest(
  value: EvmPublicTestnetTransactionRequest,
  expectedAccount: string,
): EvmPublicTestnetTransactionRequest {
  const record = exactRecord(value, ['from', 'to', 'value', 'data', 'nonce']);
  const from = canonicalAddress(record.from);
  const to = canonicalAddress(record.to);
  const expectedCall = encodeFunctionData({
    abi: DEPOSIT_ETH_ABI,
    functionName: 'depositETH',
    args: [EVM_PUBLIC_TESTNET_POOL, expectedAccount as `0x${string}`, 0],
  });
  if (
    from !== expectedAccount ||
    to !== EVM_PUBLIC_TESTNET_GATEWAY.toLowerCase() ||
    record.value !== EVM_PUBLIC_TESTNET_AMOUNT_HEX ||
    typeof record.data !== 'string' ||
    !TRANSACTION_DATA.test(record.data) ||
    record.data.length !== EXPECTED_TRANSACTION_DATA_LENGTH ||
    !record.data.startsWith(expectedCall) ||
    typeof record.nonce !== 'string' ||
    !HEX_QUANTITY.test(record.nonce)
  ) {
    throw error('INVALID_RESPONSE');
  }
  return Object.freeze({
    from,
    to,
    value: EVM_PUBLIC_TESTNET_AMOUNT_HEX,
    data: record.data as `0x${string}`,
    nonce: record.nonce as `0x${string}`,
  });
}

function parseWithdrawalTransactionRequest(
  value: EvmPublicTestnetWithdrawalTransactionRequest,
  expectedAccount: string,
): EvmPublicTestnetWithdrawalTransactionRequest {
  const record = exactRecord(value, ['step', 'intentId', 'from', 'to', 'value', 'data', 'nonce']);
  if (record.step !== 'APPROVE_AWETH' && record.step !== 'WITHDRAW_FULL_ETH') {
    throw error('INVALID_RESPONSE');
  }
  if (typeof record.intentId !== 'string') throw error('INVALID_RESPONSE');
  const from = canonicalAddress(record.from);
  const to = canonicalAddress(record.to);
  let expectedData: `0x${string}`;
  try {
    expectedData = evmPublicTestnetWithdrawalInput(record.step, expectedAccount, record.intentId);
  } catch {
    throw error('INVALID_RESPONSE');
  }
  const expectedTarget =
    record.step === 'APPROVE_AWETH'
      ? EVM_PUBLIC_TESTNET_ATOKEN.toLowerCase()
      : EVM_PUBLIC_TESTNET_GATEWAY.toLowerCase();
  if (
    from !== expectedAccount ||
    to !== expectedTarget ||
    record.value !== EVM_PUBLIC_TESTNET_ZERO_VALUE_HEX ||
    record.data !== expectedData ||
    typeof record.nonce !== 'string' ||
    !HEX_QUANTITY.test(record.nonce)
  ) {
    throw error('INVALID_RESPONSE');
  }
  return Object.freeze({
    step: record.step,
    intentId: record.intentId,
    from,
    to,
    value: EVM_PUBLIC_TESTNET_ZERO_VALUE_HEX,
    data: expectedData,
    nonce: record.nonce as `0x${string}`,
  });
}

interface ProviderSnapshot {
  readonly account: string;
  readonly providerChainId: typeof EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID;
}

class DefaultEvmPublicTestnetWallet implements EvmPublicTestnetWithdrawalWalletPort {
  readonly #provider: Eip1193Provider;
  readonly #listeners = new Set<() => void>();
  #account: string | null = null;
  #connectPending = false;
  #sendPending = false;
  #disposed = false;

  readonly #accountsChanged: Eip1193Listener = (accountsValue) => {
    if (this.#account === null) return;
    try {
      const accounts = parseAccounts(accountsValue);
      if (accounts[0] === this.#account) return;
    } catch {
      // Malformed provider events invalidate the capability fail closed.
    }
    this.#invalidate(true);
  };

  readonly #chainChanged: Eip1193Listener = (chainId) => {
    if (this.#account !== null && chainId !== EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID) {
      this.#invalidate(true);
    }
  };

  readonly #disconnected: Eip1193Listener = () => this.#invalidate(true);

  constructor(selection: SelectedEip1193Provider) {
    if (!validTargetNetwork(selection) || !isEip1193Provider(selection.provider)) {
      throw error('UNSUPPORTED');
    }
    this.#provider = selection.provider;
    const attached: (readonly [string, Eip1193Listener])[] = [];
    try {
      for (const binding of this.#providerListeners()) {
        this.#provider.on(...binding);
        attached.push(binding);
      }
    } catch {
      for (const binding of attached) {
        try {
          this.#provider.removeListener(...binding);
        } catch {
          // The capability is rejected after best-effort cleanup.
        }
      }
      throw error('UNSUPPORTED');
    }
  }

  async connect(signal?: AbortSignal): Promise<string> {
    this.#assertLive();
    throwIfAborted(signal);
    if (this.#account !== null) return this.#account;
    if (this.#connectPending || this.#sendPending) throw error('REQUEST_PENDING');
    this.#connectPending = true;
    try {
      await this.#ensureBaseSepolia(signal);
      const requested = parseAccounts(
        await this.#request({ method: 'eth_requestAccounts' }, false, signal),
      );
      const stable = await this.#readStableSnapshot(signal);
      if (requested[0] !== stable.account) throw error('ACCOUNT_CHANGED');
      this.#account = stable.account;
      return stable.account;
    } catch (caught) {
      this.#account = null;
      throw caught;
    } finally {
      this.#connectPending = false;
    }
  }

  async readSnapshot(signal?: AbortSignal): Promise<EvmPublicTestnetWalletSnapshot> {
    this.#assertLive();
    throwIfAborted(signal);
    const expected = this.#requireAccount();
    const snapshot = await this.#readStableSnapshot(signal);
    if (snapshot.account !== expected) {
      this.#invalidate(true);
      throw error('ACCOUNT_CHANGED');
    }
    return Object.freeze({
      account: expected,
      chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
      providerChainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
      correctNetwork: true as const,
    });
  }

  async sendTransaction(
    requestValue: EvmPublicTestnetTransactionRequest,
    expectedAccountValue: string,
    signal?: AbortSignal,
  ): Promise<EvmPublicTestnetTransactionResult> {
    this.#assertLive();
    throwIfAborted(signal);
    if (
      this.#connectPending ||
      this.#sendPending ||
      PROVIDERS_WITH_PENDING_SEND.has(this.#provider as object)
    ) {
      throw error('REQUEST_PENDING');
    }
    const connectedAccount = this.#requireAccount();
    const expectedAccount = canonicalAddress(expectedAccountValue);
    if (expectedAccount !== connectedAccount) throw error('ACCOUNT_CHANGED');
    const request = parseTransactionRequest(requestValue, expectedAccount);
    try {
      if (hasCompetingEvmPublicTestnetOperation('DEPOSIT')) throw error('REQUEST_PENDING');
    } catch (caught) {
      if (caught instanceof EvmPublicTestnetWalletError) throw caught;
      throw error('INVALID_RESPONSE');
    }
    // Claim the per-provider send slot before the first asynchronous preflight
    // read so two same-tab callers cannot both pass the initial pending check.
    this.#sendPending = true;
    PROVIDERS_WITH_PENDING_SEND.add(this.#provider as object);
    let transactionHash: string;
    try {
      const before = await this.#readStableSnapshot(signal);
      if (before.account !== expectedAccount) {
        this.#invalidate(true);
        throw error('ACCOUNT_CHANGED');
      }
      const result = await this.#request(
        {
          method: 'eth_sendTransaction',
          params: [
            Object.freeze({
              from: request.from,
              to: request.to,
              value: request.value,
              data: request.data,
              nonce: request.nonce,
            }),
          ],
        },
        true,
        signal,
      );
      transactionHash = canonicalHash(result);
    } finally {
      this.#sendPending = false;
      PROVIDERS_WITH_PENDING_SEND.delete(this.#provider as object);
    }

    // Once a hash is returned it must reach recovery even if the provider changed
    // accounts, networks, or the caller aborted while the wallet prompt was open.
    try {
      const after = await this.#readStableSnapshot(undefined);
      if (after.account !== expectedAccount) this.#invalidate(true);
    } catch {
      this.#invalidate(true);
    }
    return Object.freeze({ transactionHash });
  }

  async sendWithdrawalTransaction(
    requestValue: EvmPublicTestnetWithdrawalTransactionRequest,
    expectedAccountValue: string,
    signal?: AbortSignal,
  ): Promise<EvmPublicTestnetTransactionResult> {
    this.#assertLive();
    throwIfAborted(signal);
    if (
      this.#connectPending ||
      this.#sendPending ||
      PROVIDERS_WITH_PENDING_SEND.has(this.#provider as object)
    ) {
      throw error('REQUEST_PENDING');
    }
    const connectedAccount = this.#requireAccount();
    const expectedAccount = canonicalAddress(expectedAccountValue);
    if (expectedAccount !== connectedAccount) throw error('ACCOUNT_CHANGED');
    const request = parseWithdrawalTransactionRequest(requestValue, expectedAccount);
    try {
      if (hasCompetingEvmPublicTestnetOperation('WITHDRAWAL')) throw error('REQUEST_PENDING');
    } catch (caught) {
      if (caught instanceof EvmPublicTestnetWalletError) throw caught;
      throw error('INVALID_RESPONSE');
    }
    this.#sendPending = true;
    PROVIDERS_WITH_PENDING_SEND.add(this.#provider as object);
    let transactionHash: string;
    try {
      const before = await this.#readStableSnapshot(signal);
      if (before.account !== expectedAccount) {
        this.#invalidate(true);
        throw error('ACCOUNT_CHANGED');
      }
      const result = await this.#request(
        {
          method: 'eth_sendTransaction',
          params: [
            Object.freeze({
              from: request.from,
              to: request.to,
              value: request.value,
              data: request.data,
              nonce: request.nonce,
            }),
          ],
        },
        true,
        signal,
      );
      transactionHash = canonicalHash(result);
    } finally {
      this.#sendPending = false;
      PROVIDERS_WITH_PENDING_SEND.delete(this.#provider as object);
    }

    try {
      const after = await this.#readStableSnapshot(undefined);
      if (after.account !== expectedAccount) this.#invalidate(true);
    } catch {
      this.#invalidate(true);
    }
    return Object.freeze({ transactionHash });
  }

  subscribeInvalidation(listener: () => void): () => void {
    this.#assertLive();
    if (typeof listener !== 'function') throw new TypeError('wallet listener must be a function');
    this.#listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#account = null;
    for (const binding of this.#providerListeners()) {
      try {
        this.#provider.removeListener(...binding);
      } catch {
        // Local authorization is already cleared.
      }
    }
    this.#listeners.clear();
  }

  async #ensureBaseSepolia(signal?: AbortSignal): Promise<void> {
    const current = await this.#request({ method: 'eth_chainId' }, false, signal);
    if (current === EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID) return;
    const switched = await this.#switchBaseSepolia(signal);
    if (!switched) {
      await this.#request(
        {
          method: 'wallet_addEthereumChain',
          params: [
            Object.freeze({
              chainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
              chainName: EVM_PUBLIC_TESTNET_CHAIN_NAME,
              nativeCurrency: Object.freeze({ name: 'Ether', symbol: 'ETH', decimals: 18 }),
              rpcUrls: Object.freeze([EVM_PUBLIC_TESTNET_RPC_URL]),
              blockExplorerUrls: Object.freeze([EVM_PUBLIC_TESTNET_EXPLORER_ORIGIN]),
            }),
          ],
        },
        false,
        signal,
      );
      if (!(await this.#switchBaseSepolia(signal))) throw error('INVALID_RESPONSE');
    }
    const verified = await this.#request({ method: 'eth_chainId' }, false, signal);
    if (verified !== EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID) throw error('ACCOUNT_CHANGED');
  }

  async #switchBaseSepolia(signal?: AbortSignal): Promise<boolean> {
    throwIfAborted(signal);
    try {
      await this.#provider.request({
        method: 'wallet_switchEthereumChain',
        params: [Object.freeze({ chainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID })],
      });
      throwIfAborted(signal);
      return true;
    } catch (caught) {
      const code = providerCode(caught);
      if (code === 4902 || code === '4902') return false;
      throw classifiedProviderFailure(caught, false, signal);
    }
  }

  async #readStableSnapshot(signal?: AbortSignal): Promise<ProviderSnapshot> {
    const first = await this.#readSnapshot(signal);
    const second = await this.#readSnapshot(signal);
    if (first.account !== second.account || first.providerChainId !== second.providerChainId) {
      throw error('ACCOUNT_CHANGED');
    }
    return first;
  }

  async #readSnapshot(signal?: AbortSignal): Promise<ProviderSnapshot> {
    const providerChainId = await this.#request({ method: 'eth_chainId' }, false, signal);
    if (providerChainId !== EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID) {
      throw error('ACCOUNT_CHANGED');
    }
    const accounts = parseAccounts(await this.#request({ method: 'eth_accounts' }, false, signal));
    return Object.freeze({
      account: accounts[0]!,
      providerChainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
    });
  }

  async #request(
    arguments_: Eip1193RequestArguments,
    sendInvoked: boolean,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!sendInvoked) throwIfAborted(signal);
    try {
      const result = await this.#provider.request(arguments_);
      if (!sendInvoked) throwIfAborted(signal);
      return result;
    } catch (caught) {
      throw classifiedProviderFailure(caught, sendInvoked, signal);
    }
  }

  #assertLive(): void {
    if (this.#disposed) throw error('DISCONNECTED');
  }

  #requireAccount(): string {
    if (this.#account === null) throw error('DISCONNECTED');
    return this.#account;
  }

  #invalidate(emit: boolean): void {
    const hadAccount = this.#account !== null;
    this.#account = null;
    if (!emit || !hadAccount) return;
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch {
        // One listener cannot prevent fail-closed invalidation.
      }
    }
  }

  #providerListeners(): readonly (readonly [string, Eip1193Listener])[] {
    return [
      ['accountsChanged', this.#accountsChanged],
      ['chainChanged', this.#chainChanged],
      ['disconnect', this.#disconnected],
    ];
  }
}

export function createEvmPublicTestnetWalletExecutor(
  selection: SelectedEip1193Provider,
): EvmPublicTestnetWithdrawalWalletPort {
  return new DefaultEvmPublicTestnetWallet(selection);
}
