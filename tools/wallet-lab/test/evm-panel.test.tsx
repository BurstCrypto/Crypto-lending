import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connector } from 'wagmi';

const hooks = vi.hoisted(() => ({
  connection: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  reconnect: vi.fn(),
  signMessage: vi.fn(),
  switchChain: vi.fn(),
}));

vi.mock('wagmi', () => ({
  createConfig: vi.fn(),
  http: vi.fn(),
  useConnection: hooks.connection,
  useConnect: hooks.connect,
  useDisconnect: hooks.disconnect,
  useReconnect: hooks.reconnect,
  useSignMessage: hooks.signMessage,
  useSwitchChain: hooks.switchChain,
}));

import { EvmPanel } from '../src/app';
import { EVM_TESTNET_CHAIN_IDS, type EvmRuntime } from '../src/evm';

const address = '0xaabbccddeeff0011223344556677889900aabbcc';

function walletConnectProvider(methods = ['personal_sign', 'wallet_switchEthereumChain']) {
  const listeners = new Map<string, () => void>();
  return {
    isWalletConnect: true,
    namespace: 'eip155',
    session: {
      namespaces: {
        eip155: {
          methods,
          events: ['accountsChanged', 'chainChanged'],
          chains: ['eip155:11155111'],
          accounts: [`eip155:11155111:${address}`],
        },
      },
    },
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
    }),
    off: vi.fn((event: string) => listeners.delete(event)),
    emitSessionUpdate() {
      listeners.get('session_update')?.();
    },
  };
}

function walletConnectConnector(provider: ReturnType<typeof walletConnectProvider>) {
  return {
    id: 'walletConnect',
    type: 'walletConnect',
    uid: 'walletconnect-test',
    name: 'WalletConnect',
    getProvider: vi.fn(async () => provider),
  } as unknown as Connector & { getProvider: ReturnType<typeof vi.fn> };
}

const runtime = {
  connectorAvailability: { walletConnect: { enabled: true } },
  subscribeWalletConnectDisplayUri: () => ({
    available: false,
    reason: 'connector-not-found',
  }),
} as unknown as EvmRuntime;

beforeEach(() => {
  vi.clearAllMocks();
  hooks.signMessage.mockReturnValue({ isPending: false, signMessageAsync: vi.fn() });
  hooks.switchChain.mockReturnValue({ isPending: false, switchChainAsync: vi.fn() });
});

afterEach(cleanup);

