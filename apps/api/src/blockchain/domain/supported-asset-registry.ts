import { createHash } from 'node:crypto';

const EVM_CONTRACT_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const SOLANA_BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const SOLANA_ZERO_PUBLIC_KEY = '11111111111111111111111111111111';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export const SUPPORTED_CHAINS = Object.freeze(['ETHEREUM', 'BASE', 'ARBITRUM', 'SOLANA'] as const);
export const SUPPORTED_STABLECOINS = Object.freeze(['USDC', 'USDT', 'PYUSD'] as const);
export const ASSET_REGISTRY_ENVIRONMENTS = Object.freeze(['MAINNET', 'TESTNET'] as const);
export const REGISTRY_ACTIVATION_STATES = Object.freeze(['ACTIVE', 'INACTIVE'] as const);

const ASSET_IDENTITY_KINDS = Object.freeze(['EVM_CONTRACT', 'SOLANA_MINT'] as const);
const STABLECOIN_ISSUERS = Object.freeze(['CIRCLE', 'TETHER', 'PAXOS'] as const);

export type SupportedChain = (typeof SUPPORTED_CHAINS)[number];
export type SupportedStablecoin = (typeof SUPPORTED_STABLECOINS)[number];
export type AssetRegistryEnvironment = (typeof ASSET_REGISTRY_ENVIRONMENTS)[number];
export type RegistryActivationState = (typeof REGISTRY_ACTIVATION_STATES)[number];
export type AssetIdentityKind = (typeof ASSET_IDENTITY_KINDS)[number];
export type StablecoinIssuer = (typeof STABLECOIN_ISSUERS)[number];

export type SupportedAssetRegistryValidationCode =
  | 'INVALID_REGISTRY_VERSION'
  | 'INVALID_REGISTRY_ENVIRONMENT'
  | 'INVALID_CHAIN'
  | 'INVALID_NETWORK_ID'
  | 'WRONG_NETWORK'
  | 'DUPLICATE_NETWORK'
  | 'MISSING_TARGET_NETWORK'
  | 'INVALID_STABLECOIN'
  | 'INVALID_IDENTITY'
  | 'UNVERIFIED_IDENTITY'
  | 'IDENTITY_STABLECOIN_MISMATCH'
  | 'INVALID_DECIMALS'
  | 'INVALID_ACTIVATION_STATE'
  | 'ACTIVE_ASSET_ON_INACTIVE_NETWORK'
  | 'DUPLICATE_ASSET'
  | 'EMPTY_REGISTRY_HISTORY'
  | 'MIXED_REGISTRY_ENVIRONMENTS'
  | 'NON_SEQUENTIAL_REGISTRY_VERSION'
  | 'UNKNOWN_REGISTRY_VERSION';

export class SupportedAssetRegistryValidationError extends Error {
  constructor(readonly code: SupportedAssetRegistryValidationCode) {
    super(code);
    this.name = 'SupportedAssetRegistryValidationError';
  }
}

export interface SupportedNetworkDefinition {
  readonly chain: SupportedChain;
  readonly networkId: string;
  readonly activationState: RegistryActivationState;
}

export interface StablecoinAssetDefinition {
  readonly stablecoin: SupportedStablecoin;
  readonly chain: SupportedChain;
  readonly networkId: string;
  readonly identity: string;
  readonly decimals: number;
  readonly activationState: RegistryActivationState;
}

export interface SupportedAssetRegistrySnapshotDefinition {
  readonly version: number;
  readonly environment: AssetRegistryEnvironment;
  readonly networks: readonly SupportedNetworkDefinition[];
  readonly assets: readonly StablecoinAssetDefinition[];
}

export interface SupportedNetwork extends SupportedNetworkDefinition {
  readonly environment: AssetRegistryEnvironment;
  readonly displayName: string;
  readonly identityKind: AssetIdentityKind;
}

export interface SupportedStablecoinAsset extends StablecoinAssetDefinition {
  readonly registryVersion: number;
  readonly identityKind: AssetIdentityKind;
  readonly issuer: StablecoinIssuer;
  readonly verificationSource: string;
  readonly qualifiedIdentity: string;
}

export interface SupportedAssetRegistrySnapshot {
  readonly version: number;
  readonly environment: AssetRegistryEnvironment;
  readonly fingerprintSha256: string;
  readonly networks: readonly SupportedNetwork[];
  readonly assets: readonly SupportedStablecoinAsset[];
  /** Returns configured identity metadata even when that identity is inactive. */
  identifyAsset(networkId: string, identity: string): SupportedStablecoinAsset | undefined;
}

export interface VersionedSupportedAssetRegistry {
  readonly environment: AssetRegistryEnvironment;
  readonly versions: readonly number[];
  readonly latest: SupportedAssetRegistrySnapshot;
  atVersion(version: number): SupportedAssetRegistrySnapshot | undefined;
  /** Identifies an asset against an explicit historical snapshot without activating it. */
  identifyAssetAtVersion(
    version: number,
    networkId: string,
    identity: string,
  ): SupportedStablecoinAsset | undefined;
  /** Normalizes only against the latest configured snapshot. */
  normalizeAsset(networkId: string, identity: string): SupportedStablecoinAsset | undefined;
}

