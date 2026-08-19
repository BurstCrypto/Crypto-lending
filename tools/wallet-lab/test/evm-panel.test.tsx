import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, Connector } from 'wagmi';

const hooks = vi.hoisted(() => ({
  connections: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  reconnect: vi.fn(),
  signMessage: vi.fn(),
  switchChain: vi.fn(),
}));

const verify = vi.hoisted(() => vi.fn());

vi.mock('wagmi', () => ({
  createConfig: vi.fn(),
  http: vi.fn(),
  useConnections: hooks.connections,
  useConnect: hooks.connect,
  useDisconnect: hooks.disconnect,
  useReconnect: hooks.reconnect,
  useSignMessage: hooks.signMessage,
  useSwitchChain: hooks.switchChain,
}));

vi.mock('viem', () => ({ verifyMessage: verify }));

import { EvmPanel } from '../src/evm-panel';
import { EVM_TESTNET_CHAIN_IDS, type EvmRuntime } from '../src/evm';

const metamaskAddress = '0xaabbccddeeff0011223344556677889900aabbcc';
const coinbaseAddress = '0x1111111111111111111111111111111111111111';
const changedAddress = '0x2222222222222222222222222222222222222222';
const signature = `0x${'ab'.repeat(65)}`;

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
          accounts: [`eip155:11155111:${metamaskAddress}`],
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

function metamaskConnector(): Connector {
  return injectedConnector({ id: 'io.metamask', uid: 'metamask', name: 'MetaMask' });
}

function coinbaseConnector(): Connector {
  return injectedConnector({
    id: 'coinbaseWalletSDK',
    uid: 'coinbase',
    name: 'Coinbase Wallet',
    type: 'coinbaseWallet',
  });
}

function activeConnection(
  connector: Connector,
  account: string,
  chainId: number = EVM_TESTNET_CHAIN_IDS.sepolia,
): Connection {
  return { accounts: [account], chainId, connector } as Connection;
}

const runtime = {
  connectorAvailability: { walletConnect: { enabled: true } },
  subscribeWalletConnectDisplayUri: () => ({
    available: false,
    reason: 'connector-not-found',
  }),
} as unknown as EvmRuntime;

