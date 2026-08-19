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
    emitSessionDelete() {
      listeners.get('session_delete')?.();
    },
    emitSessionExpire() {
      listeners.get('session_expire')?.();
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

function injectedConnector(input: {
  id: string;
  uid: string;
  name: string;
  type?: string;
}): Connector {
  return {
    id: input.id,
    type: input.type ?? 'injected',
    uid: input.uid,
    name: input.name,
  } as unknown as Connector;
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('EvmPanel WalletConnect guard', () => {
  it('records QR display and pairing expiry without retaining the pairing URI', () => {
    vi.useFakeTimers();
    const connector = walletConnectConnector(walletConnectProvider());
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
    hooks.disconnect.mockReturnValue({
      isPending: false,
      disconnectAsync: vi.fn(async () => undefined),
    });
    hooks.reconnect.mockReturnValue({ isPending: false, reconnectAsync: vi.fn() });
    const unsubscribe = vi.fn();
    const qrRuntime = {
      ...runtime,
      subscribeWalletConnectDisplayUri: (listener: (uri: string) => void) => {
        listener('wc:private-pairing-uri');
        return { available: true as const, unsubscribe };
      },
    } as EvmRuntime;
    const onEvidence = vi.fn();

    render(<EvmPanel runtime={qrRuntime} onEvidence={onEvidence} />);

    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'qr-display', outcome: 'accepted' }),
    );
    expect(JSON.stringify(onEvidence.mock.calls)).not.toContain('private-pairing-uri');

    act(() => vi.advanceTimersByTime(5 * 60_000));

    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'pairing-expire', outcome: 'cleared' }),
    );
  });

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
    expect(provider.on).toHaveBeenCalledTimes(3);
    expect(provider.on).toHaveBeenCalledWith('session_update', expect.any(Function));
    expect(provider.on).toHaveBeenCalledWith('session_delete', expect.any(Function));
    expect(provider.on).toHaveBeenCalledWith('session_expire', expect.any(Function));
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

  it.each([
    ['remote deletion', 'session-delete', 'emitSessionDelete'],
    ['expiry', 'session-expire', 'emitSessionExpire'],
  ] as const)('revokes signing after WalletConnect %s', async (_label, kind, emitter) => {
    const provider = walletConnectProvider();
    const connector = walletConnectConnector(provider);
    const disconnectAsync = vi.fn().mockRejectedValue(new Error('private provider payload'));
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

    act(() => provider[emitter]());

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign and verify proof' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Switch testnet' })).toBeDisabled();
      expect(disconnectAsync).toHaveBeenCalled();
    });
    expect(onEvidence).toHaveBeenCalledWith(expect.objectContaining({ kind, outcome: 'cleared' }));
    expect(screen.queryByText(/private provider payload/u)).not.toBeInTheDocument();
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

describe('EvmPanel approved connector and account boundary', () => {
  it('hides generic and embedded injected providers from the connector selector', async () => {
    const rogue = injectedConnector({ id: 'injected', uid: 'rogue', name: 'Generic provider' });
    const embedded = injectedConnector({
      id: 'com.coinbase.wallet',
      uid: 'embedded',
      name: 'Embedded provider',
    });
    const metamask = injectedConnector({
      id: 'io.metamask',
      uid: 'metamask',
      name: 'MetaMask',
    });
    hooks.connection.mockReturnValue({
      address: undefined,
      chainId: undefined,
      connector: undefined,
      isConnected: false,
      status: 'disconnected',
    });
    hooks.connect.mockReturnValue({
      connectors: [rogue, embedded, metamask],
      isPending: false,
      connectAsync: vi.fn(),
    });
    hooks.disconnect.mockReturnValue({
      isPending: false,
      disconnectAsync: vi.fn(async () => undefined),
    });
    hooks.reconnect.mockReturnValue({ isPending: false, reconnectAsync: vi.fn() });

    render(<EvmPanel runtime={runtime} onEvidence={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('option', { name: 'MetaMask' })).toBeVisible());
    expect(screen.queryByRole('option', { name: 'Generic provider' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Embedded provider' })).not.toBeInTheDocument();
  });

  it('blocks multiple returned EVM accounts instead of trusting the first account', async () => {
    const metamask = injectedConnector({
      id: 'io.metamask',
      uid: 'metamask',
      name: 'MetaMask',
    });
    const disconnectAsync = vi.fn(async () => undefined);
    hooks.connection.mockReturnValue({
      address: undefined,
      chainId: undefined,
      connector: undefined,
      isConnected: false,
      status: 'disconnected',
    });
    hooks.connect.mockReturnValue({
      connectors: [metamask],
      isPending: false,
      connectAsync: vi.fn(async () => ({
        accounts: [address, '0x1111111111111111111111111111111111111111'],
        chainId: EVM_TESTNET_CHAIN_IDS.sepolia,
      })),
    });
    hooks.disconnect.mockReturnValue({ isPending: false, disconnectAsync });
    hooks.reconnect.mockReturnValue({ isPending: false, reconnectAsync: vi.fn() });

    render(<EvmPanel runtime={runtime} onEvidence={vi.fn()} />);
    const connectButton = await screen.findByRole('button', { name: 'Connect' });
    await waitFor(() => expect(connectButton).toBeEnabled());
    fireEvent.click(connectButton);

    await waitFor(() =>
      expect(
        screen.getByText(/authorize exactly one test account instead of relying on account order/u),
      ).toBeVisible(),
    );
    expect(disconnectAsync).toHaveBeenCalledWith({ connector: metamask });
  });

  it('sanitizes a provider rejection during explicit disconnect', async () => {
    const metamask = injectedConnector({
      id: 'io.metamask',
      uid: 'metamask',
      name: 'MetaMask',
    });
    hooks.connection.mockReturnValue({
      address,
      chainId: EVM_TESTNET_CHAIN_IDS.sepolia,
      connector: metamask,
      isConnected: true,
      status: 'connected',
    });
    hooks.connect.mockReturnValue({
      connectors: [metamask],
      isPending: false,
      connectAsync: vi.fn(),
    });
    hooks.disconnect.mockReturnValue({
      isPending: false,
      disconnectAsync: vi.fn().mockRejectedValue(new Error('wc:private-session-topic')),
    });
    hooks.reconnect.mockReturnValue({ isPending: false, reconnectAsync: vi.fn() });

    render(<EvmPanel runtime={runtime} onEvidence={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    await waitFor(() =>
      expect(screen.getByText('The wallet could not complete the request.')).toBeVisible(),
    );
    expect(screen.queryByText(/private-session-topic/u)).not.toBeInTheDocument();
  });
});