interface ReviewedNetwork {
  readonly environment: AssetRegistryEnvironment;
  readonly chain: SupportedChain;
  readonly networkId: string;
  readonly displayName: string;
  readonly identityKind: AssetIdentityKind;
}

interface VerifiedStablecoinIdentity {
  readonly environment: AssetRegistryEnvironment;
  readonly stablecoin: SupportedStablecoin;
  readonly issuer: StablecoinIssuer;
  readonly chain: SupportedChain;
  readonly networkId: string;
  readonly identity: string;
  readonly decimals: number;
  readonly verificationSource: string;
}

const CIRCLE_USDC_SOURCE = 'https://developers.circle.com/stablecoins/usdc-contract-addresses';
const TETHER_SOURCE = 'https://tether.to/en/supported-protocols/';
const PAXOS_PYUSD_MAINNET_SOURCE = 'https://docs.paxos.com/guides/stablecoin/pyusd/mainnet';
const PAXOS_PYUSD_TESTNET_SOURCE = 'https://docs.paxos.com/guides/stablecoin/pyusd/testnet';

const REVIEWED_NETWORKS: readonly ReviewedNetwork[] = Object.freeze([
  Object.freeze({
    environment: 'MAINNET',
    chain: 'ETHEREUM',
    networkId: 'eip155:1',
    displayName: 'Ethereum Mainnet',
    identityKind: 'EVM_CONTRACT',
  }),
  Object.freeze({
    environment: 'MAINNET',
    chain: 'BASE',
    networkId: 'eip155:8453',
    displayName: 'Base Mainnet',
    identityKind: 'EVM_CONTRACT',
  }),
  Object.freeze({
    environment: 'MAINNET',
    chain: 'ARBITRUM',
    networkId: 'eip155:42161',
    displayName: 'Arbitrum One',
    identityKind: 'EVM_CONTRACT',
  }),
  Object.freeze({
    environment: 'MAINNET',
    chain: 'SOLANA',
    networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    displayName: 'Solana Mainnet Beta',
    identityKind: 'SOLANA_MINT',
  }),
  Object.freeze({
    environment: 'TESTNET',
    chain: 'ETHEREUM',
    networkId: 'eip155:11155111',
    displayName: 'Ethereum Sepolia',
    identityKind: 'EVM_CONTRACT',
  }),
  Object.freeze({
    environment: 'TESTNET',
    chain: 'BASE',
    networkId: 'eip155:84532',
    displayName: 'Base Sepolia',
    identityKind: 'EVM_CONTRACT',
  }),
  Object.freeze({
    environment: 'TESTNET',
    chain: 'ARBITRUM',
    networkId: 'eip155:421614',
    displayName: 'Arbitrum Sepolia',
    identityKind: 'EVM_CONTRACT',
  }),
  Object.freeze({
    environment: 'TESTNET',
    chain: 'SOLANA',
    networkId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    displayName: 'Solana Devnet',
    identityKind: 'SOLANA_MINT',
  }),
]);

const VERIFIED_STABLECOIN_IDENTITIES: readonly VerifiedStablecoinIdentity[] = Object.freeze([
  verifiedIdentity(
    'MAINNET',
    'USDC',
    'CIRCLE',
    'ETHEREUM',
    'eip155:1',
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    6,
    CIRCLE_USDC_SOURCE,
  ),
  verifiedIdentity(
    'MAINNET',
    'USDC',
    'CIRCLE',
    'BASE',
    'eip155:8453',
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    6,
    CIRCLE_USDC_SOURCE,
  ),
  verifiedIdentity(
    'MAINNET',
    'USDC',
    'CIRCLE',
    'ARBITRUM',
    'eip155:42161',
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    6,
    CIRCLE_USDC_SOURCE,
  ),
  verifiedIdentity(
    'MAINNET',
    'USDC',
    'CIRCLE',
    'SOLANA',
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    6,
    CIRCLE_USDC_SOURCE,
  ),
  verifiedIdentity(
    'MAINNET',
    'USDT',
    'TETHER',
    'ETHEREUM',
    'eip155:1',
    '0xdac17f958d2ee523a2206206994597c13d831ec7',
    6,
    TETHER_SOURCE,
  ),
  verifiedIdentity(
    'MAINNET',
    'USDT',
    'TETHER',
    'SOLANA',
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    6,
    TETHER_SOURCE,
  ),
  verifiedIdentity(
    'MAINNET',
    'PYUSD',
    'PAXOS',
    'ETHEREUM',
    'eip155:1',
    '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
    6,
    PAXOS_PYUSD_MAINNET_SOURCE,
  ),
  verifiedIdentity(
    'MAINNET',
    'PYUSD',
    'PAXOS',
    'ARBITRUM',
    'eip155:42161',
    '0x46850ad61c2b7d64d08c9c754f45254596696984',
    6,
    PAXOS_PYUSD_MAINNET_SOURCE,
  ),
  verifiedIdentity(
    'MAINNET',
    'PYUSD',
    'PAXOS',
    'SOLANA',
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
    6,
    PAXOS_PYUSD_MAINNET_SOURCE,
  ),
  verifiedIdentity(
    'TESTNET',
    'USDC',
    'CIRCLE',
    'ETHEREUM',
    'eip155:11155111',
    '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',
    6,
    CIRCLE_USDC_SOURCE,
  ),
  verifiedIdentity(
    'TESTNET',
    'USDC',
    'CIRCLE',
    'BASE',
    'eip155:84532',
    '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    6,
    CIRCLE_USDC_SOURCE,
  ),
  verifiedIdentity(
    'TESTNET',
    'USDC',
    'CIRCLE',
    'ARBITRUM',
    'eip155:421614',
    '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d',
    6,
    CIRCLE_USDC_SOURCE,
  ),
  verifiedIdentity(
    'TESTNET',
    'USDC',
    'CIRCLE',
    'SOLANA',
    'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    6,
    CIRCLE_USDC_SOURCE,
  ),
  verifiedIdentity(
    'TESTNET',
    'PYUSD',
    'PAXOS',
    'ETHEREUM',
    'eip155:11155111',
    '0xcac524bca292aaade2df8a05cc58f0a65b1b3bb9',
    6,
    PAXOS_PYUSD_TESTNET_SOURCE,
  ),
  verifiedIdentity(
    'TESTNET',
    'PYUSD',
    'PAXOS',
    'ARBITRUM',
    'eip155:421614',
    '0x637a1259c6afd7e3adf63993ca7e58bb438ab1b1',
    6,
    PAXOS_PYUSD_TESTNET_SOURCE,
  ),
  verifiedIdentity(
    'TESTNET',
    'PYUSD',
    'PAXOS',
    'SOLANA',
    'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    'CXk2AMBfi3TwaEL2468s6zP8xq9NxTXjp9gjMgzeUynM',
    6,
    PAXOS_PYUSD_TESTNET_SOURCE,
  ),
]);

