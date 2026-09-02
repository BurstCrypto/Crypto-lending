const PROVIDER_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const NETWORK_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const MAXIMUM_PROVIDERS = 32;
const MAXIMUM_NETWORKS_PER_PROVIDER = 4;
const MAXIMUM_LABEL_CHARACTERS = 80;

const ECOSYSTEMS = ['EVM', 'SOLANA'] as const;
const NETWORK_IDS = [
  'eip155:1',
  'eip155:56',
  'eip155:8453',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
] as const;
const NETWORK_DEFINITIONS = {
  'eip155:1': { name: 'Ethereum', ecosystem: 'EVM' },
  'eip155:56': { name: 'BNB Smart Chain', ecosystem: 'EVM' },
  'eip155:8453': { name: 'Base', ecosystem: 'EVM' },
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': { name: 'Solana', ecosystem: 'SOLANA' },
} as const;
const PLATFORM_IDS = [
  'aave',
  'morpho',
  'compound',
  'spark',
  'euler',
  'moonwell',
  'venus',
  'kamino',
  'save',
  'project-0',
  'jupiter',
] as const;
const PLATFORM_DEFINITIONS = {
  aave: {
    name: 'Aave',
    protocol: 'Aave V3',
    ecosystem: 'EVM',
    networkIds: ['eip155:1', 'eip155:8453'],
  },
  morpho: {
    name: 'Morpho',
    protocol: 'Morpho Blue',
    ecosystem: 'EVM',
    networkIds: ['eip155:1', 'eip155:8453'],
  },
  compound: {
    name: 'Compound',
    protocol: 'Compound III',
    ecosystem: 'EVM',
    networkIds: ['eip155:8453'],
  },
  spark: {
    name: 'Spark',
    protocol: 'SparkLend',
    ecosystem: 'EVM',
    networkIds: ['eip155:1'],
  },
  euler: {
    name: 'Euler',
    protocol: 'Euler V2',
    ecosystem: 'EVM',
    networkIds: ['eip155:8453'],
  },
  moonwell: {
    name: 'Moonwell',
    protocol: 'Moonwell V2',
    ecosystem: 'EVM',
    networkIds: ['eip155:8453'],
  },
  venus: {
    name: 'Venus',
    protocol: 'Venus Core Pool',
    ecosystem: 'EVM',
    networkIds: ['eip155:56'],
  },
  kamino: {
    name: 'Kamino',
    protocol: 'Kamino Lend',
    ecosystem: 'SOLANA',
    networkIds: ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
  },
  save: {
    name: 'Save',
    protocol: 'Save lending',
    ecosystem: 'SOLANA',
    networkIds: ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
  },
  'project-0': {
    name: 'Project 0',
    protocol: 'marginfi v2',
    ecosystem: 'SOLANA',
    networkIds: ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
  },
  jupiter: {
    name: 'Jupiter',
    protocol: 'Jupiter Lend',
    ecosystem: 'SOLANA',
    networkIds: ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
  },
} as const;

export type MainnetPlatformEcosystem = (typeof ECOSYSTEMS)[number];
export type MainnetPlatformNetworkId = (typeof NETWORK_IDS)[number];
export type MainnetPlatformId = (typeof PLATFORM_IDS)[number];

export interface MainnetPlatformNetwork {
  readonly id: MainnetPlatformNetworkId;
  readonly name: string;
}

export interface MainnetPlatformCandidate {
  readonly id: MainnetPlatformId;
  readonly name: string;
  readonly protocol: string;
  readonly ecosystem: MainnetPlatformEcosystem;
  readonly networks: readonly MainnetPlatformNetwork[];
  readonly integrationStatus: 'PLANNED';
  readonly dataStatus: 'NOT_CONNECTED';
  readonly accessStatus: 'UNAVAILABLE';
  readonly riskStatus: 'NOT_ASSESSED';
  readonly supportedActions: readonly [];
}

export interface MainnetPlatformDirectory {
  readonly schemaVersion: 1;
  readonly use: 'MAINNET_PLATFORM_DIRECTORY';
  readonly mayAuthorizeFinancialAction: false;
  readonly minimumProviderTarget: 10;
  readonly providers: readonly MainnetPlatformCandidate[];
}

export class MainnetPlatformDirectoryResponseError extends Error {
  constructor() {
    super('Mainnet platform directory response is invalid.');
    this.name = 'MainnetPlatformDirectoryResponseError';
  }
}

function fail(): never {
  throw new MainnetPlatformDirectoryResponseError();
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const descriptorKeys = Reflect.ownKeys(descriptors);
    if (
      descriptorKeys.length !== keys.length ||
      descriptorKeys.some((key) => typeof key !== 'string' || !keys.includes(key)) ||
      keys.some((key) => !Object.hasOwn(descriptors, key)) ||
      Object.values(descriptors).some(
        (descriptor) => !('value' in descriptor) || descriptor.enumerable !== true,
      )
    ) {
      return fail();
    }
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [
        key,
        'value' in descriptor ? descriptor.value : undefined,
      ]),
    );
  } catch (error) {
    if (error instanceof MainnetPlatformDirectoryResponseError) throw error;
    return fail();
  }
}

