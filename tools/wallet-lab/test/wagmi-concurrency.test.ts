import {
  connect,
  createConfig,
  disconnect,
  getConnections,
  mock,
  reconnect,
  signMessage,
  switchChain,
} from '@wagmi/core';
import { http, numberToHex, type Hex } from 'viem';
import { baseSepolia, sepolia } from 'viem/chains';
import { describe, expect, it, vi } from 'vitest';

const METAMASK_ADDRESS = '0x1111111111111111111111111111111111111111';
const COINBASE_ADDRESS = '0x2222222222222222222222222222222222222222';

function createHarness() {
  const config = createConfig({
    chains: [sepolia, baseSepolia],
    connectors: [
      mock({ accounts: [METAMASK_ADDRESS], features: { reconnect: true } }),
      mock({ accounts: [COINBASE_ADDRESS], features: { reconnect: true } }),
    ],
    multiInjectedProviderDiscovery: false,
    ssr: true,
    storage: null,
    transports: {
      [sepolia.id]: http(),
      [baseSepolia.id]: http(),
    },
  });

  const [metaMaskConnector, coinbaseConnector] = config.connectors;
  return {
    coinbaseConnector,
    config,
    metaMaskConnector,
  };
}

describe('Wagmi concurrent connection registry', () => {
  it('preserves two connector UID rows and scopes actions to the explicit connector', async () => {
    const { coinbaseConnector, config, metaMaskConnector } = createHarness();

    await connect(config, { connector: metaMaskConnector });
    await connect(config, { connector: coinbaseConnector });

    expect(metaMaskConnector.uid).not.toBe(coinbaseConnector.uid);
    expect([...config.state.connections.keys()]).toEqual([
      metaMaskConnector.uid,
      coinbaseConnector.uid,
    ]);
    expect(getConnections(config).map((connection) => connection.connector.uid)).toEqual([
      metaMaskConnector.uid,
      coinbaseConnector.uid,
    ]);
    expect(config.state.current).toBe(coinbaseConnector.uid);

    // MetaMask is not Wagmi's current connector, so these calls only work on
    // the intended session when the connector is supplied explicitly.
    const metaMaskSwitch = vi.spyOn(metaMaskConnector, 'switchChain');
    const coinbaseSwitch = vi.spyOn(coinbaseConnector, 'switchChain');
    await switchChain(config, {
      chainId: baseSepolia.id,
      connector: metaMaskConnector,
    });

    const requestedMethods: string[] = [];
    const expectedSignature = `0x${'11'.repeat(65)}` as Hex;
    const metaMaskProvider = {
      async request({ method }: { method: string }) {
        requestedMethods.push(method);
        if (method === 'eth_accounts') return [METAMASK_ADDRESS];
        if (method === 'eth_chainId') return numberToHex(baseSepolia.id);
        if (method === 'personal_sign') return expectedSignature;
        throw new Error(`Unexpected fake-provider request: ${method}`);
      },
    };
    vi.spyOn(metaMaskConnector, 'getProvider').mockResolvedValue(metaMaskProvider as never);
    const coinbaseProvider = vi.spyOn(coinbaseConnector, 'getProvider');
    const signedMessage = await signMessage(config, {
      account: METAMASK_ADDRESS,
      connector: metaMaskConnector,
      message: 'KAN-55 concurrent-session routing',
    });

    expect(signedMessage).toBe(expectedSignature);
    expect(metaMaskSwitch).toHaveBeenCalledWith({
      addEthereumChainParameter: undefined,
      chainId: baseSepolia.id,
    });
    expect(coinbaseSwitch).not.toHaveBeenCalled();
    expect(requestedMethods).toContain('personal_sign');
    expect(coinbaseProvider).not.toHaveBeenCalled();
    expect(config.state.connections.get(metaMaskConnector.uid)?.chainId).toBe(baseSepolia.id);
    expect(config.state.connections.get(coinbaseConnector.uid)?.chainId).toBe(sepolia.id);

    const metaMaskDisconnect = vi.spyOn(metaMaskConnector, 'disconnect');
    const coinbaseDisconnect = vi.spyOn(coinbaseConnector, 'disconnect');
    await disconnect(config, { connector: metaMaskConnector });

    expect(metaMaskDisconnect).toHaveBeenCalledOnce();
    expect(coinbaseDisconnect).not.toHaveBeenCalled();
    expect([...config.state.connections.keys()]).toEqual([coinbaseConnector.uid]);
    expect(config.state.connections.get(coinbaseConnector.uid)?.accounts).toEqual([
      COINBASE_ADDRESS,
    ]);
    expect(config.state.current).toBe(coinbaseConnector.uid);
    expect(config.state.status).toBe('connected');
  });

  it('restores all sessions in one reconnect call because reconnect replaces the registry', async () => {
    const { coinbaseConnector, config, metaMaskConnector } = createHarness();

    await connect(config, { connector: metaMaskConnector });
    await connect(config, { connector: coinbaseConnector });

    await reconnect(config, {
      connectors: [metaMaskConnector, coinbaseConnector],
    });
    expect([...config.state.connections.keys()]).toEqual([
      metaMaskConnector.uid,
      coinbaseConnector.uid,
    ]);

    // Wagmi reconstructs the registry from the connectors supplied to each
    // reconnect invocation. Restoring one connector at a time would therefore
    // discard peers restored by an earlier invocation.
    await reconnect(config, { connectors: [metaMaskConnector] });
    expect([...config.state.connections.keys()]).toEqual([metaMaskConnector.uid]);
    expect(config.state.connections.has(coinbaseConnector.uid)).toBe(false);
  });
});