function verifiedIdentity(
  environment: AssetRegistryEnvironment,
  stablecoin: SupportedStablecoin,
  issuer: StablecoinIssuer,
  chain: SupportedChain,
  networkId: string,
  identity: string,
  decimals: number,
  verificationSource: string,
): VerifiedStablecoinIdentity {
  return Object.freeze({
    environment,
    stablecoin,
    issuer,
    chain,
    networkId,
    identity,
    decimals,
    verificationSource,
  });
}

function isOneOf<const Value extends string>(
  value: unknown,
  allowed: readonly Value[],
): value is Value {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function parseEnvironment(value: unknown): AssetRegistryEnvironment {
  if (!isOneOf(value, ASSET_REGISTRY_ENVIRONMENTS)) {
    throw new SupportedAssetRegistryValidationError('INVALID_REGISTRY_ENVIRONMENT');
  }
  return value;
}

function parseChain(value: unknown): SupportedChain {
  if (!isOneOf(value, SUPPORTED_CHAINS)) {
    throw new SupportedAssetRegistryValidationError('INVALID_CHAIN');
  }
  return value;
}

function parseStablecoin(value: unknown): SupportedStablecoin {
  if (!isOneOf(value, SUPPORTED_STABLECOINS)) {
    throw new SupportedAssetRegistryValidationError('INVALID_STABLECOIN');
  }
  return value;
}

function parseActivationState(value: unknown): RegistryActivationState {
  if (!isOneOf(value, REGISTRY_ACTIVATION_STATES)) {
    throw new SupportedAssetRegistryValidationError('INVALID_ACTIVATION_STATE');
  }
  return value;
}

function parseVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new SupportedAssetRegistryValidationError('INVALID_REGISTRY_VERSION');
  }
  return value as number;
}

function parseNetworkId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 3 ||
    value.length > 64 ||
    !/^[a-z0-9]+:[A-Za-z0-9]+$/u.test(value)
  ) {
    throw new SupportedAssetRegistryValidationError('INVALID_NETWORK_ID');
  }
  return value;
}

function solanaPublicKeyByteLength(value: string): number {
  let numericValue = 0n;
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) {
      return -1;
    }
    numericValue = numericValue * 58n + BigInt(digit);
  }
  const leadingZeroBytes = value.match(/^1*/u)?.[0].length ?? 0;
  const numericBytes = numericValue === 0n ? 0 : Math.ceil(numericValue.toString(16).length / 2);
  return leadingZeroBytes + numericBytes;
}

function normalizeIdentity(kind: AssetIdentityKind, value: unknown): string {
  if (typeof value !== 'string') {
    throw new SupportedAssetRegistryValidationError('INVALID_IDENTITY');
  }
  if (kind === 'EVM_CONTRACT') {
    if (!EVM_CONTRACT_PATTERN.test(value) || /^0x0{40}$/u.test(value)) {
      throw new SupportedAssetRegistryValidationError('INVALID_IDENTITY');
    }
    return value.toLowerCase();
  }
  if (
    !SOLANA_BASE58_PATTERN.test(value) ||
    value === SOLANA_ZERO_PUBLIC_KEY ||
    solanaPublicKeyByteLength(value) !== 32
  ) {
    throw new SupportedAssetRegistryValidationError('INVALID_IDENTITY');
  }
  return value;
}

