import { describe, expect, it } from 'vitest';

import {
  WALLET_LAB_CONNECTORS,
  WALLET_LAB_NETWORKS,
  connectorSupportsNetwork,
  isWalletLabNetworkId,
} from '../lib/wallets/lab/config';

describe('wallet lab configuration', () => {
  it('contains only the approved test networks and connector slots', () => {
    expect(WALLET_LAB_NETWORKS.map(({ id }) => id)).toEqual([
      'eip155:11155111',
      'eip155:84532',
      'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    ]);
    expect(WALLET_LAB_CONNECTORS.map(({ id }) => id)).toEqual([
      'metamask',
      'phantom',
      'coinbase',
      'walletconnect',
    ]);
    expect(WALLET_LAB_CONNECTORS.every(({ mode }) => mode === 'mock-only')).toBe(true);
    expect(WALLET_LAB_CONNECTORS.every(({ telemetry }) => telemetry === 'disabled')).toBe(true);
    expect(isWalletLabNetworkId('eip155:1')).toBe(false);
  });

  it('blocks namespace-incompatible connector and network pairs', () => {
    expect(connectorSupportsNetwork('metamask', 'eip155:11155111')).toBe(true);
    expect(connectorSupportsNetwork('phantom', 'eip155:11155111')).toBe(false);
    expect(connectorSupportsNetwork('phantom', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1')).toBe(
      true,
    );
  });
});