async function renderAuthorizedConnections(input: {
  connections: readonly Connection[];
  connectors?: readonly Connector[];
  onEvidence?: ComponentProps<typeof EvmPanel>['onEvidence'];
  panelRuntime?: EvmRuntime;
}) {
  const connectors =
    input.connectors ?? input.connections.map((connection) => connection.connector);
  const onEvidence = input.onEvidence ?? vi.fn<ComponentProps<typeof EvmPanel>['onEvidence']>();
  const panelRuntime = input.panelRuntime ?? runtime;
  const reconnectAsync = vi.fn(async () => [...input.connections]);
  hooks.connections.mockReturnValue([]);
  hooks.connect.mockReturnValue({ connectors, isPending: false, connectAsync: vi.fn() });
  hooks.reconnect.mockReturnValue({ isPending: false, reconnectAsync });

  const view = render(<EvmPanel runtime={panelRuntime} onEvidence={onEvidence} />);
  fireEvent.click(screen.getByRole('button', { name: 'Restore approved sessions' }));
  await waitFor(() => expect(reconnectAsync).toHaveBeenCalledWith({ connectors }));
  for (const connection of input.connections) {
    await waitFor(() =>
      expect(onEvidence).toHaveBeenCalledWith(
        expect.objectContaining({
          connectorId:
            connection.connector.id === 'walletConnect'
              ? 'walletconnect'
              : connection.connector.id === 'coinbaseWalletSDK'
                ? 'coinbase'
                : 'metamask',
          kind: 'restore',
          outcome: 'accepted',
        }),
      ),
    );
  }

  hooks.connections.mockReturnValue([...input.connections]);
  view.rerender(<EvmPanel runtime={panelRuntime} onEvidence={onEvidence} />);
  await waitFor(() =>
    expect(screen.getByText(/Active locally authorized sessions:/u)).toHaveTextContent(
      String(input.connections.length),
    ),
  );
  return { onEvidence, reconnectAsync, view };
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.connections.mockReturnValue([]);
  hooks.connect.mockReturnValue({ connectors: [], isPending: false, connectAsync: vi.fn() });
  hooks.disconnect.mockReturnValue({
    isPending: false,
    disconnectAsync: vi.fn(async () => undefined),
  });
  hooks.reconnect.mockReturnValue({
    isPending: false,
    reconnectAsync: vi.fn(async () => []),
  });
  hooks.signMessage.mockReturnValue({
    isPending: false,
    signMessageAsync: vi.fn(async () => signature),
  });
  hooks.switchChain.mockReturnValue({
    isPending: false,
    switchChainAsync: vi.fn(async () => undefined),
  });
  verify.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('EvmPanel WalletConnect lifecycle isolation', () => {
  it('records QR display and expiry without exporting the pairing URI', () => {
    vi.useFakeTimers();
    const connector = walletConnectConnector(walletConnectProvider());
    hooks.connect.mockReturnValue({
      connectors: [connector],
      isPending: false,
      connectAsync: vi.fn(),
    });
    const qrRuntime = {
      ...runtime,
      subscribeWalletConnectDisplayUri: (listener: (uri: string) => void) => {
        listener('wc:private-pairing-uri');
        return { available: true as const, unsubscribe: vi.fn() };
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

  it('subscribes to all lifecycle events and enables proof only after scope inspection', async () => {
    const provider = walletConnectProvider();
    const connector = walletConnectConnector(provider);
    await renderAuthorizedConnections({
      connections: [activeConnection(connector, metamaskAddress)],
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign selected proof' })).toBeEnabled(),
    );
    expect(connector.getProvider).toHaveBeenCalled();
    expect(provider.on).toHaveBeenCalledWith('session_update', expect.any(Function));
    expect(provider.on).toHaveBeenCalledWith('session_delete', expect.any(Function));
    expect(provider.on).toHaveBeenCalledWith('session_expire', expect.any(Function));
  });

  it('blocks a scope expansion even when provider cleanup and disconnect fail', async () => {
    const provider = walletConnectProvider();
    provider.off.mockImplementation(() => {
      throw new Error('provider cleanup failed');
    });
    const connector = walletConnectConnector(provider);
    const disconnectAsync = vi.fn().mockRejectedValue(new Error('private provider payload'));
    hooks.disconnect.mockReturnValue({ isPending: false, disconnectAsync });
    const onEvidence = vi.fn();

    await renderAuthorizedConnections({
      connections: [activeConnection(connector, metamaskAddress)],
      onEvidence,
    });
    onEvidence.mockClear();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign selected proof' })).toBeEnabled(),
    );

    provider.session.namespaces.eip155.methods.push('eth_sendTransaction');
    act(() => provider.emitSessionUpdate());

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign selected proof' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Switch selected testnet' })).toBeDisabled();
      expect(disconnectAsync).toHaveBeenCalledWith({ connector });
    });
    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorId: 'walletconnect',
        kind: 'session-update',
        outcome: 'blocked',
      }),
    );
    expect(screen.queryByText(/private provider payload/u)).not.toBeInTheDocument();
  });

  it('revokes a pending WalletConnect proof before a failed quarantine disconnect settles', async () => {
    const provider = walletConnectProvider();
    const connector = walletConnectConnector(provider);
    const disconnectAsync = vi.fn().mockRejectedValue(new Error('private provider payload'));
    let releaseSignature: ((value: string) => void) | undefined;
    const signaturePromise = new Promise<string>((resolve) => {
      releaseSignature = resolve;
    });
    const signMessageAsync = vi.fn(() => signaturePromise);
    hooks.disconnect.mockReturnValue({ isPending: false, disconnectAsync });
    hooks.signMessage.mockReturnValue({ isPending: false, signMessageAsync });
    const onEvidence = vi.fn();
    await renderAuthorizedConnections({
      connections: [activeConnection(connector, metamaskAddress)],
      onEvidence,
    });
    onEvidence.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Sign selected proof' }));
    await waitFor(() => expect(signMessageAsync).toHaveBeenCalledTimes(1));

    provider.session.namespaces.eip155.methods.push('eth_sendTransaction');
    act(() => provider.emitSessionUpdate());
    await waitFor(() => expect(disconnectAsync).toHaveBeenCalledWith({ connector }));

    await act(async () => {
      releaseSignature?.(signature);
      await signaturePromise;
    });

    await waitFor(() => expect(screen.getByText(/stale proof was discarded/u)).toBeVisible());
    expect(verify).not.toHaveBeenCalled();
    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorId: 'walletconnect',
        kind: 'ownership-proof',
        outcome: 'blocked',
      }),
    );
  });

  it('clears a displayed pairing code when settled WalletConnect scope is blocked', async () => {
    const provider = walletConnectProvider(['personal_sign', 'eth_sendTransaction']);
    const connector = walletConnectConnector(provider);
    let releaseConnect: ((value: { accounts: string[]; chainId: number }) => void) | undefined;
    const connectPromise = new Promise<{ accounts: string[]; chainId: number }>((resolve) => {
      releaseConnect = resolve;
    });
    let displayUri: ((uri: string) => void) | undefined;
    hooks.connect.mockReturnValue({
      connectors: [connector],
      isPending: false,
      connectAsync: vi.fn(() => connectPromise),
    });
    const qrRuntime = {
      ...runtime,
      subscribeWalletConnectDisplayUri: (listener: (uri: string) => void) => {
        displayUri = listener;
        return { available: true as const, unsubscribe: vi.fn() };
      },
    } as EvmRuntime;

    render(<EvmPanel runtime={qrRuntime} onEvidence={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect selected' }));
    act(() => displayUri?.('wc:private-pairing-uri'));
    expect(screen.getByLabelText('WalletConnect pairing QR code')).toBeVisible();

    await act(async () => {
      releaseConnect?.({
        accounts: [metamaskAddress],
        chainId: EVM_TESTNET_CHAIN_IDS.sepolia,
      });
      await connectPromise;
    });

    await waitFor(() =>
      expect(screen.queryByLabelText('WalletConnect pairing QR code')).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/session scope was blocked/u)).toBeVisible();
  });

  it.each([
    ['remote deletion', 'session-delete', 'emitSessionDelete'],
    ['expiry', 'session-expire', 'emitSessionExpire'],
  ] as const)('revokes only WalletConnect after %s', async (_label, kind, emitter) => {
    const provider = walletConnectProvider();
    const walletConnect = walletConnectConnector(provider);
    const metamask = metamaskConnector();
    const disconnectAsync = vi.fn().mockRejectedValue(new Error('private provider payload'));
    const active = [
      activeConnection(walletConnect, metamaskAddress),
      activeConnection(metamask, coinbaseAddress),
    ];
    hooks.disconnect.mockReturnValue({ isPending: false, disconnectAsync });
    const onEvidence = vi.fn();

    await renderAuthorizedConnections({
      connections: active,
      connectors: [walletConnect, metamask],
      onEvidence,
    });
    onEvidence.mockClear();
    await waitFor(() => expect(provider.on).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Wallet connector'), {
      target: { value: metamask.uid },
    });
    expect(screen.getByRole('button', { name: 'Sign selected proof' })).toBeEnabled();

    act(() => provider[emitter]());

    await waitFor(() => expect(disconnectAsync).toHaveBeenCalledWith({ connector: walletConnect }));
    expect(disconnectAsync).not.toHaveBeenCalledWith({ connector: metamask });
    expect(screen.getByRole('button', { name: 'Sign selected proof' })).toBeEnabled();
    expect(onEvidence).toHaveBeenCalledWith(expect.objectContaining({ kind, outcome: 'cleared' }));
  });

  it('does not remove WalletConnect listeners when another wallet is selected', async () => {
    const provider = walletConnectProvider();
    const walletConnect = walletConnectConnector(provider);
    const metamask = metamaskConnector();
    await renderAuthorizedConnections({
      connections: [
        activeConnection(walletConnect, metamaskAddress),
        activeConnection(metamask, coinbaseAddress),
      ],
      connectors: [walletConnect, metamask],
    });
    await waitFor(() => expect(provider.on).toHaveBeenCalled());
    provider.off.mockClear();

    fireEvent.change(screen.getByLabelText('Wallet connector'), {
      target: { value: metamask.uid },
    });

    expect(provider.off).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign selected proof' })).toBeEnabled();
  });

  it('does not clear a pending WalletConnect QR when an injected wallet disconnects', async () => {
    const metamask = metamaskConnector();
    const connectAsync = vi.fn(async () => ({
      accounts: [metamaskAddress],
      chainId: EVM_TESTNET_CHAIN_IDS.sepolia,
    }));
    hooks.connect.mockReturnValue({
      connectors: [metamask],
      isPending: false,
      connectAsync,
    });
    const qrRuntime = {
      ...runtime,
      subscribeWalletConnectDisplayUri: (listener: (uri: string) => void) => {
        listener('wc:private-pairing-uri');
        return { available: true as const, unsubscribe: vi.fn() };
      },
    } as EvmRuntime;

    const onEvidence = vi.fn();
    const view = render(<EvmPanel runtime={qrRuntime} onEvidence={onEvidence} />);
    expect(screen.getByLabelText('WalletConnect pairing QR code')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Connect selected' }));
    await waitFor(() => expect(connectAsync).toHaveBeenCalled());
    hooks.connections.mockReturnValue([activeConnection(metamask, metamaskAddress)]);
    view.rerender(<EvmPanel runtime={qrRuntime} onEvidence={onEvidence} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign selected proof' })).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect selected' }));
    await waitFor(() => expect(screen.getByText(/Vendor pairing state may remain/u)).toBeVisible());

    expect(screen.getByLabelText('WalletConnect pairing QR code')).toBeVisible();
  });
});