function expectedIssuerFor(stablecoin: SupportedStablecoin): StablecoinIssuer {
  switch (stablecoin) {
    case 'USDC':
      return 'CIRCLE';
    case 'USDT':
      return 'TETHER';
    case 'PYUSD':
      return 'PAXOS';
  }
}

function isHttpsVerificationSource(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const source = new URL(value);
    return (
      source.protocol === 'https:' &&
      source.hostname.length > 0 &&
      source.username.length === 0 &&
      source.password.length === 0
    );
  } catch {
    return false;
  }
}

function validateClosedVerificationCatalog(
  networks: readonly ReviewedNetwork[],
  identities: readonly VerifiedStablecoinIdentity[],
): void {
  const networkByCandidateKey = new Map<string, ReviewedNetwork>();
  const networkIds = new Set<string>();
  const environmentChainSlots = new Set<string>();

  for (const network of networks) {
    const environment = parseEnvironment(network.environment);
    const chain = parseChain(network.chain);
    const networkId = parseNetworkId(network.networkId);
    const environmentChainKey = `${environment}\0${chain}`;
    const candidateKey = `${environmentChainKey}\0${networkId}`;
    if (networkByCandidateKey.has(candidateKey) || networkIds.has(networkId)) {
      throw new SupportedAssetRegistryValidationError('DUPLICATE_NETWORK');
    }
    const expectedIdentityKind = chain === 'SOLANA' ? 'SOLANA_MINT' : 'EVM_CONTRACT';
    if (
      !isOneOf(network.identityKind, ASSET_IDENTITY_KINDS) ||
      network.identityKind !== expectedIdentityKind ||
      network.displayName.trim().length === 0
    ) {
      throw new SupportedAssetRegistryValidationError('WRONG_NETWORK');
    }
    networkByCandidateKey.set(candidateKey, network);
    networkIds.add(networkId);
    environmentChainSlots.add(environmentChainKey);
  }

  for (const environment of ASSET_REGISTRY_ENVIRONMENTS) {
    if (SUPPORTED_CHAINS.some((chain) => !environmentChainSlots.has(`${environment}\0${chain}`))) {
      throw new SupportedAssetRegistryValidationError('MISSING_TARGET_NETWORK');
    }
  }
  const identityKeys = new Set<string>();
  for (const candidate of identities) {
    const environment = parseEnvironment(candidate.environment);
    const stablecoin = parseStablecoin(candidate.stablecoin);
    const chain = parseChain(candidate.chain);
    const networkId = parseNetworkId(candidate.networkId);
    const network = networkByCandidateKey.get(`${environment}\0${chain}\0${networkId}`);
    if (!network) {
      throw new SupportedAssetRegistryValidationError('WRONG_NETWORK');
    }
    if (
      !isOneOf(candidate.issuer, STABLECOIN_ISSUERS) ||
      candidate.issuer !== expectedIssuerFor(stablecoin)
    ) {
      throw new SupportedAssetRegistryValidationError('IDENTITY_STABLECOIN_MISMATCH');
    }
    const identity = normalizeIdentity(network.identityKind, candidate.identity);
    if (identity !== candidate.identity) {
      throw new SupportedAssetRegistryValidationError('INVALID_IDENTITY');
    }
    if (
      !Number.isSafeInteger(candidate.decimals) ||
      candidate.decimals < 0 ||
      candidate.decimals > 36
    ) {
      throw new SupportedAssetRegistryValidationError('INVALID_DECIMALS');
    }
    if (!isHttpsVerificationSource(candidate.verificationSource)) {
      throw new SupportedAssetRegistryValidationError('UNVERIFIED_IDENTITY');
    }

    const identityKey = `${environment}\0${networkId}\0${identity}`;
    if (identityKeys.has(identityKey)) {
      throw new SupportedAssetRegistryValidationError('DUPLICATE_ASSET');
    }
    identityKeys.add(identityKey);
  }
}

/** @internal Test-only seam for closed-catalog invariant regression coverage. */
export const SUPPORTED_ASSET_REGISTRY_TEST_HOOKS = Object.freeze({
  validateCatalog: validateClosedVerificationCatalog,
});

validateClosedVerificationCatalog(REVIEWED_NETWORKS, VERIFIED_STABLECOIN_IDENTITIES);

function reviewedNetworksFor(environment: AssetRegistryEnvironment): readonly ReviewedNetwork[] {
  return REVIEWED_NETWORKS.filter((network) => network.environment === environment);
}

function verifiedIdentityCandidates(
  kind: AssetIdentityKind,
  identity: string,
): readonly VerifiedStablecoinIdentity[] {
  return VERIFIED_STABLECOIN_IDENTITIES.filter((candidate) => {
    const candidateNetwork = REVIEWED_NETWORKS.find(
      (network) =>
        network.environment === candidate.environment &&
        network.chain === candidate.chain &&
        network.networkId === candidate.networkId,
    );
    return (
      candidateNetwork?.identityKind === kind &&
      normalizeIdentity(kind, candidate.identity) === identity
    );
  });
}

