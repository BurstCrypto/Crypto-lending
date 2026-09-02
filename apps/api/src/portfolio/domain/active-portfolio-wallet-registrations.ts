import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import { MAX_ACTIVE_WALLET_REGISTRATIONS_PER_ACCOUNT } from '../../wallets/application/ports/wallet-registration-repository.port';
import { isWalletRegistrationLaunchChain } from '../../wallets/domain/wallet-registration-launch-policy';
import type { ActivePortfolioWalletRegistration } from '../application/ports/portfolio-wallet-registration-reader.port';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export class ActivePortfolioWalletRegistrationsValidationError extends Error {
  constructor() {
    super('active portfolio wallet registrations are invalid');
    this.name = 'ActivePortfolioWalletRegistrationsValidationError';
  }
}

function fail(): never {
  throw new ActivePortfolioWalletRegistrationsValidationError();
}

function dataArray(value: unknown): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = descriptors['length'];
    if (
      !lengthDescriptor ||
      !('value' in lengthDescriptor) ||
      typeof lengthDescriptor.value !== 'number' ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > MAX_ACTIVE_WALLET_REGISTRATIONS_PER_ACCOUNT ||
      lengthDescriptor.enumerable !== false
    ) {
      return fail();
    }
    const indexKeys = Array.from({ length: lengthDescriptor.value }, (_, index) => String(index));
    const expectedKeys = [...indexKeys, 'length'];
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail();
    }
    return indexKeys.map((key) => {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
      return descriptor.value;
    });
  } catch {
    return fail();
  }
}

function dataRecord(value: unknown): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const actualKeys = Reflect.ownKeys(descriptors);
    const expectedKeys = ['walletId', 'networkId'];
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail();
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return fail();
  }
}

function registrationKey(registration: ActivePortfolioWalletRegistration): string {
  return `${registration.walletId}\u0000${registration.networkId}`;
}

/** Validates the authoritative active-wallet read before it becomes a coverage expectation. */
export function parseActivePortfolioWalletRegistrations(
  value: unknown,
): readonly ActivePortfolioWalletRegistration[] {
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  const activeNetworks = new Set(
    registry.networks
      .filter(({ activationState }) => activationState === 'ACTIVE')
      .map(({ networkId }) => networkId),
  );
  const registrations = dataArray(value).map((candidate) => {
    const record = dataRecord(candidate);
    if (
      typeof record.walletId !== 'string' ||
      !UUID_V4.test(record.walletId) ||
      typeof record.networkId !== 'string' ||
      !activeNetworks.has(record.networkId) ||
      !isWalletRegistrationLaunchChain('MAINNET', record.networkId)
    ) {
      return fail();
    }
    return Object.freeze({ walletId: record.walletId, networkId: record.networkId });
  });

  const walletIds = new Set<string>();
  for (const registration of registrations) {
    if (walletIds.has(registration.walletId)) return fail();
    walletIds.add(registration.walletId);
  }
  registrations.sort((left, right) => registrationKey(left).localeCompare(registrationKey(right)));
  return Object.freeze(registrations);
}
