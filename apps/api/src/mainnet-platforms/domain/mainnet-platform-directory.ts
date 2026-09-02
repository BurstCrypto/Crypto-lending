export const MAINNET_PLATFORM_DIRECTORY_USE = 'MAINNET_PLATFORM_DIRECTORY' as const;
export const MAINNET_PLATFORM_MINIMUM_PROVIDER_TARGET = 10 as const;

export type MainnetPlatformEcosystem = 'EVM' | 'SOLANA';
export type MainnetPlatformIntegrationStatus = 'PLANNED';
export type MainnetPlatformDataStatus = 'NOT_CONNECTED';
export type MainnetPlatformAccessStatus = 'UNAVAILABLE';
export type MainnetPlatformRiskStatus = 'NOT_ASSESSED';

export interface MainnetPlatformNetwork {
  readonly id: 'eip155:1' | 'eip155:56' | 'eip155:8453' | 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
  readonly name: 'Ethereum' | 'BNB Smart Chain' | 'Base' | 'Solana';
}

export interface MainnetPlatformDirectoryEntry {
  readonly id:
    | 'aave'
    | 'morpho'
    | 'compound'
    | 'spark'
    | 'euler'
    | 'moonwell'
    | 'venus'
    | 'kamino'
    | 'save'
    | 'project-0'
    | 'jupiter';
  readonly name:
    | 'Aave'
    | 'Morpho'
    | 'Compound'
    | 'Spark'
    | 'Euler'
    | 'Moonwell'
    | 'Venus'
    | 'Kamino'
    | 'Save'
    | 'Project 0'
    | 'Jupiter';
  readonly protocol:
    | 'Aave V3'
    | 'Morpho Blue'
    | 'Compound III'
    | 'SparkLend'
    | 'Euler V2'
    | 'Moonwell V2'
    | 'Venus Core Pool'
    | 'Kamino Lend'
    | 'Save lending'
    | 'marginfi v2'
    | 'Jupiter Lend';
  readonly ecosystem: MainnetPlatformEcosystem;
  readonly networks: readonly MainnetPlatformNetwork[];
  readonly integrationStatus: MainnetPlatformIntegrationStatus;
  readonly dataStatus: MainnetPlatformDataStatus;
  readonly accessStatus: MainnetPlatformAccessStatus;
  readonly riskStatus: MainnetPlatformRiskStatus;
  readonly supportedActions: readonly [];
}

export interface MainnetPlatformDirectory {
  readonly schemaVersion: 1;
  readonly use: typeof MAINNET_PLATFORM_DIRECTORY_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly minimumProviderTarget: typeof MAINNET_PLATFORM_MINIMUM_PROVIDER_TARGET;
  readonly providers: readonly MainnetPlatformDirectoryEntry[];
}

const ETHEREUM = Object.freeze({ id: 'eip155:1', name: 'Ethereum' } as const);
const BASE = Object.freeze({ id: 'eip155:8453', name: 'Base' } as const);
const BNB_SMART_CHAIN = Object.freeze({
  id: 'eip155:56',
  name: 'BNB Smart Chain',
} as const);
const SOLANA = Object.freeze({
  id: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  name: 'Solana',
} as const);
const NO_SUPPORTED_ACTIONS = Object.freeze([]) as readonly [];

type PlatformIdentity = Pick<MainnetPlatformDirectoryEntry, 'id' | 'name' | 'protocol'>;

function plannedPlatform(
  identity: PlatformIdentity,
  ecosystem: MainnetPlatformEcosystem,
  networks: readonly MainnetPlatformNetwork[],
): MainnetPlatformDirectoryEntry {
  if (networks.length === 0) throw new TypeError('mainnet platform must name a target network');
  if (
    networks.some(({ id }) =>
      ecosystem === 'EVM' ? !id.startsWith('eip155:') : !id.startsWith('solana:'),
    )
  ) {
    throw new TypeError('mainnet platform ecosystem and network must agree');
  }

  return Object.freeze({
    ...identity,
    ecosystem,
    networks: Object.freeze([...networks]),
    integrationStatus: 'PLANNED' as const,
    dataStatus: 'NOT_CONNECTED' as const,
    accessStatus: 'UNAVAILABLE' as const,
    riskStatus: 'NOT_ASSESSED' as const,
    supportedActions: NO_SUPPORTED_ACTIONS,
  });
}

const providers: readonly MainnetPlatformDirectoryEntry[] = Object.freeze([
  plannedPlatform({ id: 'aave', name: 'Aave', protocol: 'Aave V3' }, 'EVM', [ETHEREUM, BASE]),
  plannedPlatform({ id: 'morpho', name: 'Morpho', protocol: 'Morpho Blue' }, 'EVM', [
    ETHEREUM,
    BASE,
  ]),
  plannedPlatform({ id: 'compound', name: 'Compound', protocol: 'Compound III' }, 'EVM', [BASE]),
  plannedPlatform({ id: 'spark', name: 'Spark', protocol: 'SparkLend' }, 'EVM', [ETHEREUM]),
  plannedPlatform({ id: 'euler', name: 'Euler', protocol: 'Euler V2' }, 'EVM', [BASE]),
  plannedPlatform({ id: 'moonwell', name: 'Moonwell', protocol: 'Moonwell V2' }, 'EVM', [BASE]),
  plannedPlatform({ id: 'venus', name: 'Venus', protocol: 'Venus Core Pool' }, 'EVM', [
    BNB_SMART_CHAIN,
  ]),
  plannedPlatform({ id: 'kamino', name: 'Kamino', protocol: 'Kamino Lend' }, 'SOLANA', [SOLANA]),
  plannedPlatform({ id: 'save', name: 'Save', protocol: 'Save lending' }, 'SOLANA', [SOLANA]),
  plannedPlatform({ id: 'project-0', name: 'Project 0', protocol: 'marginfi v2' }, 'SOLANA', [
    SOLANA,
  ]),
  // Official planning evidence: https://developers.jup.ag/docs/lend/program-addresses
  plannedPlatform({ id: 'jupiter', name: 'Jupiter', protocol: 'Jupiter Lend' }, 'SOLANA', [SOLANA]),
]);

function assertSafeDirectory(entries: readonly MainnetPlatformDirectoryEntry[]): void {
  if (entries.length < MAINNET_PLATFORM_MINIMUM_PROVIDER_TARGET) {
    throw new TypeError('mainnet platform directory is below its provider target');
  }
  if (new Set(entries.map(({ id }) => id)).size !== entries.length) {
    throw new TypeError('mainnet platform directory contains a duplicate provider');
  }
  if (
    entries.some(
      (entry) =>
        entry.integrationStatus !== 'PLANNED' ||
        entry.dataStatus !== 'NOT_CONNECTED' ||
        entry.accessStatus !== 'UNAVAILABLE' ||
        entry.riskStatus !== 'NOT_ASSESSED' ||
        entry.supportedActions.length !== 0,
    )
  ) {
    throw new TypeError('mainnet platform directory cannot advertise an available capability');
  }
}

assertSafeDirectory(providers);

/**
 * Product roadmap directory only. It is deliberately independent from demo,
 * testnet, provider-RPC, market, asset, quote, and transaction modules.
 */
export const MAINNET_PLATFORM_DIRECTORY: MainnetPlatformDirectory = Object.freeze({
  schemaVersion: 1 as const,
  use: MAINNET_PLATFORM_DIRECTORY_USE,
  mayAuthorizeFinancialAction: false as const,
  minimumProviderTarget: MAINNET_PLATFORM_MINIMUM_PROVIDER_TARGET,
  providers,
});