function boundedArray(value: unknown, minimum: number, maximum: number): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
      string,
      PropertyDescriptor
    >;
    const lengthDescriptor = descriptors['length'];
    if (!lengthDescriptor || !('value' in lengthDescriptor)) return fail();
    const lengthValue = lengthDescriptor.value;
    if (
      typeof lengthValue !== 'number' ||
      !Number.isSafeInteger(lengthValue) ||
      lengthValue < minimum ||
      lengthValue > maximum
    ) {
      return fail();
    }
    const length = lengthValue;
    const expectedKeys = [...Array.from({ length }, (_, index) => String(index)), 'length'];
    const descriptorKeys = Reflect.ownKeys(descriptors);
    if (
      descriptorKeys.length !== expectedKeys.length ||
      descriptorKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key)) ||
      expectedKeys.some((key) => !Object.hasOwn(descriptors, key)) ||
      expectedKeys.some((key) => !('value' in descriptors[key]!)) ||
      expectedKeys.slice(0, -1).some((key) => descriptors[key]!.enumerable !== true) ||
      lengthDescriptor.enumerable !== false
    ) {
      return fail();
    }
    return expectedKeys
      .slice(0, -1)
      .map((key) => ('value' in descriptors[key]! ? descriptors[key]!.value : undefined));
  } catch (error) {
    if (error instanceof MainnetPlatformDirectoryResponseError) throw error;
    return fail();
  }
}

function label(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > MAXIMUM_LABEL_CHARACTERS ||
    value !== value.trim() ||
    CONTROL_CHARACTER.test(value)
  ) {
    return fail();
  }
  return value;
}

function oneOf<Value extends string>(value: unknown, allowed: readonly Value[]): Value {
  if (typeof value !== 'string' || !allowed.includes(value as Value)) return fail();
  return value as Value;
}

function parseNetwork(value: unknown): MainnetPlatformNetwork {
  const record = exactRecord(value, ['id', 'name']);
  const id = label(record.id);
  if (!NETWORK_ID.test(id)) return fail();
  const knownId = oneOf(id, NETWORK_IDS);
  const name = label(record.name);
  if (name !== NETWORK_DEFINITIONS[knownId].name) return fail();
  return Object.freeze({ id: knownId, name });
}

function parseProvider(value: unknown): MainnetPlatformCandidate {
  const record = exactRecord(value, [
    'id',
    'name',
    'protocol',
    'ecosystem',
    'networks',
    'integrationStatus',
    'dataStatus',
    'accessStatus',
    'riskStatus',
    'supportedActions',
  ]);
  const id = label(record.id);
  if (!PROVIDER_ID.test(id)) return fail();
  const knownId = oneOf(id, PLATFORM_IDS);
  const definition = PLATFORM_DEFINITIONS[knownId];
  const networks = boundedArray(record.networks, 1, MAXIMUM_NETWORKS_PER_PROVIDER).map(
    parseNetwork,
  );
  if (new Set(networks.map((network) => network.id)).size !== networks.length) return fail();
  const supportedActions = boundedArray(record.supportedActions, 0, 0);
  const ecosystem = oneOf(record.ecosystem, ECOSYSTEMS);
  const actualNetworkIds = networks.map(({ id: networkId }) => networkId).sort();
  const expectedNetworkIds = [...definition.networkIds].sort();
  if (
    ecosystem !== definition.ecosystem ||
    label(record.name) !== definition.name ||
    label(record.protocol) !== definition.protocol ||
    actualNetworkIds.length !== expectedNetworkIds.length ||
    actualNetworkIds.some((networkId, index) => networkId !== expectedNetworkIds[index]) ||
    networks.some((network) => NETWORK_DEFINITIONS[network.id].ecosystem !== ecosystem)
  ) {
    return fail();
  }

  return Object.freeze({
    id: knownId,
    name: definition.name,
    protocol: definition.protocol,
    ecosystem,
    networks: Object.freeze(networks),
    integrationStatus: oneOf(record.integrationStatus, ['PLANNED'] as const),
    dataStatus: oneOf(record.dataStatus, ['NOT_CONNECTED'] as const),
    accessStatus: oneOf(record.accessStatus, ['UNAVAILABLE'] as const),
    riskStatus: oneOf(record.riskStatus, ['NOT_ASSESSED'] as const),
    supportedActions: Object.freeze(supportedActions) as readonly [],
  });
}

export function parseMainnetPlatformDirectory(value: unknown): MainnetPlatformDirectory {
  try {
    const record = exactRecord(value, [
      'schemaVersion',
      'use',
      'mayAuthorizeFinancialAction',
      'minimumProviderTarget',
      'providers',
    ]);
    if (
      record.schemaVersion !== 1 ||
      record.use !== 'MAINNET_PLATFORM_DIRECTORY' ||
      record.mayAuthorizeFinancialAction !== false ||
      record.minimumProviderTarget !== 10
    ) {
      return fail();
    }

    const providers = boundedArray(record.providers, 10, MAXIMUM_PROVIDERS).map(parseProvider);
    const providerIds = providers.map((provider) => provider.id);
    const providerNames = providers.map((provider) => provider.name.toLocaleLowerCase('en-US'));
    if (
      new Set(providerIds).size !== providers.length ||
      new Set(providerNames).size !== providers.length
    ) {
      return fail();
    }

    return Object.freeze({
      schemaVersion: 1,
      use: 'MAINNET_PLATFORM_DIRECTORY',
      mayAuthorizeFinancialAction: false,
      minimumProviderTarget: 10,
      providers: Object.freeze(providers),
    });
  } catch (error) {
    if (error instanceof MainnetPlatformDirectoryResponseError) throw error;
    throw new MainnetPlatformDirectoryResponseError();
  }
}