function validateNetworkDefinitions(
  environment: AssetRegistryEnvironment,
  definitions: readonly SupportedNetworkDefinition[],
): {
  readonly networks: readonly SupportedNetwork[];
  readonly byChain: ReadonlyMap<SupportedChain, SupportedNetwork>;
  readonly byNetworkId: ReadonlyMap<string, SupportedNetwork>;
} {
  const reviewed = reviewedNetworksFor(environment);
  const byChain = new Map<SupportedChain, SupportedNetwork>();
  const byNetworkId = new Map<string, SupportedNetwork>();
  const networks: SupportedNetwork[] = [];

  for (const definition of definitions) {
    const chain = parseChain(definition.chain);
    const networkId = parseNetworkId(definition.networkId);
    const activationState = parseActivationState(definition.activationState);
    const expected = reviewed.find(
      (network) => network.chain === chain && network.networkId === networkId,
    );
    if (!expected) {
      throw new SupportedAssetRegistryValidationError('WRONG_NETWORK');
    }
    if (byChain.has(chain) || byNetworkId.has(networkId)) {
      throw new SupportedAssetRegistryValidationError('DUPLICATE_NETWORK');
    }
    const network = Object.freeze({
      chain,
      networkId,
      activationState,
      environment,
      displayName: expected.displayName,
      identityKind: expected.identityKind,
    });
    byChain.set(chain, network);
    byNetworkId.set(networkId, network);
    networks.push(network);
  }

  if (
    networks.length !== SUPPORTED_CHAINS.length ||
    SUPPORTED_CHAINS.some((chain) => !byChain.has(chain))
  ) {
    throw new SupportedAssetRegistryValidationError('MISSING_TARGET_NETWORK');
  }

  return {
    networks: Object.freeze(networks),
    byChain,
    byNetworkId,
  };
}

function validateAssetDefinition(
  version: number,
  environment: AssetRegistryEnvironment,
  definition: StablecoinAssetDefinition,
  networkByChain: ReadonlyMap<SupportedChain, SupportedNetwork>,
): SupportedStablecoinAsset {
  const stablecoin = parseStablecoin(definition.stablecoin);
  const chain = parseChain(definition.chain);
  const networkId = parseNetworkId(definition.networkId);
  const activationState = parseActivationState(definition.activationState);
  const network = networkByChain.get(chain);
  if (!network || network.networkId !== networkId) {
    throw new SupportedAssetRegistryValidationError('WRONG_NETWORK');
  }
  if (activationState === 'ACTIVE' && network.activationState !== 'ACTIVE') {
    throw new SupportedAssetRegistryValidationError('ACTIVE_ASSET_ON_INACTIVE_NETWORK');
  }

  const identity = normalizeIdentity(network.identityKind, definition.identity);
  const candidates = verifiedIdentityCandidates(network.identityKind, identity);
  if (candidates.length === 0) {
    throw new SupportedAssetRegistryValidationError('UNVERIFIED_IDENTITY');
  }
  const networkCandidate = candidates.find(
    (candidate) =>
      candidate.environment === environment &&
      candidate.chain === chain &&
      candidate.networkId === networkId,
  );
  if (!networkCandidate) {
    throw new SupportedAssetRegistryValidationError('WRONG_NETWORK');
  }
  if (networkCandidate.stablecoin !== stablecoin) {
    throw new SupportedAssetRegistryValidationError('IDENTITY_STABLECOIN_MISMATCH');
  }
  if (
    !Number.isSafeInteger(definition.decimals) ||
    definition.decimals !== networkCandidate.decimals
  ) {
    throw new SupportedAssetRegistryValidationError('INVALID_DECIMALS');
  }

  return Object.freeze({
    registryVersion: version,
    stablecoin,
    issuer: networkCandidate.issuer,
    chain,
    networkId,
    identityKind: network.identityKind,
    identity,
    qualifiedIdentity: `${networkId}/${network.identityKind.toLowerCase()}:${identity}`,
    decimals: networkCandidate.decimals,
    activationState,
    verificationSource: networkCandidate.verificationSource,
  });
}

function fingerprintSnapshot(
  version: number,
  environment: AssetRegistryEnvironment,
  networks: readonly SupportedNetwork[],
  assets: readonly SupportedStablecoinAsset[],
): string {
  const compareCanonical = (left: string, right: string): number =>
    left < right ? -1 : left > right ? 1 : 0;
  const canonicalNetworks = [...networks].sort((left, right) =>
    compareCanonical(`${left.networkId}\0${left.chain}`, `${right.networkId}\0${right.chain}`),
  );
  const canonicalAssets = [...assets].sort((left, right) =>
    compareCanonical(
      `${left.networkId}\0${left.stablecoin}\0${left.identity}`,
      `${right.networkId}\0${right.stablecoin}\0${right.identity}`,
    ),
  );
  const canonicalSnapshot = JSON.stringify([
    'crypto-lending:supported-asset-registry-snapshot:v1',
    version,
    environment,
    canonicalNetworks.map((network) => [
      network.chain,
      network.networkId,
      network.activationState,
      network.environment,
      network.displayName,
      network.identityKind,
    ]),
    canonicalAssets.map((asset) => [
      asset.registryVersion,
      asset.stablecoin,
      asset.issuer,
      asset.chain,
      asset.networkId,
      asset.identityKind,
      asset.identity,
      asset.qualifiedIdentity,
      asset.decimals,
      asset.activationState,
      asset.verificationSource,
    ]),
  ]);
  return createHash('sha256').update(canonicalSnapshot, 'utf8').digest('hex');
}

