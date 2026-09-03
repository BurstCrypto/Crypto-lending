import {
  isMainnetLaunchNetwork,
  MAINNET_LAUNCH_NETWORK_IDS,
} from './mainnet-launch-network-policy';

describe('mainnet launch network policy', () => {
  it('pins the immutable production boundary to Ethereum and Solana mainnet', () => {
    expect(MAINNET_LAUNCH_NETWORK_IDS).toEqual([
      'eip155:1',
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    ]);
    expect(Object.isFrozen(MAINNET_LAUNCH_NETWORK_IDS)).toBe(true);
  });

  it.each(['eip155:8453', 'eip155:56', 'eip155:42161'])(
    'rejects non-launch mainnet %s',
    (networkId) => {
      expect(isMainnetLaunchNetwork(networkId)).toBe(false);
    },
  );
});
