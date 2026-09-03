export const MAINNET_LAUNCH_NETWORK_IDS = Object.freeze([
  'eip155:1',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
] as const);

export type MainnetLaunchNetworkId = (typeof MAINNET_LAUNCH_NETWORK_IDS)[number];

const MAINNET_LAUNCH_NETWORK_ID_SET: ReadonlySet<string> = new Set(MAINNET_LAUNCH_NETWORK_IDS);

/** Exact production network boundary; the broader chain registry remains independent. */
export function isMainnetLaunchNetwork(networkId: string): networkId is MainnetLaunchNetworkId {
  return MAINNET_LAUNCH_NETWORK_ID_SET.has(networkId);
}