export function createSupportedAssetRegistrySnapshot(
  definition: SupportedAssetRegistrySnapshotDefinition,
): SupportedAssetRegistrySnapshot {
  const version = parseVersion(definition.version);
  const environment = parseEnvironment(definition.environment);
  const validatedNetworks = validateNetworkDefinitions(environment, definition.networks);
  const assets: SupportedStablecoinAsset[] = [];
  const identityKeys = new Set<string>();
  const assetKeys = new Set<string>();

  for (const definitionAsset of definition.assets) {
    const asset = validateAssetDefinition(
      version,
      environment,
      definitionAsset,
      validatedNetworks.byChain,
    );
    const assetKey = `${asset.networkId}\0${asset.stablecoin}`;
    const identityKey = `${asset.networkId}\0${asset.identity}`;
    if (assetKeys.has(assetKey) || identityKeys.has(identityKey)) {
      throw new SupportedAssetRegistryValidationError('DUPLICATE_ASSET');
    }
    identityKeys.add(identityKey);
    assetKeys.add(assetKey);
    assets.push(asset);
  }

  const frozenAssets = Object.freeze(assets);
  const assetByIdentity = new Map(
    frozenAssets.map((asset) => [`${asset.networkId}\0${asset.identity}`, asset] as const),
  );

  function identifyAsset(
    networkIdInput: string,
    identityInput: string,
  ): SupportedStablecoinAsset | undefined {
    const network = validatedNetworks.byNetworkId.get(networkIdInput);
    if (!network) {
      return undefined;
    }
    let identity: string;
    try {
      identity = normalizeIdentity(network.identityKind, identityInput);
    } catch {
      return undefined;
    }
    return assetByIdentity.get(`${network.networkId}\0${identity}`);
  }

  return Object.freeze({
    version,
    environment,
    fingerprintSha256: fingerprintSnapshot(
      version,
      environment,
      validatedNetworks.networks,
      frozenAssets,
    ),
    networks: validatedNetworks.networks,
    assets: frozenAssets,
    identifyAsset,
  });
}

export function createVersionedSupportedAssetRegistry(
  definitions: readonly SupportedAssetRegistrySnapshotDefinition[],
): VersionedSupportedAssetRegistry {
  if (definitions.length === 0) {
    throw new SupportedAssetRegistryValidationError('EMPTY_REGISTRY_HISTORY');
  }
  const snapshots = definitions.map(createSupportedAssetRegistrySnapshot);
  const environment = snapshots[0]?.environment;
  if (!environment) {
    throw new SupportedAssetRegistryValidationError('EMPTY_REGISTRY_HISTORY');
  }
  if (snapshots.some((snapshot) => snapshot.environment !== environment)) {
    throw new SupportedAssetRegistryValidationError('MIXED_REGISTRY_ENVIRONMENTS');
  }
  for (const [index, snapshot] of snapshots.entries()) {
    if (snapshot.version !== index + 1) {
      throw new SupportedAssetRegistryValidationError('NON_SEQUENTIAL_REGISTRY_VERSION');
    }
  }
  const byVersion = new Map(snapshots.map((snapshot) => [snapshot.version, snapshot] as const));
  const latest = snapshots.at(-1);
  if (!latest) {
    throw new SupportedAssetRegistryValidationError('EMPTY_REGISTRY_HISTORY');
  }
  const latestSnapshot: SupportedAssetRegistrySnapshot = latest;

  function identifyAssetAtVersion(
    versionInput: number,
    networkId: string,
    identity: string,
  ): SupportedStablecoinAsset | undefined {
    const version = parseVersion(versionInput);
    const snapshot = byVersion.get(version);
    if (!snapshot) {
      throw new SupportedAssetRegistryValidationError('UNKNOWN_REGISTRY_VERSION');
    }
    return snapshot.identifyAsset(networkId, identity);
  }

  function normalizeAsset(
    networkId: string,
    identity: string,
  ): SupportedStablecoinAsset | undefined {
    const asset = latestSnapshot.identifyAsset(networkId, identity);
    const network = latestSnapshot.networks.find((candidate) => candidate.networkId === networkId);
    return asset?.activationState === 'ACTIVE' && network?.activationState === 'ACTIVE'
      ? asset
      : undefined;
  }

  return Object.freeze({
    environment,
    versions: Object.freeze(snapshots.map((snapshot) => snapshot.version)),
    latest: latestSnapshot,
    atVersion: (version: number): SupportedAssetRegistrySnapshot | undefined =>
      byVersion.get(version),
    identifyAssetAtVersion,
    normalizeAsset,
  });
}