describe('EvmPanel concurrent connector registry', () => {
  it('keeps an existing MetaMask session when Coinbase connects', async () => {
    const metamask = metamaskConnector();
    const coinbase = coinbaseConnector();
    const connectAsync = vi.fn(async () => ({
      accounts: [coinbaseAddress],
      chainId: EVM_TESTNET_CHAIN_IDS.sepolia,
    }));
    const disconnectAsync = vi.fn(async () => undefined);
    hooks.disconnect.mockReturnValue({ isPending: false, disconnectAsync });
    const onEvidence = vi.fn();
    const { view } = await renderAuthorizedConnections({
      connections: [activeConnection(metamask, metamaskAddress)],
      connectors: [metamask, coinbase],
      onEvidence,
    });
    hooks.connect.mockReturnValue({
      connectors: [metamask, coinbase],
      isPending: false,
      connectAsync,
    });
    view.rerender(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);

    fireEvent.change(screen.getByLabelText('Wallet connector'), {
      target: { value: coinbase.uid },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect selected' }));

    await waitFor(() =>
      expect(connectAsync).toHaveBeenCalledWith({
        connector: coinbase,
        chainId: EVM_TESTNET_CHAIN_IDS.sepolia,
      }),
    );
    expect(disconnectAsync).not.toHaveBeenCalledWith({ connector: metamask });

    hooks.connections.mockReturnValue([
      activeConnection(metamask, metamaskAddress),
      activeConnection(coinbase, coinbaseAddress),
    ]);
    view.rerender(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);

    expect(screen.getByText(/Active locally authorized sessions:/u)).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: /Use MetaMask/u })).toBeVisible();
    expect(screen.getByRole('button', { name: /Use Coinbase Wallet/u })).toBeVisible();
  });

  it('targets switch, sign, and disconnect to the selected connector', async () => {
    const metamask = metamaskConnector();
    const coinbase = coinbaseConnector();
    const switchChainAsync = vi.fn(async () => undefined);
    const signMessageAsync = vi.fn(async () => signature);
    const disconnectAsync = vi.fn(async () => undefined);
    hooks.switchChain.mockReturnValue({ isPending: false, switchChainAsync });
    hooks.signMessage.mockReturnValue({ isPending: false, signMessageAsync });
    hooks.disconnect.mockReturnValue({ isPending: false, disconnectAsync });

    await renderAuthorizedConnections({
      connections: [
        activeConnection(metamask, metamaskAddress),
        activeConnection(coinbase, coinbaseAddress),
      ],
      connectors: [metamask, coinbase],
    });
    fireEvent.change(screen.getByLabelText('Wallet connector'), {
      target: { value: coinbase.uid },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Switch selected testnet' }));
    await waitFor(() =>
      expect(switchChainAsync).toHaveBeenCalledWith({
        connector: coinbase,
        chainId: EVM_TESTNET_CHAIN_IDS.sepolia,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign selected proof' }));
    await waitFor(() => expect(signMessageAsync).toHaveBeenCalledTimes(1));
    expect(signMessageAsync).toHaveBeenCalledWith(
      expect.objectContaining({ connector: coinbase, account: coinbaseAddress }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect selected' }));
    await waitFor(() => expect(disconnectAsync).toHaveBeenCalledWith({ connector: coinbase }));
    expect(disconnectAsync).not.toHaveBeenCalledWith({ connector: metamask });
  });

  it('discards a switch result when its connector identity changes while awaiting the wallet', async () => {
    const metamask = metamaskConnector();
    let releaseSwitch: (() => void) | undefined;
    const switchPromise = new Promise<void>((resolve) => {
      releaseSwitch = resolve;
    });
    const switchChainAsync = vi.fn(() => switchPromise);
    hooks.switchChain.mockReturnValue({ isPending: false, switchChainAsync });
    const onEvidence = vi.fn();
    const { view } = await renderAuthorizedConnections({
      connections: [activeConnection(metamask, metamaskAddress)],
      connectors: [metamask],
      onEvidence,
    });
    onEvidence.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Switch selected testnet' }));
    await waitFor(() => expect(switchChainAsync).toHaveBeenCalledTimes(1));

    hooks.connections.mockReturnValue([activeConnection(metamask, changedAddress)]);
    view.rerender(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);
    await act(async () => {
      releaseSwitch?.();
      await switchPromise;
    });

    await waitFor(() =>
      expect(screen.getByText(/stale switch result was discarded/u)).toBeVisible(),
    );
    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorId: 'metamask',
        kind: 'chain-change',
        outcome: 'blocked',
      }),
    );
  });

  it('accepts the expected observed chain revision for a pending switch', async () => {
    const metamask = metamaskConnector();
    let releaseSwitch: (() => void) | undefined;
    const switchPromise = new Promise<void>((resolve) => {
      releaseSwitch = resolve;
    });
    const switchChainAsync = vi.fn(() => switchPromise);
    hooks.switchChain.mockReturnValue({ isPending: false, switchChainAsync });
    const onEvidence = vi.fn();
    const { view } = await renderAuthorizedConnections({
      connections: [activeConnection(metamask, metamaskAddress)],
      connectors: [metamask],
      onEvidence,
    });
    onEvidence.mockClear();

    fireEvent.change(screen.getByLabelText('Required testnet for selected wallet'), {
      target: { value: String(EVM_TESTNET_CHAIN_IDS.baseSepolia) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Switch selected testnet' }));
    await waitFor(() => expect(switchChainAsync).toHaveBeenCalledTimes(1));

    hooks.connections.mockReturnValue([
      activeConnection(metamask, metamaskAddress, EVM_TESTNET_CHAIN_IDS.baseSepolia),
    ]);
    view.rerender(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);
    await act(async () => {
      releaseSwitch?.();
      await switchPromise;
    });

    await waitFor(() => expect(screen.getByText(/Switch request approved/u)).toBeVisible());
    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'chain-change', outcome: 'accepted' }),
    );
    expect(onEvidence).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'chain-change', outcome: 'blocked' }),
    );
  });

  it('does not let a later target-chain event mask prior identity revisions', async () => {
    const metamask = metamaskConnector();
    let releaseSwitch: (() => void) | undefined;
    const switchPromise = new Promise<void>((resolve) => {
      releaseSwitch = resolve;
    });
    const switchChainAsync = vi.fn(() => switchPromise);
    hooks.switchChain.mockReturnValue({ isPending: false, switchChainAsync });
    const onEvidence = vi.fn();
    const { view } = await renderAuthorizedConnections({
      connections: [activeConnection(metamask, metamaskAddress)],
      connectors: [metamask],
      onEvidence,
    });
    onEvidence.mockClear();

    fireEvent.change(screen.getByLabelText('Required testnet for selected wallet'), {
      target: { value: String(EVM_TESTNET_CHAIN_IDS.baseSepolia) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Switch selected testnet' }));
    await waitFor(() => expect(switchChainAsync).toHaveBeenCalledTimes(1));

    hooks.connections.mockReturnValue([activeConnection(metamask, changedAddress)]);
    view.rerender(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);
    hooks.connections.mockReturnValue([
      activeConnection(metamask, metamaskAddress, EVM_TESTNET_CHAIN_IDS.baseSepolia),
    ]);
    view.rerender(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);
    await act(async () => {
      releaseSwitch?.();
      await switchPromise;
    });

    await waitFor(() =>
      expect(screen.getByText(/stale switch result was discarded/u)).toBeVisible(),
    );
    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'chain-change', outcome: 'blocked' }),
    );
  });

  it('classifies only sanitized user rejection as a rejected switch', async () => {
    const metamask = metamaskConnector();
    const failedSwitch = vi.fn().mockRejectedValue(new Error('private provider payload'));
    hooks.switchChain.mockReturnValue({ isPending: false, switchChainAsync: failedSwitch });
    const onEvidence = vi.fn();
    const { view } = await renderAuthorizedConnections({
      connections: [activeConnection(metamask, metamaskAddress)],
      connectors: [metamask],
      onEvidence,
    });
    onEvidence.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Switch selected testnet' }));
    await waitFor(() =>
      expect(onEvidence).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'chain-change', outcome: 'blocked' }),
      ),
    );
    expect(screen.queryByText(/private provider payload/u)).not.toBeInTheDocument();

    onEvidence.mockClear();
    const rejectedSwitch = vi.fn().mockRejectedValue({ code: 4001 });
    hooks.switchChain.mockReturnValue({ isPending: false, switchChainAsync: rejectedSwitch });
    view.rerender(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch selected testnet' }));
    await waitFor(() =>
      expect(onEvidence).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'chain-change', outcome: 'rejected' }),
      ),
    );
  });

  it('attributes an account change only to the connector that changed', async () => {
    const metamask = metamaskConnector();
    const coinbase = coinbaseConnector();
    const first = activeConnection(metamask, metamaskAddress);
    const peer = activeConnection(coinbase, coinbaseAddress);
    const onEvidence = vi.fn();
    const { view } = await renderAuthorizedConnections({
      connections: [first, peer],
      connectors: [metamask, coinbase],
      onEvidence,
    });
    onEvidence.mockClear();

    hooks.connections.mockReturnValue([activeConnection(metamask, changedAddress), peer]);
    view.rerender(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);

    await waitFor(() =>
      expect(onEvidence).toHaveBeenCalledWith(
        expect.objectContaining({
          connectorId: 'metamask',
          kind: 'account-change',
          outcome: 'accepted',
        }),
      ),
    );
    expect(onEvidence).not.toHaveBeenCalledWith(
      expect.objectContaining({ connectorId: 'coinbase', kind: 'account-change' }),
    );
    expect(screen.getByText(/Active locally authorized sessions:/u)).toHaveTextContent('2');
  });

  it('quarantines only the live connection that expands to multiple accounts', async () => {
    const metamask = metamaskConnector();
    const coinbase = coinbaseConnector();
    const metamaskSession = activeConnection(metamask, metamaskAddress);
    const disconnectAsync = vi.fn(async () => undefined);
    hooks.disconnect.mockReturnValue({ isPending: false, disconnectAsync });
    const onEvidence = vi.fn();
    const { view } = await renderAuthorizedConnections({
      connections: [metamaskSession, activeConnection(coinbase, coinbaseAddress)],
      connectors: [metamask, coinbase],
      onEvidence,
    });
    disconnectAsync.mockClear();
    onEvidence.mockClear();

    hooks.connections.mockReturnValue([
      metamaskSession,
      {
        accounts: [coinbaseAddress, changedAddress],
        chainId: EVM_TESTNET_CHAIN_IDS.sepolia,
        connector: coinbase,
      } as Connection,
    ]);
    view.rerender(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);

    await waitFor(() => expect(disconnectAsync).toHaveBeenCalledWith({ connector: coinbase }));
    expect(disconnectAsync).not.toHaveBeenCalledWith({ connector: metamask });
    expect(screen.getByRole('button', { name: 'Sign selected proof' })).toBeEnabled();
    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorId: 'coinbase',
        kind: 'account-change',
        outcome: 'blocked',
      }),
    );
    expect(screen.getByText(/Active locally authorized sessions:/u)).toHaveTextContent('1');
  });

  it('excludes an authorized connector after it moves to an unsupported chain', async () => {
    const metamask = metamaskConnector();
    const coinbase = coinbaseConnector();
    const metamaskSession = activeConnection(metamask, metamaskAddress);
    const coinbaseSession = activeConnection(coinbase, coinbaseAddress);
    const onEvidence = vi.fn();
    const { view } = await renderAuthorizedConnections({
      connections: [metamaskSession, coinbaseSession],
      connectors: [metamask, coinbase],
      onEvidence,
    });
    onEvidence.mockClear();

    hooks.connections.mockReturnValue([
      metamaskSession,
      activeConnection(coinbase, coinbaseAddress, 1),
    ]);
    view.rerender(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);

    await waitFor(() =>
      expect(screen.getByText(/Active locally authorized sessions:/u)).toHaveTextContent('1'),
    );
    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorId: 'coinbase',
        kind: 'chain-change',
        outcome: 'blocked',
      }),
    );
  });

  it('disables duplicate connect and restore while any connector is active', () => {
    const metamask = metamaskConnector();
    const coinbase = coinbaseConnector();
    hooks.connections.mockReturnValue([
      activeConnection(metamask, metamaskAddress),
      activeConnection(coinbase, coinbaseAddress),
    ]);
    hooks.connect.mockReturnValue({
      connectors: [metamask, coinbase],
      isPending: false,
      connectAsync: vi.fn(),
    });

    render(<EvmPanel runtime={runtime} onEvidence={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Connect selected' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Restore approved sessions' })).toBeDisabled();
  });

  it('restores all approved connectors in one registry-safe operation', async () => {
    const metamask = metamaskConnector();
    const coinbase = coinbaseConnector();
    const reconnectAsync = vi.fn(async () => [
      activeConnection(metamask, metamaskAddress),
      activeConnection(coinbase, coinbaseAddress),
    ]);
    hooks.connect.mockReturnValue({
      connectors: [metamask, coinbase],
      isPending: false,
      connectAsync: vi.fn(),
    });
    hooks.reconnect.mockReturnValue({ isPending: false, reconnectAsync });
    const onEvidence = vi.fn();

    render(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore approved sessions' }));

    await waitFor(() =>
      expect(reconnectAsync).toHaveBeenCalledWith({ connectors: [metamask, coinbase] }),
    );
    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ connectorId: 'metamask', kind: 'restore', outcome: 'accepted' }),
    );
    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ connectorId: 'coinbase', kind: 'restore', outcome: 'accepted' }),
    );
  });

  it('reports an absent connector as cleared during bulk restore', async () => {
    const metamask = metamaskConnector();
    const coinbase = coinbaseConnector();
    const reconnectAsync = vi.fn(async () => [activeConnection(metamask, metamaskAddress)]);
    hooks.connect.mockReturnValue({
      connectors: [metamask, coinbase],
      isPending: false,
      connectAsync: vi.fn(),
    });
    hooks.reconnect.mockReturnValue({ isPending: false, reconnectAsync });
    const onEvidence = vi.fn();

    render(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore approved sessions' }));

    await waitFor(() =>
      expect(onEvidence).toHaveBeenCalledWith(
        expect.objectContaining({ connectorId: 'coinbase', kind: 'restore', outcome: 'cleared' }),
      ),
    );
    expect(onEvidence).not.toHaveBeenCalledWith(
      expect.objectContaining({ connectorId: 'coinbase', kind: 'restore', outcome: 'blocked' }),
    );
  });

  it('keeps restore busy through WalletConnect inspection and rejects a changed latest identity', async () => {
    const provider = walletConnectProvider();
    const connector = walletConnectConnector(provider);
    let releaseProvider: ((value: typeof provider) => void) | undefined;
    const providerPromise = new Promise<typeof provider>((resolve) => {
      releaseProvider = resolve;
    });
    connector.getProvider = vi.fn(() => providerPromise);
    const restored = activeConnection(connector, metamaskAddress);
    const connectionMap = new Map<string, Connection>([[connector.uid, restored]]);
    const configuredRuntime = {
      ...runtime,
      providerProps: { config: { state: { connections: connectionMap } } },
    } as unknown as EvmRuntime;
    const reconnectAsync = vi.fn(async () => [restored]);
    const disconnectAsync = vi.fn(async () => undefined);
    hooks.connect.mockReturnValue({
      connectors: [connector],
      isPending: false,
      connectAsync: vi.fn(),
    });
    hooks.reconnect.mockReturnValue({ isPending: false, reconnectAsync });
    hooks.disconnect.mockReturnValue({ isPending: false, disconnectAsync });
    const onEvidence = vi.fn();

    render(<EvmPanel runtime={configuredRuntime} onEvidence={onEvidence} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore approved sessions' }));
    await waitFor(() => expect(connector.getProvider).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Restore approved sessions' })).toBeDisabled();
    expect(screen.getByLabelText('Wallet connector')).toBeDisabled();

    connectionMap.set(connector.uid, activeConnection(connector, changedAddress));
    await act(async () => {
      releaseProvider?.(provider);
      await providerPromise;
    });

    await waitFor(() =>
      expect(onEvidence).toHaveBeenCalledWith(
        expect.objectContaining({
          connectorId: 'walletconnect',
          kind: 'restore',
          outcome: 'blocked',
        }),
      ),
    );
    expect(disconnectAsync).toHaveBeenCalledWith({ connector });
    expect(onEvidence).not.toHaveBeenCalledWith(
      expect.objectContaining({
        connectorId: 'walletconnect',
        kind: 'restore',
        outcome: 'accepted',
      }),
    );
  });

  it('discards an in-flight proof when only its wallet identity changes', async () => {
    const metamask = metamaskConnector();
    const coinbase = coinbaseConnector();
    let releaseSignature: ((value: string) => void) | undefined;
    const signaturePromise = new Promise<string>((resolve) => {
      releaseSignature = resolve;
    });
    const signMessageAsync = vi.fn(() => signaturePromise);
    const peer = activeConnection(coinbase, coinbaseAddress);
    hooks.signMessage.mockReturnValue({ isPending: false, signMessageAsync });
    const onEvidence = vi.fn();
    const { view } = await renderAuthorizedConnections({
      connections: [activeConnection(metamask, metamaskAddress), peer],
      connectors: [metamask, coinbase],
      onEvidence,
    });
    onEvidence.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Sign selected proof' }));
    await waitFor(() => expect(signMessageAsync).toHaveBeenCalledTimes(1));

    hooks.connections.mockReturnValue([activeConnection(metamask, changedAddress), peer]);
    view.rerender(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);
    await act(async () => {
      releaseSignature?.(signature);
      await signaturePromise;
    });

    await waitFor(() => expect(screen.getByText(/stale proof was discarded/u)).toBeVisible());
    expect(verify).not.toHaveBeenCalled();
    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorId: 'metamask',
        kind: 'ownership-proof',
        outcome: 'blocked',
      }),
    );
    expect(screen.getByText(/Active locally authorized sessions:/u)).toHaveTextContent('2');
  });

  it('reports a revoked pending signature error as stale instead of user rejection', async () => {
    const metamask = metamaskConnector();
    let rejectSignature: ((reason?: unknown) => void) | undefined;
    const signaturePromise = new Promise<string>((_resolve, reject) => {
      rejectSignature = reject;
    });
    const signMessageAsync = vi.fn(() => signaturePromise);
    hooks.signMessage.mockReturnValue({ isPending: false, signMessageAsync });
    const onEvidence = vi.fn();
    const { view } = await renderAuthorizedConnections({
      connections: [activeConnection(metamask, metamaskAddress)],
      connectors: [metamask],
      onEvidence,
    });
    onEvidence.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Sign selected proof' }));
    await waitFor(() => expect(signMessageAsync).toHaveBeenCalledTimes(1));
    hooks.connections.mockReturnValue([activeConnection(metamask, changedAddress)]);
    view.rerender(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);
    await act(async () => {
      rejectSignature?.({ code: 4001 });
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText(/stale proof was discarded/u)).toBeVisible());
    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ownership-proof', outcome: 'blocked' }),
    );
    expect(onEvidence).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'reject', outcome: 'rejected' }),
    );
  });

  it('revalidates authorization again after local signature verification', async () => {
    const metamask = metamaskConnector();
    let releaseVerification: ((value: boolean) => void) | undefined;
    const verificationPromise = new Promise<boolean>((resolve) => {
      releaseVerification = resolve;
    });
    verify.mockImplementation(() => verificationPromise);
    const onEvidence = vi.fn();
    const { view } = await renderAuthorizedConnections({
      connections: [activeConnection(metamask, metamaskAddress)],
      connectors: [metamask],
      onEvidence,
    });
    onEvidence.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Sign selected proof' }));
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    hooks.connections.mockReturnValue([activeConnection(metamask, changedAddress)]);
    view.rerender(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);
    await act(async () => {
      releaseVerification?.(true);
      await verificationPromise;
    });

    await waitFor(() => expect(screen.getByText(/stale proof was discarded/u)).toBeVisible());
    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ownership-proof', outcome: 'blocked' }),
    );
    expect(onEvidence).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ownership-proof', outcome: 'accepted' }),
    );
  });

  it('records passive removals and deduplicates a later explicit disconnect', async () => {
    const metamask = metamaskConnector();
    const coinbase = coinbaseConnector();
    const metamaskSession = activeConnection(metamask, metamaskAddress);
    const coinbaseSession = activeConnection(coinbase, coinbaseAddress);
    const disconnectAsync = vi.fn(async () => undefined);
    hooks.disconnect.mockReturnValue({ isPending: false, disconnectAsync });
    const onEvidence = vi.fn();
    const { view } = await renderAuthorizedConnections({
      connections: [metamaskSession, coinbaseSession],
      connectors: [metamask, coinbase],
      onEvidence,
    });
    onEvidence.mockClear();

    hooks.connections.mockReturnValue([coinbaseSession]);
    view.rerender(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);
    await waitFor(() =>
      expect(onEvidence).toHaveBeenCalledWith(
        expect.objectContaining({
          connectorId: 'metamask',
          kind: 'disconnect',
          outcome: 'cleared',
        }),
      ),
    );

    fireEvent.change(screen.getByLabelText('Wallet connector'), {
      target: { value: coinbase.uid },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign selected proof' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect selected' }));
    await waitFor(() => expect(disconnectAsync).toHaveBeenCalledWith({ connector: coinbase }));
    hooks.connections.mockReturnValue([]);
    view.rerender(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);

    await waitFor(() => {
      const coinbaseDisconnects = onEvidence.mock.calls.filter(
        ([event]) => event.connectorId === 'coinbase' && event.kind === 'disconnect',
      );
      expect(coinbaseDisconnects).toHaveLength(1);
    });
  });
});

