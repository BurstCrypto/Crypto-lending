import {
  Eip6963ProviderDiscovery,
  type InjectedProviderDescriptor,
  type SelectedEip1193Provider,
} from '@/lib/wallets/eip1193/discovery';
import { createEvmPublicTestnetWalletExecutor } from '@/lib/wallets/eip1193/public-testnet-executor';

import { EVM_PUBLIC_TESTNET_CHAIN_ID, EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID } from './constants';
import { normalizeEvmPublicTestnetAccount } from './execution';
import {
  createEvmPublicTestnetFullWithdrawalController,
  type EvmPublicTestnetFullWithdrawalController,
} from './withdrawal-coordinator';
import { EvmPublicTestnetWithdrawalApiClient } from './withdrawal-client';
import type { EvmPublicTestnetWithdrawalRecoveryJournalStorage } from './withdrawal-recovery-journal';

const BASE_SEPOLIA_NETWORK = Object.freeze({
  chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
  providerChainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
  displayName: 'Base Sepolia',
  environment: 'TESTNET' as const,
});

interface EvmPublicTestnetWithdrawalDiscoveryPort {
  start(): void;
  stop(): void;
  list(): readonly InjectedProviderDescriptor[];
  select(selectionId: string): SelectedEip1193Provider | null;
}

export interface DefaultEvmPublicTestnetFullWithdrawalControllerOptions {
  readonly storage?: EvmPublicTestnetWithdrawalRecoveryJournalStorage;
  readonly discovery?: EvmPublicTestnetWithdrawalDiscoveryPort;
  /** Bounded non-interactive EIP-6963 announcement collection window. */
  readonly discoveryWindowMilliseconds?: number;
  /** Bounded read-only `eth_accounts` match window per provider. */
  readonly accountReadMilliseconds?: number;
}

export class EvmPublicTestnetWithdrawalProviderUnavailableError extends Error {
  constructor() {
    super('A unique injected wallet for this EVM account could not be discovered.');
    this.name = 'EvmPublicTestnetWithdrawalProviderUnavailableError';
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function timeout<T>(promise: Promise<T>, milliseconds: number): Promise<T | null> {
  return Promise.race([promise, delay(milliseconds).then(() => null)]);
}

function accountFromProviderResponse(value: unknown, expectedAccount: string): boolean {
  if (!Array.isArray(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    length === undefined ||
    !Object.hasOwn(length, 'value') ||
    typeof length.value !== 'number' ||
    !Number.isSafeInteger(length.value) ||
    length.value < 0 ||
    length.value > 32
  ) {
    return false;
  }
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return false;
    try {
      if (normalizeEvmPublicTestnetAccount(descriptor.value) === expectedAccount) return true;
    } catch {
      // Untrusted provider entries are ignored independently.
    }
  }
  return false;
}

async function matchesAccount(
  selection: SelectedEip1193Provider,
  account: string,
  timeoutMilliseconds: number,
): Promise<boolean> {
  try {
    const response = await timeout(
      selection.provider.request({ method: 'eth_accounts' }),
      timeoutMilliseconds,
    );
    return accountFromProviderResponse(response, account);
  } catch {
    return false;
  }
}

/**
 * Builds the production controller from the dashboard account without opening
 * a wallet prompt. `controller.start(claim)` performs the later connect/send
 * interaction, after a parent coordinator has synchronously claimed all lanes.
 */
export async function createDefaultEvmPublicTestnetFullWithdrawalController(
  accountValue: string,
  options: DefaultEvmPublicTestnetFullWithdrawalControllerOptions = {},
): Promise<EvmPublicTestnetFullWithdrawalController> {
  const account = normalizeEvmPublicTestnetAccount(accountValue);
  const collectionMilliseconds = options.discoveryWindowMilliseconds ?? 75;
  const accountReadMilliseconds = options.accountReadMilliseconds ?? 500;
  if (
    !Number.isSafeInteger(collectionMilliseconds) ||
    collectionMilliseconds < 0 ||
    collectionMilliseconds > 2_000 ||
    !Number.isSafeInteger(accountReadMilliseconds) ||
    accountReadMilliseconds < 1 ||
    accountReadMilliseconds > 5_000
  ) {
    throw new EvmPublicTestnetWithdrawalProviderUnavailableError();
  }
  const discovery =
    options.discovery ??
    new Eip6963ProviderDiscovery({ supportedNetworks: [BASE_SEPOLIA_NETWORK] });
  let selections: readonly SelectedEip1193Provider[];
  try {
    discovery.start();
    if (collectionMilliseconds > 0) await delay(collectionMilliseconds);
    selections = Object.freeze(
      discovery
        .list()
        .map(({ selectionId }) => discovery.select(selectionId))
        .filter((selection): selection is SelectedEip1193Provider => selection !== null),
    );
  } finally {
    discovery.stop();
  }
  if (selections.length === 0) throw new EvmPublicTestnetWithdrawalProviderUnavailableError();
  const matchFlags = await Promise.all(
    selections.map((selection) => matchesAccount(selection, account, accountReadMilliseconds)),
  );
  const matches = selections.filter((_, index) => matchFlags[index] === true);
  const selected =
    matches.length === 1
      ? matches[0]
      : matches.length === 0 && selections.length === 1
        ? selections[0]
        : undefined;
  if (selected === undefined) throw new EvmPublicTestnetWithdrawalProviderUnavailableError();
  return createEvmPublicTestnetFullWithdrawalController({
    account,
    api: new EvmPublicTestnetWithdrawalApiClient(),
    wallet: createEvmPublicTestnetWalletExecutor(selected),
    ...(options.storage === undefined ? {} : { storage: options.storage }),
  });
}