interface RegistryAssetManifestEntry extends StablecoinAssetDefinition {
  readonly issuer: StablecoinIssuer;
  readonly verificationSource: string;
}

function assetDefinitionsFromManifest(
  environment: AssetRegistryEnvironment,
  manifest: readonly RegistryAssetManifestEntry[],
): readonly StablecoinAssetDefinition[] {
  return Object.freeze(
    manifest.map((entry) => {
      const matches = VERIFIED_STABLECOIN_IDENTITIES.filter(
        (candidate) =>
          candidate.environment === environment &&
          candidate.stablecoin === entry.stablecoin &&
          candidate.issuer === entry.issuer &&
          candidate.chain === entry.chain &&
          candidate.networkId === entry.networkId &&
          candidate.identity === entry.identity &&
          candidate.decimals === entry.decimals &&
          candidate.verificationSource === entry.verificationSource,
      );
      if (matches.length === 0) {
        throw new SupportedAssetRegistryValidationError('UNVERIFIED_IDENTITY');
      }
      if (matches.length !== 1) {
        throw new SupportedAssetRegistryValidationError('DUPLICATE_ASSET');
      }
      return Object.freeze({
        stablecoin: entry.stablecoin,
        chain: entry.chain,
        networkId: entry.networkId,
        identity: entry.identity,
        decimals: entry.decimals,
        activationState: entry.activationState,
      });
    }),
  );
}

// Historical manifests are deliberately explicit and separate from the
// issuer-verification catalog. Adding a candidate identity must not alter an
// existing snapshot; a later version must opt into it here.
const V1_CIRCLE_USDC_SOURCE = 'https://developers.circle.com/stablecoins/usdc-contract-addresses';
const V1_TETHER_SOURCE = 'https://tether.to/en/supported-protocols/';
const V1_PAXOS_PYUSD_MAINNET_SOURCE = 'https://docs.paxos.com/guides/stablecoin/pyusd/mainnet';
const V1_PAXOS_PYUSD_TESTNET_SOURCE = 'https://docs.paxos.com/guides/stablecoin/pyusd/testnet';

const MAINNET_V1_NETWORK_DEFINITIONS: readonly SupportedNetworkDefinition[] = Object.freeze([
  Object.freeze({
    chain: 'ETHEREUM',
    networkId: 'eip155:1',
    activationState: 'ACTIVE',
  }),
  Object.freeze({
    chain: 'BASE',
    networkId: 'eip155:8453',
    activationState: 'ACTIVE',
  }),
  Object.freeze({
    chain: 'ARBITRUM',
    networkId: 'eip155:42161',
    activationState: 'ACTIVE',
  }),
  Object.freeze({
    chain: 'SOLANA',
    networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    activationState: 'ACTIVE',
  }),
]);

const TESTNET_V1_NETWORK_DEFINITIONS: readonly SupportedNetworkDefinition[] = Object.freeze([
  Object.freeze({
    chain: 'ETHEREUM',
    networkId: 'eip155:11155111',
    activationState: 'ACTIVE',
  }),
  Object.freeze({
    chain: 'BASE',
    networkId: 'eip155:84532',
    activationState: 'ACTIVE',
  }),
  Object.freeze({
    chain: 'ARBITRUM',
    networkId: 'eip155:421614',
    activationState: 'ACTIVE',
  }),
  Object.freeze({
    chain: 'SOLANA',
    networkId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    activationState: 'ACTIVE',
  }),
]);

const MAINNET_V1_ASSET_MANIFEST: readonly RegistryAssetManifestEntry[] = Object.freeze([
  Object.freeze({
    stablecoin: 'USDC',
    issuer: 'CIRCLE',
    chain: 'ETHEREUM',
    networkId: 'eip155:1',
    identity: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    decimals: 6,
    activationState: 'ACTIVE',
    verificationSource: V1_CIRCLE_USDC_SOURCE,
  }),
  Object.freeze({
    stablecoin: 'USDC',
    issuer: 'CIRCLE',
    chain: 'BASE',
    networkId: 'eip155:8453',
    identity: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    decimals: 6,
    activationState: 'ACTIVE',
    verificationSource: V1_CIRCLE_USDC_SOURCE,
  }),
  Object.freeze({
    stablecoin: 'USDC',
    issuer: 'CIRCLE',
    chain: 'ARBITRUM',
    networkId: 'eip155:42161',
    identity: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    decimals: 6,
    activationState: 'ACTIVE',
    verificationSource: V1_CIRCLE_USDC_SOURCE,
  }),
  Object.freeze({
    stablecoin: 'USDC',
    issuer: 'CIRCLE',
    chain: 'SOLANA',
    networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    identity: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
    activationState: 'ACTIVE',
    verificationSource: V1_CIRCLE_USDC_SOURCE,
  }),
  Object.freeze({
    stablecoin: 'USDT',
    issuer: 'TETHER',
    chain: 'ETHEREUM',
    networkId: 'eip155:1',
    identity: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    decimals: 6,
    activationState: 'ACTIVE',
    verificationSource: V1_TETHER_SOURCE,
  }),
  Object.freeze({
    stablecoin: 'USDT',
    issuer: 'TETHER',
    chain: 'SOLANA',
    networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    identity: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    decimals: 6,
    activationState: 'ACTIVE',
    verificationSource: V1_TETHER_SOURCE,
  }),
  Object.freeze({
    stablecoin: 'PYUSD',
    issuer: 'PAXOS',
    chain: 'ETHEREUM',
    networkId: 'eip155:1',
    identity: '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
    decimals: 6,
    activationState: 'ACTIVE',
    verificationSource: V1_PAXOS_PYUSD_MAINNET_SOURCE,
  }),
  Object.freeze({
    stablecoin: 'PYUSD',
    issuer: 'PAXOS',
    chain: 'ARBITRUM',
    networkId: 'eip155:42161',
    identity: '0x46850ad61c2b7d64d08c9c754f45254596696984',
    decimals: 6,
    activationState: 'ACTIVE',
    verificationSource: V1_PAXOS_PYUSD_MAINNET_SOURCE,
  }),
  Object.freeze({
    stablecoin: 'PYUSD',
    issuer: 'PAXOS',
    chain: 'SOLANA',
    networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    identity: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
    decimals: 6,
    activationState: 'ACTIVE',
    verificationSource: V1_PAXOS_PYUSD_MAINNET_SOURCE,
  }),
]);