describe('EvmPanel connector and account policy', () => {
  it('hides generic and embedded injected providers from discovery', async () => {
    const rogue = injectedConnector({ id: 'injected', uid: 'rogue', name: 'Generic provider' });
    const embedded = injectedConnector({
      id: 'com.coinbase.wallet',
      uid: 'embedded',
      name: 'Embedded provider',
    });
    const metamask = metamaskConnector();
    hooks.connect.mockReturnValue({
      connectors: [rogue, embedded, metamask],
      isPending: false,
      connectAsync: vi.fn(),
    });

    render(<EvmPanel runtime={runtime} onEvidence={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('option', { name: 'MetaMask' })).toBeVisible());
    expect(screen.queryByRole('option', { name: 'Generic provider' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Embedded provider' })).not.toBeInTheDocument();
  });

  it('quarantines an approved row that appeared without Connect or Restore intent', async () => {
    const metamask = metamaskConnector();
    const disconnectAsync = vi.fn(async () => undefined);
    hooks.connections.mockReturnValue([activeConnection(metamask, metamaskAddress)]);
    hooks.connect.mockReturnValue({
      connectors: [metamask],
      isPending: false,
      connectAsync: vi.fn(),
    });
    hooks.disconnect.mockReturnValue({ isPending: false, disconnectAsync });
    const onEvidence = vi.fn();

    render(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);

    await waitFor(() => expect(disconnectAsync).toHaveBeenCalledWith({ connector: metamask }));
    expect(screen.getByRole('button', { name: 'Sign selected proof' })).toBeDisabled();
    expect(screen.getByText(/Active locally authorized sessions:/u)).toHaveTextContent('0');
    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorId: 'metamask',
        kind: 'connect',
        outcome: 'blocked',
      }),
    );
  });

  it('quarantines an unapproved non-current connection without touching an approved peer', async () => {
    const metamask = metamaskConnector();
    const rogue = injectedConnector({ id: 'injected', uid: 'rogue', name: 'Generic provider' });
    const disconnectAsync = vi.fn(async () => undefined);
    hooks.disconnect.mockReturnValue({ isPending: false, disconnectAsync });
    const onEvidence = vi.fn();
    const approved = activeConnection(metamask, metamaskAddress);
    const { view } = await renderAuthorizedConnections({
      connections: [approved],
      connectors: [metamask],
      onEvidence,
    });
    disconnectAsync.mockClear();
    onEvidence.mockClear();
    hooks.connections.mockReturnValue([approved, activeConnection(rogue, coinbaseAddress)]);
    view.rerender(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);

    await waitFor(() => expect(disconnectAsync).toHaveBeenCalledWith({ connector: rogue }));
    expect(disconnectAsync).not.toHaveBeenCalledWith({ connector: metamask });
    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ connectorId: 'unapproved', outcome: 'blocked' }),
    );
  });

  it('quarantines a duplicate session for the same approved connector identity', async () => {
    const metamask = metamaskConnector();
    const duplicate = injectedConnector({
      id: 'io.metamask',
      uid: 'metamask-duplicate',
      name: 'MetaMask',
    });
    const disconnectAsync = vi.fn(async () => undefined);
    hooks.disconnect.mockReturnValue({ isPending: false, disconnectAsync });
    const onEvidence = vi.fn();
    const approved = activeConnection(metamask, metamaskAddress);
    const { view } = await renderAuthorizedConnections({
      connections: [approved],
      connectors: [metamask],
      onEvidence,
    });
    disconnectAsync.mockClear();
    onEvidence.mockClear();
    hooks.connections.mockReturnValue([approved, activeConnection(duplicate, changedAddress)]);
    view.rerender(<EvmPanel runtime={runtime} onEvidence={onEvidence} />);

    await waitFor(() => expect(disconnectAsync).toHaveBeenCalledWith({ connector: duplicate }));
    expect(disconnectAsync).not.toHaveBeenCalledWith({ connector: metamask });
    expect(screen.getAllByRole('option', { name: 'MetaMask' })).toHaveLength(1);
    expect(screen.getByText(/Active locally authorized sessions:/u)).toHaveTextContent('1');
    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ connectorId: 'metamask', kind: 'connect', outcome: 'blocked' }),
    );
  });

  it('blocks a multi-account result without disconnecting an existing peer', async () => {
    const metamask = metamaskConnector();
    const coinbase = coinbaseConnector();
    const disconnectAsync = vi.fn(async () => undefined);
    hooks.disconnect.mockReturnValue({ isPending: false, disconnectAsync });
    const { view } = await renderAuthorizedConnections({
      connections: [activeConnection(metamask, metamaskAddress)],
      connectors: [metamask, coinbase],
    });
    hooks.connect.mockReturnValue({
      connectors: [metamask, coinbase],
      isPending: false,
      connectAsync: vi.fn(async () => ({
        accounts: [coinbaseAddress, changedAddress],
        chainId: EVM_TESTNET_CHAIN_IDS.sepolia,
      })),
    });
    disconnectAsync.mockClear();
    view.rerender(<EvmPanel runtime={runtime} onEvidence={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Wallet connector'), {
      target: { value: coinbase.uid },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect selected' }));

    await waitFor(() =>
      expect(
        screen.getByText(/authorize exactly one test account instead of relying on account order/u),
      ).toBeVisible(),
    );
    expect(disconnectAsync).toHaveBeenCalledWith({ connector: coinbase });
    expect(disconnectAsync).not.toHaveBeenCalledWith({ connector: metamask });
  });

  it('sanitizes disconnect errors for the selected connector', async () => {
    const metamask = metamaskConnector();
    hooks.disconnect.mockReturnValue({
      isPending: false,
      disconnectAsync: vi.fn().mockRejectedValue(new Error('wc:private-session-topic')),
    });

    await renderAuthorizedConnections({
      connections: [activeConnection(metamask, metamaskAddress)],
      connectors: [metamask],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect selected' }));

    await waitFor(() =>
      expect(screen.getByText('The wallet could not complete the request.')).toBeVisible(),
    );
    expect(screen.getByRole('button', { name: 'Sign selected proof' })).toBeDisabled();
    expect(screen.queryByText(/private-session-topic/u)).not.toBeInTheDocument();
  });
});
