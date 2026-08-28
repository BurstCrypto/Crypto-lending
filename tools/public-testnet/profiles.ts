import {
  chainObservationPolicyForNetwork,
  type ChainObservationNetworkId,
} from '../../apps/api/src/blockchain/domain/chain-observation-policy';

export const PUBLIC_TESTNET_NETWORK_IDS = Object.freeze([
  'eip155:11155111',
  'eip155:84532',
  'eip155:421614',
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
] as const);

export type PublicTestnetNetworkId = (typeof PUBLIC_TESTNET_NETWORK_IDS)[number];

type EvmPublicTestnetProfile = Readonly<{
  family: 'EVM';
  name: string;
  networkId: Exclude<PublicTestnetNetworkId, `solana:${string}`>;
  endpoint: string;
  identityProbe: Readonly<{
    method: 'eth_chainId';
    params: readonly [];
    expectedResult: string;
  }>;
  finalizedProbe: Readonly<{
    method: 'eth_getBlockByNumber';
    params: readonly ['finalized', false];
  }>;
}>;

type SolanaPublicTestnetProfile = Readonly<{
  family: 'SOLANA';
  name: string;
  networkId: Extract<PublicTestnetNetworkId, `solana:${string}`>;
  endpoint: string;
  identityProbe: Readonly<{
    method: 'getGenesisHash';
    params: readonly [];
    expectedResult: string;
  }>;
  finalizedProbe: Readonly<{
    method: 'getSlot';
    params: readonly [Readonly<{ commitment: 'finalized' }>];
  }>;
}>;

export type PublicTestnetProfile = EvmPublicTestnetProfile | SolanaPublicTestnetProfile;

function isEvmPublicTestnetNetworkId(
  networkId: PublicTestnetNetworkId,
): networkId is Exclude<PublicTestnetNetworkId, `solana:${string}`> {
  return networkId.startsWith('eip155:');
}

const ENDPOINTS = Object.freeze({
  'eip155:11155111': 'https://ethereum-sepolia-rpc.publicnode.com/',
  'eip155:84532': 'https://sepolia.base.org/',
  'eip155:421614': 'https://sepolia-rollup.arbitrum.io/rpc',
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': 'https://api.devnet.solana.com/',
} as const satisfies Readonly<Record<PublicTestnetNetworkId, string>>);

const NAMES = Object.freeze({
  'eip155:11155111': 'Ethereum Sepolia',
  'eip155:84532': 'Base Sepolia',
  'eip155:421614': 'Arbitrum Sepolia',
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': 'Solana devnet',
} as const satisfies Readonly<Record<PublicTestnetNetworkId, string>>);

function buildProfile(networkId: PublicTestnetNetworkId): PublicTestnetProfile {
  const policy = chainObservationPolicyForNetwork(networkId);
  if (!policy || policy.environment !== 'TESTNET') {
    throw new Error(`PUBLIC_TESTNET_POLICY_MISSING:${networkId}`);
  }

  if (policy.identityProbe.kind === 'EVM_CHAIN_ID') {
    if (!isEvmPublicTestnetNetworkId(networkId)) {
      throw new Error(`PUBLIC_TESTNET_POLICY_FAMILY_MISMATCH:${networkId}`);
    }

    return Object.freeze({
      family: 'EVM',
      name: NAMES[networkId],
      networkId,
      endpoint: ENDPOINTS[networkId],
      identityProbe: Object.freeze({
        method: policy.identityProbe.method,
        params: Object.freeze([]) as readonly [],
        expectedResult: policy.identityProbe.expectedResult,
      }),
      finalizedProbe: Object.freeze({
        method: 'eth_getBlockByNumber' as const,
        params: Object.freeze(['finalized', false]) as readonly ['finalized', false],
      }),
    });
  }

  if (isEvmPublicTestnetNetworkId(networkId)) {
    throw new Error(`PUBLIC_TESTNET_POLICY_FAMILY_MISMATCH:${networkId}`);
  }

  return Object.freeze({
    family: 'SOLANA',
    name: NAMES[networkId],
    networkId,
    endpoint: ENDPOINTS[networkId],
    identityProbe: Object.freeze({
      method: policy.identityProbe.method,
      params: Object.freeze([]) as readonly [],
      expectedResult: policy.identityProbe.expectedResult,
    }),
    finalizedProbe: Object.freeze({
      method: 'getSlot' as const,
      params: Object.freeze([Object.freeze({ commitment: 'finalized' as const })]) as readonly [
        Readonly<{ commitment: 'finalized' }>,
      ],
    }),
  });
}

export const PUBLIC_TESTNET_PROFILES = Object.freeze(PUBLIC_TESTNET_NETWORK_IDS.map(buildProfile));

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertSafeEndpoint(value: string, expected: string): void {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('PUBLIC_TESTNET_ENDPOINT_INVALID');
  }

  if (
    endpoint.toString() !== expected ||
    endpoint.protocol !== 'https:' ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.search !== '' ||
    endpoint.hash !== ''
  ) {
    throw new Error('PUBLIC_TESTNET_ENDPOINT_INVALID');
  }
}

/**
 * Fails closed if the local smoke-test configuration drifts from the immutable
 * application testnet identities or from its fixed, credential-free endpoints.
 */
export function validatePublicTestnetProfiles(profiles: readonly PublicTestnetProfile[]): void {
  if (profiles.length !== PUBLIC_TESTNET_NETWORK_IDS.length) {
    throw new Error('PUBLIC_TESTNET_PROFILE_SET_INVALID');
  }

  const seen = new Set<ChainObservationNetworkId>();
  for (const profile of profiles) {
    if (seen.has(profile.networkId)) throw new Error('PUBLIC_TESTNET_PROFILE_SET_INVALID');
    seen.add(profile.networkId);

    const expected = buildProfile(profile.networkId);
    assertSafeEndpoint(profile.endpoint, ENDPOINTS[profile.networkId]);
    if (!sameJson(profile, expected)) throw new Error('PUBLIC_TESTNET_PROFILE_INVALID');
  }

  if (PUBLIC_TESTNET_NETWORK_IDS.some((networkId) => !seen.has(networkId))) {
    throw new Error('PUBLIC_TESTNET_PROFILE_SET_INVALID');
  }
}

validatePublicTestnetProfiles(PUBLIC_TESTNET_PROFILES);