const TESTNET_V1_ASSET_MANIFEST: readonly RegistryAssetManifestEntry[] = Object.freeze([
  Object.freeze({
    stablecoin: 'USDC',
    issuer: 'CIRCLE',
    chain: 'ETHEREUM',
    networkId: 'eip155:11155111',
    identity: '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',
    decimals: 6,
    activationState: 'ACTIVE',
    verificationSource: V1_CIRCLE_USDC_SOURCE,
  }),
  Object.freeze({
    stablecoin: 'USDC',
    issuer: 'CIRCLE',
    chain: 'BASE',
    networkId: 'eip155:84532',
    identity: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    decimals: 6,
    activationState: 'ACTIVE',
    verificationSource: V1_CIRCLE_USDC_SOURCE,
  }),
  Object.freeze({
    stablecoin: 'USDC',
    issuer: 'CIRCLE',
    chain: 'ARBITRUM',
    networkId: 'eip155:421614',
    identity: '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d',
    decimals: 6,
    activationState: 'ACTIVE',
    verificationSource: V1_CIRCLE_USDC_SOURCE,
  }),
  Object.freeze({
    stablecoin: 'USDC',
    issuer: 'CIRCLE',
    chain: 'SOLANA',
    networkId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    identity: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    decimals: 6,
    activationState: 'ACTIVE',
    verificationSource: V1_CIRCLE_USDC_SOURCE,
  }),
  Object.freeze({
    stablecoin: 'PYUSD',
    issuer: 'PAXOS',
    chain: 'ETHEREUM',
    networkId: 'eip155:11155111',
    identity: '0xcac524bca292aaade2df8a05cc58f0a65b1b3bb9',
    decimals: 6,
    activationState: 'ACTIVE',
    verificationSource: V1_PAXOS_PYUSD_TESTNET_SOURCE,
  }),
  Object.freeze({
    stablecoin: 'PYUSD',
    issuer: 'PAXOS',
    chain: 'ARBITRUM',
    networkId: 'eip155:421614',
    identity: '0x637a1259c6afd7e3adf63993ca7e58bb438ab1b1',
    decimals: 6,
    activationState: 'ACTIVE',
    verificationSource: V1_PAXOS_PYUSD_TESTNET_SOURCE,
  }),
  Object.freeze({
    stablecoin: 'PYUSD',
    issuer: 'PAXOS',
    chain: 'SOLANA',
    networkId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    identity: 'CXk2AMBfi3TwaEL2468s6zP8xq9NxTXjp9gjMgzeUynM',
    decimals: 6,
    activationState: 'ACTIVE',
    verificationSource: V1_PAXOS_PYUSD_TESTNET_SOURCE,
  }),
]);

export const MAINNET_SUPPORTED_ASSET_REGISTRY = createVersionedSupportedAssetRegistry([
  {
    version: 1,
    environment: 'MAINNET',
    networks: MAINNET_V1_NETWORK_DEFINITIONS,
    assets: assetDefinitionsFromManifest('MAINNET', MAINNET_V1_ASSET_MANIFEST),
  },
]);

export const TESTNET_SUPPORTED_ASSET_REGISTRY = createVersionedSupportedAssetRegistry([
  {
    version: 1,
    environment: 'TESTNET',
    networks: TESTNET_V1_NETWORK_DEFINITIONS,
    assets: assetDefinitionsFromManifest('TESTNET', TESTNET_V1_ASSET_MANIFEST),
  },
]);

export function supportedAssetRegistryForEnvironment(
  environmentInput: AssetRegistryEnvironment,
): VersionedSupportedAssetRegistry {
  const environment = parseEnvironment(environmentInput);
  return environment === 'MAINNET'
    ? MAINNET_SUPPORTED_ASSET_REGISTRY
    : TESTNET_SUPPORTED_ASSET_REGISTRY;
}