describe('EvmPanel WalletConnect guard', () => {
  it('deduplicates simultaneous identity and explicit-connect guards to one listener', async () => {
    const provider = walletConnectProvider();
    let releaseProvider: ((value: typeof provider) => void) | undefined;
    const providerPromise = new Promise<typeof provider>((resolve) => {
      releaseProvider = resolve;
    });
    const connector = walletConnectConnector(provider);
    connector.getProvider = vi.fn(() => providerPromise);
    let releaseConnect:
      | ((value: { accounts: string[]; chainId: typeof EVM_TESTNET_CHAIN_IDS.sepolia }) => void)
      | undefined;
    const connectPromise = new Promise<{
      accounts: string[];
      chainId: typeof EVM_TESTNET_CHAIN_IDS.sepolia;
    }>((resolve) => {
      releaseConnect = resolve;
    });
    hooks.connection.mockReturnValue({
      address: undefined,
      chainId: undefined,
      connector: undefined,
      isConnected: false,
      status: 'disconnected',
    });
    hooks.connect.mockReturnValue({
      connectors: [connector],
      isPending: false,
      connectAsync: vi.fn(() => connectPromise),
    });
    hooks.disconnect.mockReturnValue({
      isPending: false,
      disconnectAsync: vi.fn(async () => undefined),
    });
    hooks.reconnect.mockReturnValue({ isPending: false, reconnectAsync: vi.fn() });

    const view = render(<EvmPanel runtime={runtime} onEvidence={vi.fn()} />);
    const connectButton = await screen.findByRole('button', { name: 'Connect' });
    await waitFor(() => expect(connectButton).toBeEnabled());
    fireEvent.click(connectButton);

    hooks.connection.mockReturnValue({
      address,
      chainId: EVM_TESTNET_CHAIN_IDS.sepolia,
      connector,
      isConnected: true,
      status: 'connected',
    });
    view.rerender(<EvmPanel runtime={runtime} onEvidence={vi.fn()} />);
    await waitFor(() => expect(connector.getProvider).toHaveBeenCalledTimes(1));

    await act(async () => {
      releaseConnect?.({ accounts: [address], chainId: EVM_TESTNET_CHAIN_IDS.sepolia });
      await Promise.resolve();
    });
    releaseProvider?.(provider);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign and verify proof' })).toBeEnabled(),
    );
    expect(connector.getProvider).toHaveBeenCalledTimes(1);
    expect(provider.on).toHaveBeenCalledTimes(1);
  });

  it('blocks an expansion delivered while the initial session listener is installed', async () => {
    const provider = walletConnectProvider();
    provider.on.mockImplementation((_event: string, listener: () => void) => {
      provider.session.namespaces.eip155.methods.push('eth_sendTransaction');
      listener();
    });
    const connector = walletConnectConnector(provider);
    const disconnectAsync = vi.fn().mockRejectedValue(new Error('wallet refused'));
    hooks.connection.mockReturnValue({
      address,
      chainId: EVM_TESTNET_CHAIN_IDS.sepolia,
      connector,
      isConnected: true,
      status: 'connected',
    });
    hooks.connect.mockReturnValue({
      connectors: [connector],
      isPending: false,
      connectAsync: vi.fn(),
    });
    hooks.disconnect.mockReturnValue({ isPending: false, disconnectAsync });
    hooks.reconnect.mockReturnValue({ isPending: false, reconnectAsync: vi.fn() });

    render(<EvmPanel runtime={runtime} onEvidence={vi.fn()} />);

    await waitFor(() => expect(disconnectAsync).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Sign and verify proof' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Switch testnet' })).toBeDisabled();
    expect(provider.off).toHaveBeenCalled();
  });

  it('blocks proof and switch after a session update expands methods, even if disconnect fails', async () => {
    const provider = walletConnectProvider();
    provider.off.mockImplementation(() => {
      throw new Error('provider removal failed');
    });
    const connector = walletConnectConnector(provider);
    const disconnectAsync = vi.fn().mockRejectedValue(new Error('wallet refused'));
    hooks.connection.mockReturnValue({
      address,
      chainId: EVM_TESTNET_CHAIN_IDS.sepolia,
      connector,
      isConnected: true,
      status: 'connected',
    });
    hooks.connect.mockReturnValue({
      connectors: [connector],
      isPending: false,
      connectAsync: vi.fn(),
    });
    hooks.disconnect.mockReturnValue({ isPending: false, disconnectAsync });
    hooks.reconnect.mockReturnValue({ isPending: false, reconnectAsync: vi.fn() });
    const onEvidence = vi.fn();

    render(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign and verify proof' })).toBeEnabled(),
    );

    provider.session.namespaces.eip155.methods.push('eth_sendTransaction');
    provider.emitSessionUpdate();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign and verify proof' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Switch testnet' })).toBeDisabled();
      expect(disconnectAsync).toHaveBeenCalled();
    });
    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'session-update', outcome: 'blocked' }),
    );
  });

  it('re-inspects a restored session and remains blocked when disconnect fails', async () => {
    const provider = walletConnectProvider(['personal_sign', 'eth_sendTransaction']);
    const connector = walletConnectConnector(provider);
    const disconnectAsync = vi.fn().mockRejectedValue(new Error('wallet refused'));
    hooks.connection.mockReturnValue({
      address: undefined,
      chainId: undefined,
      connector: undefined,
      isConnected: false,
      status: 'disconnected',
    });
    hooks.connect.mockReturnValue({
      connectors: [connector],
      isPending: false,
      connectAsync: vi.fn(),
    });
    hooks.disconnect.mockReturnValue({ isPending: false, disconnectAsync });
    hooks.reconnect.mockReturnValue({
      isPending: false,
      reconnectAsync: vi.fn(async () => [
        { connector, chainId: EVM_TESTNET_CHAIN_IDS.sepolia, accounts: [address] },
      ]),
    });
    const onEvidence = vi.fn();

    render(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);
    const restore = await screen.findByRole('button', { name: 'Restore selected' });
    await waitFor(() => expect(restore).toBeEnabled());
    fireEvent.click(restore);

    await waitFor(() => expect(disconnectAsync).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Sign and verify proof' })).toBeDisabled();
    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'restore', outcome: 'blocked' }),
    );
  });
});
